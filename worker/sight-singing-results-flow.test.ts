import { hashPassword } from 'better-auth/crypto';
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { provisionChoir } from './choirs/provision';
import worker from './index';
import { cookieFrom, signInWithPassword, TEST_PASSWORD } from './test/auth';

async function call(path: string, init: RequestInit = {}) {
  const execution = createExecutionContext();
  const headers = new Headers(init.headers);
  headers.set('Origin', 'https://same-page.test');
  const response = await worker.fetch(new Request(`https://same-page.test${path}`, { ...init, headers }), env, execution);
  await waitOnExecutionContext(execution);
  return response;
}

const passwordHash = await hashPassword(TEST_PASSWORD);
async function account(name: string, address?: string) {
  const id = crypto.randomUUID(), email = `${id}@sight-singing.test`, now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,1,?,?)').bind(id, name, email, now, now),
    env.DB.prepare("INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES (?,?,'credential',?,?,?,?)")
      .bind(crypto.randomUUID(), id, id, passwordHash, now, now),
  ]);
  const login = await signInWithPassword({ email, callWorker: (path, init) => {
    const headers = new Headers(init?.headers);
    if (address) headers.set('CF-Connecting-IP', address);
    return call(path, { ...init, headers });
  } });
  expect(login.status, await login.clone().text()).toBe(200);
  return { id, cookie: cookieFrom(login) };
}

const score = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Alto</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
  <clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch>
  <duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;

it('keeps one best published score per version and withdraws only the selected owned entry', async () => {
  const owner = await account('版主'), singer = await account('演唱者'), outsider = await account('访客');
  const { choirId, joinCode } = await provisionChoir({ binding: env.DB, ownerUserId: owner.id, ownerDisplayName: '管理员', inviteSecret: env.INVITE_SECRET });
  const joined = await call('/api/choirs/join', {
    method: 'POST', headers: { cookie: singer.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ admission: 'invite', joinCode, displayName: '云盘里的 Alto' }),
  });
  expect(joined.status).toBe(201);
  const questionId = crypto.randomUUID(), questionsPath = `/api/choirs/${choirId}/sight-singing/questions`, questionPath = `${questionsPath}/${questionId}`;
  async function freezeVersion(expectedVersion: number | null, pitch: string) {
    const form = new FormData();
    form.append('fields', JSON.stringify({ title: '和声练习', first: 0, last: 0, expectedVersion }));
    form.append('file', new File([score.replace('<step>C</step>', `<step>${pitch}</step>`)], 'score.musicxml', { type: 'application/vnd.recordare.musicxml+xml' }));
    const response = await call(questionPath, { method: 'PUT', body: form, headers: { cookie: owner.cookie, 'x-same-page-owner-user-id': owner.id } });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({ question: { id: questionId, version: (expectedVersion ?? 0) + 1 } });
  }
  await freezeVersion(null, 'C');
  await freezeVersion(1, 'E');

  const resultPath = `${questionPath}/results`, listPath = `${resultPath}?version=1`;
  const read = (path: string, viewer = singer) => call(path, { headers: { cookie: viewer.cookie } });
  const resultFields = { id: crypto.randomUUID(), version: 1, score: 84, voiceId: '0:0:0', voiceName: 'Alto' };
  const result = { ...resultFields, scoringRule: 3 };
  const send = (body: unknown = result, author = singer, userId = author.id, path = resultPath) => call(path, {
    method: 'POST', headers: { cookie: author.cookie, 'content-type': 'application/json', 'x-same-page-owner-user-id': userId },
    body: JSON.stringify(body),
  });

  expect(await (await read(listPath)).json()).toEqual({ results: [] });
  expect((await read(listPath, outsider)).status).toBe(403);
  expect((await send(result, outsider)).status).toBe(403);
  expect((await send(result, singer, owner.id)).status).toBe(403);
  expect((await send({ ...result, version: 3 })).status).toBe(404);
  expect((await send(result, singer, singer.id, `${questionsPath}/${crypto.randomUUID()}/results`)).status).toBe(404);
  const liveQuestionId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO sight_singing_questions(choir_id, id, title, score_id, attachment_id,
    attachment_revision, first_visit, last_visit, version) VALUES (?, ?, '未冻结的旧题', 'old-score', 'old-file', 1, 0, 0, 1)`)
    .bind(choirId, liveQuestionId).run();
  expect((await send(result, singer, singer.id, `${questionsPath}/${liveQuestionId}/results`)).status).toBe(404);
  expect((await send({ ...result, recording: 'RIFF', notes: [{ midi: 64 }] })).status).toBe(400);
  expect((await send({ ...result, scoringRule: 2 })).status).toBe(400);
  expect((await send({ ...result, scoringRule: undefined })).status).toBe(400);

  const own = { ...resultFields, questionId, displayName: '云盘里的 Alto', own: true };
  const first = await send();
  expect(first.status, await first.clone().text()).toBe(200);
  expect(await first.json()).toEqual({ result: own });
  expect(await (await send()).json()).toEqual({ result: own });
  expect((await send({ ...result, score: 99 })).status).toBe(409);
  expect((await send(result, owner)).status).toBe(409);
  expect(await (await read(`${resultPath}?version=2`)).json()).toEqual({ results: [] });

  const publicList = await read(listPath, owner);
  expect(publicList.headers.get('Cache-Control')).toBe('no-store');
  expect(await publicList.json()).toEqual({ results: [{ ...own, own: false }] });

  const bestPath = `${resultPath}?view=best`;
  const newTake = (fields: { version?: number; score: number; speed: number; voiceName?: string }) =>
    ({ ...result, id: crypto.randomUUID(), ...fields });
  const tie = newTake({ score: 84, speed: .75, voiceName: 'Soprano' });
  expect(await (await send(tie, singer, singer.id, bestPath)).json()).toMatchObject({ published: false });
  const better = newTake({ score: 94, speed: 1.5 }), inferior = newTake({ score: 89, speed: .5 });
  const concurrent = await Promise.all([send(better, singer, singer.id, bestPath), send(inferior, singer, singer.id, bestPath)]);
  expect(concurrent.map(response => response.status)).toEqual([200, 200]);
  expect(await (await read(bestPath)).json()).toMatchObject({ versions: [2, 1], results: [{ id: better.id, score: 94, speed: 1.5 }] });
  const v2 = newTake({ version: 2, score: 70, speed: 1.25 });
  expect(await (await send(v2, singer, singer.id, bestPath)).json()).toMatchObject({ published: true });
  expect(await (await read(bestPath + '&version=2')).json()).toMatchObject({ results: [{ id: v2.id, version: 2 }] });
  expect(await (await read(bestPath)).json()).toMatchObject({ results: [{ id: better.id, score: 94 }] });

  const withdraw = (author: typeof singer) => call(`${resultPath}/${better.id}?version=1`, {
    method: 'DELETE', headers: { cookie: author.cookie, 'x-same-page-owner-user-id': author.id },
  });
  expect((await withdraw(outsider)).status).toBe(403);
  expect((await withdraw(owner)).status).toBe(204);
  expect(await (await read(bestPath)).json()).toMatchObject({ results: [{ id: better.id }] });
  expect((await withdraw(singer)).status).toBe(204);
  expect(await (await read(listPath)).json()).toEqual({ results: [] });
  expect(await (await send(better, singer, singer.id, bestPath)).json()).toMatchObject({ published: false });
  expect(await (await send(inferior, singer, singer.id, bestPath)).json()).toMatchObject({ published: false });
  expect(await (await read(bestPath)).json()).toMatchObject({ results: [{ id: v2.id, score: 70 }] });
  const fresh = newTake({ score: 77, speed: 1 });
  expect(await (await send(fresh, singer, singer.id, bestPath)).json()).toMatchObject({ published: true });
  expect(await (await read(bestPath + '&version=1')).json()).toMatchObject({ results: [{ id: fresh.id, score: 77 }] });

  const overview = `/api/choirs/${choirId}/sight-singing/leaderboard`;
  expect((await read(overview, outsider)).status).toBe(403);
  const fourth = await account('第四位歌者', '192.0.2.4');
  for (const person of [outsider, fourth]) await env.DB.prepare(
    "INSERT INTO memberships(id,choir_id,user_id,display_name,status) VALUES (?,?,?,?,'active')",
  ).bind(crypto.randomUUID(), choirId, person.id, person === outsider ? '次中音团员' : '第四位歌者').run();
  const partTake = (score: number, version: number, tenor = false) => ({
    ...newTake({ score, version, speed: 1, voiceName: tenor ? 'Tenor' : 'Alto' }),
    scoringRule: 3, voiceId: tenor ? '1:0:0' : '0:0:0',
  });
  const altoV1 = partTake(89, 1), tenorV1 = partTake(78, 1, true), altoV2 = partTake(72, 2);
  const ownerV2 = partTake(85, 2), otherV2 = partTake(81, 2, true), fourthV2 = partTake(68, 2);
  for (const [attempt, author] of [[altoV1, singer], [tenorV1, singer], [altoV2, singer],
    [ownerV2, owner], [otherV2, outsider], [fourthV2, fourth]] as const) {
    expect(await (await send(attempt, author, author.id, bestPath)).json()).toMatchObject({ published: true });
  }
  expect(await (await send(partTake(77, 1, true), singer, singer.id, bestPath)).json()).toMatchObject({ published: false });
  const listing = bestPath;
  expect(await (await read(listing + '&voice=Tenor&version=1')).json()).toMatchObject({
    results: [{ id: tenorV1.id, score: 78 }], voices: ['Alto', 'Tenor'],
  });
  const topIds = async (query: string) => {
    const response = await read(overview + query);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const { results } = await response.json<{ results: { id: string }[] }>();
    return results.map(row => row.id);
  };
  expect(await topIds('?versions=all')).toEqual([altoV1.id, ownerV2.id, otherV2.id]);
  expect(await topIds('?versions=latest')).toEqual([ownerV2.id, otherV2.id, altoV2.id]);
  expect(await topIds('?versions=latest&voice=Alto')).toEqual([ownerV2.id, altoV2.id, fourthV2.id]);
  expect(await (await read(overview + '?versions=latest&voice=Soprano&podium=1')).json()).toMatchObject({
    results: [], participants: [{ questionId, count: 4 }],
  });
  const withdrawnPart = await call(`${resultPath}/${tenorV1.id}?version=1`, {
    method: 'DELETE', headers: { cookie: singer.cookie, 'x-same-page-owner-user-id': singer.id },
  });
  expect(withdrawnPart.status).toBe(204);
  expect(await (await read(listing + '&voice=Tenor&version=1')).json()).toMatchObject({ results: [] });
  expect(await (await send(tenorV1, singer, singer.id, bestPath)).json()).toMatchObject({ published: false });
  expect(await (await read(listing + '&voice=Alto&version=1')).json()).toMatchObject({ results: [{ id: altoV1.id }] });
  // Both round to 89 for older clients. The later 89.41 wins on the live board.
  const ownerPrecise = partTake(89.4, 2), singerPrecise = { ...partTake(89.41, 1), speed: .5 };
  const matchedPath = bestPath + '&perfect=1';
  const writtenPath = matchedPath + '&writtenOctave=1';
  expect(await (await send(ownerPrecise, owner, owner.id, matchedPath)).json()).toMatchObject({ published: true });
  expect(await (await send(singerPrecise, singer, singer.id, writtenPath)).json()).toMatchObject({ published: true });
  expect(await (await send(singerPrecise, singer, singer.id, writtenPath)).json()).toMatchObject({ published: true });
  expect(await (await send(partTake(89.4, 1), singer, singer.id, bestPath)).json()).toMatchObject({ published: false });
  expect((await send(partTake(89.401, 1), singer, singer.id, bestPath)).status).toBe(400);
  const previousTop = await (await read(overview + '?precision=2')).json<{ results: object[] }>();
  expect(previousTop).toMatchObject({
    results: [{ id: singerPrecise.id, score: 89.41 }, { id: ownerPrecise.id, score: 89.4 }, { id: otherV2.id, score: 81 }],
  });
  expect(previousTop.results[0]).not.toHaveProperty('perfect');
  const currentTop = await (await read(overview + '?precision=2&details=1')).json<{ results: object[] }>();
  expect(currentTop.results[0]).toMatchObject({ id: singerPrecise.id, score: 89.41, perfect: true, speed: .5 });
  expect(currentTop.results[0]).not.toHaveProperty('writtenOctave');
  const recentPart = listing + '&voice=Alto&version=1&precision=2';
  const octaveDetails = '&details=1&writtenOctave=1';
  const octaveTop = await (await read(overview + '?precision=2' + octaveDetails)).json<{ results: object[] }>();
  expect(octaveTop.results[0]).toMatchObject({ id: singerPrecise.id, writtenOctave: true, perfect: true, speed: .5 });
  expect(octaveTop.results[1]).toMatchObject({ id: ownerPrecise.id, perfect: true });
  expect(octaveTop.results[1]).not.toHaveProperty('writtenOctave');
  const previousPart = await (await read(recentPart + '&details=1')).json<{ results: object[] }>();
  expect(previousPart.results[0]).toMatchObject({ score: 89.41, perfect: true, speed: .5 });
  expect(previousPart.results[0]).not.toHaveProperty('writtenOctave');
  expect(await (await read(recentPart + octaveDetails)).json()).toMatchObject({ results: [{ writtenOctave: true, perfect: true }] });
  expect((await (await read(recentPart)).json<{ results: object[] }>()).results[0]).not.toHaveProperty('perfect');
  expect(await (await read(listing + '&voice=Alto&version=1')).json()).toMatchObject({ results: [{ score: 89 }] });

  // A worker from before the marker existed replaces the winning take ID only.
  const replacementId = crypto.randomUUID();
  await env.DB.prepare('UPDATE sight_singing_best_results SET id = ?, score = 92, speed = 1.5 WHERE id = ?')
    .bind(replacementId, singerPrecise.id).run();
  const afterReplacement = (await (await read(recentPart + octaveDetails)).json<{ results: object[] }>()).results[0];
  expect(afterReplacement).toMatchObject({ id: replacementId, score: 92, speed: 1.5 });
  expect(afterReplacement).not.toHaveProperty('perfect');
  expect(afterReplacement).not.toHaveProperty('writtenOctave');

  const fourthTie = partTake(81, 2);
  expect(await (await send(fourthTie, fourth, fourth.id, bestPath)).json()).toMatchObject({ published: true });
  // Both singers at the cutoff share third place. Older clients still receive three rows.
  expect(await topIds('?precision=2&podium=1')).toEqual([replacementId, ownerPrecise.id, otherV2.id, fourthTie.id]);
  expect(await topIds('?precision=2')).toEqual([replacementId, ownerPrecise.id, otherV2.id]);
  const withdrawal = await call(`${resultPath}/${fourthTie.id}?version=2`, {
    method: 'DELETE', headers: { cookie: fourth.cookie, 'x-same-page-owner-user-id': fourth.id },
  });
  expect(withdrawal.status).toBe(204);
  expect(await (await read(overview + '?podium=1')).json()).toMatchObject({ participants: [{ questionId, count: 3 }] });

  await env.DB.prepare("UPDATE memberships SET status = 'removed' WHERE choir_id = ? AND user_id = ?").bind(choirId, singer.id).run();
  expect((await read(listPath)).status).toBe(403);
  expect((await send()).status).toBe(403);
  expect(await (await read(listPath, owner)).json()).toEqual({ results: [] });
  expect(await (await read(overview + '?podium=1', owner)).json()).toMatchObject({ participants: [{ questionId, count: 2 }] });
});
