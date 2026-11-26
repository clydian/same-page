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

it('keeps one best score per version, voice and speed and withdraws only the selected owned entry', async () => {
  const owner = await account('版主'), singer = await account('演唱者'), outsider = await account('访客');
  const { choirId, joinCode } = await provisionChoir({ binding: env.DB, ownerUserId: owner.id, ownerDisplayName: '管理员', inviteSecret: env.INVITE_SECRET });
  const joined = await call('/api/choirs/join', {
    method: 'POST', headers: { cookie: singer.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ admission: 'invite', joinCode, displayName: '云盘里的 Alto' }),
  });
  expect(joined.status).toBe(201);
  const questionId = crypto.randomUUID(), questionsPath = `/api/choirs/${choirId}/sight-singing/questions`, questionPath = `${questionsPath}/${questionId}`;
  let editToken: string | undefined;
  async function freezeVersion(expectedVersion: number | null, pitch: string) {
    const form = new FormData();
    form.append('fields', JSON.stringify({ title: '和声练习', first: 0, last: 0, expectedVersion, expectedEditToken: editToken }));
    form.append('file', new File([score.replace('<step>C</step>', `<step>${pitch}</step>`)], 'score.musicxml', { type: 'application/vnd.recordare.musicxml+xml' }));
    const response = await call(questionPath, { method: 'PUT', body: form, headers: { cookie: owner.cookie, 'x-same-page-owner-user-id': owner.id } });
    expect(response.status, await response.clone().text()).toBe(200);
    const payload = await response.json<{ question: { snapshot: { editToken: string } } }>();
    expect(payload).toMatchObject({ question: { id: questionId, version: (expectedVersion ?? 0) + 1 } });
    editToken = payload.question.snapshot.editToken;
  }
  await freezeVersion(null, 'C');
  await freezeVersion(1, 'E');

  const resultPath = `${questionPath}/results`, listPath = `${resultPath}?version=1`;
  const read = (path: string, viewer = singer) => call(path, { headers: { cookie: viewer.cookie } });
  const resultFields = { id: crypto.randomUUID(), version: 1, score: 84, speed: 1, voiceId: '0:0:0', voiceName: 'Alto' };
  const result = { ...resultFields, perfect: false, writtenOctave: false };
  const send = (body: unknown = result, author = singer, userId = author.id, path = resultPath) => call(path, {
    method: 'POST', headers: { cookie: author.cookie, 'content-type': 'application/json', 'x-same-page-owner-user-id': userId },
    body: JSON.stringify(body),
  });

  expect(await (await read(listPath)).json()).toMatchObject({ results: [] });
  expect((await read(listPath, outsider)).status).toBe(403);
  expect((await send(result, outsider)).status).toBe(403);
  expect((await send(result, singer, owner.id)).status).toBe(403);
  expect((await send({ ...result, version: 3 })).status).toBe(404);
  expect((await send(result, singer, singer.id, `${questionsPath}/${crypto.randomUUID()}/results`)).status).toBe(404);
  expect((await send({ ...result, recording: 'RIFF', notes: [{ midi: 64 }] })).status).toBe(400);
  expect((await send({ ...result, speed: undefined })).status).toBe(400);
  expect((await send({ ...result, writtenOctave: true })).status).toBe(400);

  const own = { ...resultFields, questionId, displayName: '云盘里的 Alto', own: true };
  const first = await send();
  expect(first.status, await first.clone().text()).toBe(200);
  expect(await first.json()).toMatchObject({ result: own, published: true });
  expect(await (await send()).json()).toMatchObject({ result: own, published: true });
  expect((await send({ ...result, score: 99 })).status).toBe(409);
  expect((await send(result, owner)).status).toBe(409);
  expect(await (await read(`${resultPath}?version=2`)).json()).toMatchObject({ results: [] });

  const publicList = await read(listPath, owner);
  expect(publicList.headers.get('Cache-Control')).toBe('no-store');
  expect(await publicList.json()).toMatchObject({ results: [{ ...own, own: false }] });

  const bestPath = resultPath;
  const newTake = (fields: { version?: number; score: number; speed: number; voiceName?: string }) =>
    ({ ...result, id: crypto.randomUUID(), ...fields });
  const tie = newTake({ score: 84, speed: 1, voiceName: 'Soprano' });
  expect(await (await send(tie, singer, singer.id, bestPath)).json()).toMatchObject({ published: false });
  const better = newTake({ score: 94, speed: 1.5 }), inferior = newTake({ score: 89, speed: 1.5 });
  const concurrent = await Promise.all([send(better, singer, singer.id, bestPath), send(inferior, singer, singer.id, bestPath)]);
  expect(concurrent.map(response => response.status)).toEqual([200, 200]);
  const slower = newTake({ score: 82, speed: .5 });
  expect(await (await send(slower)).json()).toMatchObject({ published: true });
  expect(await (await read(bestPath)).json()).toMatchObject({ results: [{ id: better.id, score: 94, speed: 1.5 }] });
  const standardSpeed = bestPath + '?version=1&voice=Alto&speed=1.00';
  expect(await (await read(standardSpeed)).json()).toMatchObject({ results: [{ id: result.id, score: 84, speed: 1 }] });
  expect(await (await read(bestPath + '?speed=0.50')).json()).toMatchObject({ results: [{ id: slower.id, score: 82 }] });
  expect((await read(bestPath + '?speed=1.75')).status).toBe(400);
  const v2 = newTake({ version: 2, score: 70, speed: 1.25 });
  expect(await (await send(v2, singer, singer.id, bestPath)).json()).toMatchObject({ published: true });
  expect(await (await read(bestPath + '?version=2')).json()).toMatchObject({ results: [{ id: v2.id, version: 2 }] });
  expect(await (await read(bestPath)).json()).toMatchObject({ results: [{ id: better.id, score: 94 }] });

  const withdraw = (author: typeof singer) => call(`${resultPath}/${better.id}?version=1`, {
    method: 'DELETE', headers: { cookie: author.cookie, 'x-same-page-owner-user-id': author.id },
  });
  expect((await withdraw(outsider)).status).toBe(403);
  expect((await withdraw(owner)).status).toBe(204);
  expect(await (await read(bestPath)).json()).toMatchObject({ results: [{ id: better.id }] });
  expect((await withdraw(singer)).status).toBe(204);
  expect(await (await read(bestPath + '?speed=1.5')).json()).toMatchObject({ results: [] });
  expect(await (await send(better, singer, singer.id, bestPath)).json()).toMatchObject({ published: false });
  expect(await (await send(inferior, singer, singer.id, bestPath)).json()).toMatchObject({ published: false });
  expect(await (await read(bestPath)).json()).toMatchObject({ results: [{ id: result.id, score: 84 }] });
  const fresh = newTake({ score: 77, speed: 1.5 });
  expect(await (await send(fresh, singer, singer.id, bestPath)).json()).toMatchObject({ published: true });
  expect(await (await read(bestPath + '?version=1&speed=1.5')).json()).toMatchObject({ results: [{ id: fresh.id, score: 77 }] });

  const overview = `/api/choirs/${choirId}/sight-singing/leaderboard`;
  expect((await read(overview, outsider)).status).toBe(403);
  const fourth = await account('第四位歌者', '192.0.2.4');
  for (const person of [outsider, fourth]) await env.DB.prepare(
    "INSERT INTO memberships(id,choir_id,user_id,display_name,status) VALUES (?,?,?,?,'active')",
  ).bind(crypto.randomUUID(), choirId, person.id, person === outsider ? '次中音团员' : '第四位歌者').run();
  const partTake = (score: number, version: number, tenor = false) => ({
    ...newTake({ score, version, speed: 1, voiceName: tenor ? 'Tenor' : 'Alto' }),
    voiceId: tenor ? '1:0:0' : '0:0:0',
  });
  const altoV1 = partTake(89, 1), tenorV1 = partTake(78, 1, true), altoV2 = partTake(72, 2);
  const ownerV2 = partTake(85, 2), otherV2 = partTake(81, 2, true), fourthV2 = partTake(68, 2);
  for (const [attempt, author] of [[altoV1, singer], [tenorV1, singer], [altoV2, singer],
    [ownerV2, owner], [otherV2, outsider], [fourthV2, fourth]] as const) {
    expect(await (await send(attempt, author, author.id, bestPath)).json()).toMatchObject({ published: true });
  }
  expect(await (await send(partTake(77, 1, true), singer, singer.id, bestPath)).json()).toMatchObject({ published: false });
  const listing = bestPath;
  expect(await (await read(listing + '?voice=Tenor&version=1')).json()).toMatchObject({
    results: [{ id: tenorV1.id, score: 78 }], voices: ['Alto', 'Tenor'],
  });
  const topIds = async () => {
    const response = await read(overview);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const { results } = await response.json<{ results: { id: string }[] }>();
    return results.map(row => row.id);
  };
  expect(await topIds()).toEqual([altoV1.id, ownerV2.id, otherV2.id]);
  expect(await (await read(overview)).json()).toMatchObject({ participants: [{ questionId, count: 4 }] });
  const withdrawnPart = await call(`${resultPath}/${tenorV1.id}?version=1`, {
    method: 'DELETE', headers: { cookie: singer.cookie, 'x-same-page-owner-user-id': singer.id },
  });
  expect(withdrawnPart.status).toBe(204);
  expect(await (await read(listing + '?voice=Tenor&version=1')).json()).toMatchObject({ results: [] });
  expect(await (await send(tenorV1, singer, singer.id, bestPath)).json()).toMatchObject({ published: false });
  expect(await (await read(listing + '?voice=Alto&version=1')).json()).toMatchObject({ results: [{ id: altoV1.id }] });
  const ownerPrecise = { ...partTake(89.4, 2), perfect: true };
  const singerPrecise = { ...partTake(89.41, 1), speed: .5, perfect: true, writtenOctave: true };
  expect(await (await send(ownerPrecise, owner)).json()).toMatchObject({ published: true });
  expect(await (await send(singerPrecise)).json()).toMatchObject({ published: true });
  expect(await (await send(singerPrecise)).json()).toMatchObject({ published: true });
  expect((await send({ ...singerPrecise, writtenOctave: false })).status).toBe(409);
  expect(await (await send({ ...partTake(89.4, 1), speed: .5 })).json()).toMatchObject({ published: false });
  expect((await send(partTake(89.401, 1))).status).toBe(400);
  const podium = await (await read(overview)).json<{ results: object[] }>();
  expect(podium.results).toMatchObject([
    { id: singerPrecise.id, score: 89.41, perfect: true, writtenOctave: true, speed: .5 },
    { id: ownerPrecise.id, score: 89.4, perfect: true },
    { id: otherV2.id, score: 81 },
  ]);
  expect(podium.results[1]).not.toHaveProperty('writtenOctave');
  const recentPart = listing + '?voice=Alto&version=1';
  expect(await (await read(recentPart)).json()).toMatchObject({
    results: [{ id: singerPrecise.id, score: 89.41, perfect: true, writtenOctave: true }],
  });
  const replacement = { ...partTake(92, 1), speed: 1.5 };
  expect(await (await send(replacement)).json()).toMatchObject({ published: true });
  const afterReplacement = (await (await read(recentPart)).json<{ results: object[] }>()).results[0];
  expect(afterReplacement).toMatchObject({ id: replacement.id, score: 92, speed: 1.5 });
  expect(afterReplacement).not.toHaveProperty('perfect');
  expect(afterReplacement).not.toHaveProperty('writtenOctave');
  expect(await (await read(standardSpeed)).json()).toMatchObject({ results: [{ id: altoV1.id, score: 89, speed: 1 }] });

  const fourthTie = partTake(81, 2);
  expect(await (await send(fourthTie, fourth, fourth.id, bestPath)).json()).toMatchObject({ published: true });
  // Both singers at the cutoff share third place.
  expect(await topIds()).toEqual([replacement.id, ownerPrecise.id, otherV2.id, fourthTie.id]);
  const withdrawal = await call(`${resultPath}/${fourthTie.id}?version=2`, {
    method: 'DELETE', headers: { cookie: fourth.cookie, 'x-same-page-owner-user-id': fourth.id },
  });
  expect(withdrawal.status).toBe(204);
  expect(await (await read(overview)).json()).toMatchObject({ participants: [{ questionId, count: 3 }] });

  const onTie = await send(partTake(89.4, 2), singer, singer.id, bestPath);
  expect(await onTie.json()).toMatchObject({ published: true, standing: {
    place: 1, tied: true, participants: 3, previous: { place: 1, score: 92 },
    nearby: [{ score: 89.4, place: 1, position: 1 }, { score: 81, place: 2, position: 2 }],
  } });
  const belowBest = await send(partTake(86, 2), singer, singer.id, bestPath);
  expect(await belowBest.json()).toMatchObject({ published: false, standing: {
    place: 2, tied: false, participants: 3, previous: { place: 1, score: 92 },
  } });
  const acrossParts = await send(partTake(94, 2, true), owner, owner.id, bestPath);
  expect(await acrossParts.json()).toMatchObject({ published: true, standing: {
    place: 1, tied: false, participants: 3, previous: { place: 2, score: 89.4 },
    nearby: [{ score: 92 }, { score: 81 }],
  } });

  await env.DB.prepare("UPDATE memberships SET status = 'removed' WHERE choir_id = ? AND user_id = ?").bind(choirId, singer.id).run();
  expect((await read(listPath)).status).toBe(403);
  expect((await send()).status).toBe(403);
  expect(await (await read(listPath, owner)).json()).toMatchObject({ results: [] });
  expect(await (await read(overview, owner)).json()).toMatchObject({ participants: [{ questionId, count: 2 }] });
});
