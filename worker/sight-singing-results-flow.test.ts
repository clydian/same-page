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
async function account(name: string) {
  const id = crypto.randomUUID(), email = `${id}@sight-singing.test`, now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,1,?,?)').bind(id, name, email, now, now),
    env.DB.prepare("INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES (?,?,'credential',?,?,?,?)")
      .bind(crypto.randomUUID(), id, id, passwordHash, now, now),
  ]);
  const login = await signInWithPassword({ callWorker: call, email });
  expect(login.status, await login.clone().text()).toBe(200);
  return { id, cookie: cookieFrom(login) };
}

const score = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Alto</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
  <clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch>
  <duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;

it('publishes only explicitly submitted scores for a frozen version and shows them only to current drive members', async () => {
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
  const result = { id: crypto.randomUUID(), version: 1, score: 84, voiceId: '0:0:0', voiceName: 'Alto' };
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

  const own = { ...result, questionId, displayName: '云盘里的 Alto', own: true };
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
  await env.DB.prepare("UPDATE memberships SET status = 'removed' WHERE choir_id = ? AND user_id = ?").bind(choirId, singer.id).run();
  expect((await read(listPath)).status).toBe(403);
  expect((await send()).status).toBe(403);
  expect(await (await read(listPath, owner)).json()).toEqual({ results: [] });
});
