import assert from "node:assert/strict";
import { createServer, connect } from "node:net";
import { once } from "node:events";
import { test } from "node:test";
import { bootstrapArguments, createNetworkGate, productionOrigin, verifyBootstrapTarget } from "./verify-bootstrap-online.mjs";

const sha = "a".repeat(40);

test("production CLI accepts only a full SHA and fixes the destination", () => {
  assert.deepEqual(bootstrapArguments([sha]), { expectedBuildId: sha, origin: productionOrigin });
  for (const args of [[], ["abcdef1"], [sha, "https://other.invalid"], ["https://other.invalid"]]) {
    assert.throws(() => bootstrapArguments(args));
  }
});

test("bootstrap evidence rejects drift and excludes selection or extra response data", () => {
  const value = { channel: "stable", target: sha, revision: 1, backend: sha, contract: "same-page-storage-v15-sync-v1", intent: "private-intent", extra: "never-export" };
  assert.deepEqual(verifyBootstrapTarget(value, sha, "stable"), { channel: "stable", target: sha, revision: 1, backend: sha, contract: value.contract });
  for (const patch of [{ channel: "beta" }, { target: "b".repeat(40) }, { revision: 2 }, { contract: "other" }, { backend: "b".repeat(40) }]) {
    assert.throws(() => verifyBootstrapTarget({ ...value, ...patch }, sha, "stable"));
  }
});

test("loopback network gate transports only its target, then drops existing and new tunnels", { timeout: 5000 }, async t => {
  const wait = (emitter, event) => once(emitter, event, { signal: t.signal });
  const target = createServer(socket => socket.pipe(socket));
  target.listen(0, "127.0.0.1"); await wait(target, "listening");
  const authority = `127.0.0.1:${target.address().port}`;
  const gate = await createNetworkGate(`https://${authority}`);
  const open = async destination => {
    const proxy = new URL(gate.server);
    const socket = connect(Number(proxy.port), proxy.hostname);
    socket.on("error", () => socket.destroy());
    await wait(socket, "connect");
    socket.write(`CONNECT ${destination} HTTP/1.1\r\nHost: ${destination}\r\n\r\n`);
    return socket;
  };
  let tunnel;
  try {
    const wrong = await open("other.invalid:443");
    await wait(wrong, "close");
    tunnel = await open(authority);
    assert.match((await wait(tunnel, "data"))[0].toString(), /^HTTP\/1.1 200/);
    tunnel.write("original TLS bytes pass unchanged");
    assert.equal((await wait(tunnel, "data"))[0].toString(), "original TLS bytes pass unchanged");
    const closed = wait(tunnel, "close");
    gate.disconnect(); await closed;
    const offline = await open(authority);
    await wait(offline, "close");
  } finally {
    tunnel?.destroy(); await gate.close();
    await new Promise(resolve => target.close(resolve));
  }
});
