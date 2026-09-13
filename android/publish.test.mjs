import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { admitRelease, deriveR2Credentials } from "./publish.mjs";
const candidate = { signed: true, sourceSha: "a".repeat(40), versionCode: 2, sha256: "b".repeat(64) };
test("admits first/new versions and recognizes exact retry", () => {
  assert.equal(admitRelease(undefined, candidate), "publish");
  assert.equal(admitRelease({ versioncode: "1" }, candidate), "publish");
  assert.equal(admitRelease({ versioncode: "2", sha256: candidate.sha256 }, candidate), "already-published");
});
test("rejects stale, conflicting, malformed and unsigned releases", () => {
  for (const previous of [{ versioncode: "3" }, { versioncode: "2", sha256: "different" }, { versioncode: "bad" }]) assert.throws(() => admitRelease(previous, candidate));
  assert.throws(() => admitRelease(undefined, { ...candidate, signed: false }));
});

// Exercise the production credential boundary, without production credentials or R2 writes.
const account = 'a'.repeat(32);
const tokenId = 'c'.repeat(32);
const token = 'fixture-token';
const active = () => Response.json({ success: true, result: { id: tokenId, status: 'active' } });
test('account-owned token uses account verification after user endpoint rejects it', async () => {
  const urls = [];
  const credentials = await deriveR2Credentials(account, token, async (url) => {
    urls.push(url);
    return url.endsWith('/user/tokens/verify')
      ? Response.json({ success: false }, { status: 401 }) : active();
  });
  assert.deepEqual(urls, [
    'https://api.cloudflare.com/client/v4/user/tokens/verify',
    `https://api.cloudflare.com/client/v4/accounts/${account}/tokens/verify`,
  ]);
  assert.equal(credentials.accessKeyId, tokenId);
});

test('user token retains S3 derivation and does not call the account API', async () => {
  let calls = 0;
  const credentials = await deriveR2Credentials(account, token, async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.cloudflare.com/client/v4/user/tokens/verify');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.ok(options.signal instanceof AbortSignal);
    return active();
  });
  assert.equal(calls, 1);
  assert.deepEqual(credentials, { accessKeyId: tokenId, secretAccessKey: createHash('sha256').update(token).digest('hex') });
});

for (const status of [400, 403]) {
  test(`legacy account token can recover from user HTTP ${status}`, async () => {
    let calls = 0;
    await deriveR2Credentials(account, token, async () => ++calls === 1
      ? Response.json({ success: false }, { status }) : active());
    assert.equal(calls, 2);
  });
}

for (const status of [429, 500, 503]) {
  test(`HTTP ${status} does not fall through to another verification API`, async () => {
    let calls = 0;
    await assert.rejects(deriveR2Credentials(account, token, async () => {
      calls++;
      return new Response(token, { status });
    }), error => error.message.includes(`HTTP ${status}`) && !error.message.includes(token));
    assert.equal(calls, 1);
  });
}

test('both endpoints rejecting token fails closed without leaking response bodies', async () => {
  let calls = 0;
  await assert.rejects(deriveR2Credentials(account, token, async () => {
    calls++;
    return new Response(token, { status: 403 });
  }), error => error.message.includes('account token verification failed (HTTP 403)') && !error.message.includes(token));
  assert.equal(calls, 2);
});

for (const result of [{ id: tokenId, status: 'expired' }, { status: 'active' }, { id: '../invalid', status: 'active' }]) {
  test(`rejects untrusted verification result ${JSON.stringify(result)}`, async () => {
    let calls = 0;
    await assert.rejects(deriveR2Credentials(account, token, async () => {
      calls++;
      return Response.json({ success: true, result });
    }));
    assert.equal(calls, 1);
  });
}

test('network and malformed verification responses fail without fallback', async () => {
  for (const respond of [() => { throw new Error('network unavailable'); }, () => new Response('not JSON'), () => Response.json({ success: false })]) {
    let calls = 0;
    await assert.rejects(deriveR2Credentials(account, token, async () => {
      calls++;
      return respond();
    }));
    assert.equal(calls, 1);
  }
});
