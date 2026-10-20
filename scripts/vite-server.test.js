import { mkdtemp, writeFile, readFile, readdir, rm, access } from "node:fs/promises";
import { createServer, connect } from "node:net";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { startViteServer } from "./vite-server.mjs";

it("isolates simultaneous servers and removes each owned directory on stop", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "same-page-server-test-"));
  const servers = [];
  try {
    await writeFile(path.join(cwd, "package.json"), JSON.stringify({ scripts: { dev: "node server.cjs" } }));
    await writeFile(path.join(cwd, "wrangler.jsonc"), JSON.stringify({ main: "worker.ts" }));
    await writeFile(path.join(cwd, "server.cjs"), `const s=require('node:http').createServer((q,r)=>{r.setHeader('x-same-page-test-server',process.env.SAME_PAGE_TEST_RUN);r.end(process.env.SAME_PAGE_TEST_STATE)});s.listen(Number(process.argv[process.argv.indexOf('--port')+1]),'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+s.address().port+'/'));`);
    await Promise.all([1, 2].map(async () => servers.push(await startViteServer({ cwd, script: "dev" }))));
    const states = await Promise.all(servers.map((server) => fetch(server.origin).then((r) => r.text())));
    expect(states[0]).not.toBe(states[1]);
    await servers[0].stop();
    await expect(access(states[0])).rejects.toThrow();
    expect(await fetch(servers[1].origin).then((r) => r.text())).toBe(states[1]);
    await servers[1].stop();
    await expect(access(states[1])).rejects.toThrow();
  } finally { await Promise.all(servers.map((server) => server.stop())); await rm(cwd, { recursive: true, force: true }); }
}, 15_000);

it("fails promptly with the original child error and cleans prepared state", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "same-page-server-fail-"));
  let statePath;
  try {
    await writeFile(path.join(cwd, "package.json"), JSON.stringify({ scripts: { dev: "node fail.cjs" } }));
    await writeFile(path.join(cwd, "fail.cjs"), "console.error('fixture startup broke');process.exit(17);");
    await writeFile(path.join(cwd, "wrangler.jsonc"), "{}");
    const start = Date.now();
    await expect(startViteServer({ cwd, script: "dev", timeoutMs: 20_000, prepare: async (state) => { statePath = state.statePath; await readFile(state.configPath); } })).rejects.toThrow(/fixture startup broke/);
    expect(Date.now() - start).toBeLessThan(8_000);
    await expect(access(statePath)).rejects.toThrow();
    const directory = path.join(cwd, "artifacts/verification/server-startup");
    const [file] = await readdir(directory);
    const evidence = JSON.parse(await readFile(path.join(directory, file), "utf8"));
    expect(evidence.parentPid).toBe(process.pid);
    expect(evidence.childPid).toBeGreaterThan(0);
    expect(evidence.error).toContain("Vite exited: 17");
    expect(evidence.origins).toHaveLength(1);
    // Diagnostics are captured while the parent still owns the listener.
    expect(evidence.owners[0].origin).toBe(evidence.origins[0]);
    expect(await claimPort(Number(new URL(evidence.origins[0]).port))).toBeUndefined();
  } finally { await rm(cwd, { recursive: true, force: true }); }
}, 15_000);

it("waits for fixture preparation to release resources before signal exit", async () => {
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const cwd = await mkdtemp(path.join(tmpdir(), "same-page-prepare-signal-"));
  let child;
  try {
    await writeFile(path.join(cwd, "wrangler.jsonc"), "{}");
    await writeFile(path.join(cwd, "prepare.mjs"), `
      import { writeFile } from 'node:fs/promises';
      import { startViteServer } from ${JSON.stringify(new URL("./vite-server.mjs", import.meta.url).href)};
      await startViteServer({script:'dev', prepare:async ({statePath,signal})=>{
        const keepAlive=setInterval(()=>{},1000);
        console.log(statePath);
        try { await new Promise(resolve=>signal?.addEventListener('abort',resolve,{once:true})); }
        finally { await writeFile('released','yes'); clearInterval(keepAlive); }
      }}).catch(()=>{});
    `);
    child = spawn(process.execPath, ["prepare.mjs"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const exited = once(child, "exit");
    const [output] = await once(child.stdout, "data");
    const statePath = String(output).trim();
    child.kill("SIGTERM");
    await exited;
    expect(await readFile(path.join(cwd, "released"), "utf8")).toBe("yes");
    await expect(access(statePath)).rejects.toThrow();
  } finally {
    if (child && child.exitCode === null) child.kill("SIGKILL");
    await rm(cwd, { recursive: true, force: true });
  }
}, 10_000);

it("owns the public origin throughout preparation and child startup", async () => {
  const cwd = await fakeServer(`
    const s=require('node:http').createServer((q,r)=>{r.setHeader('x-same-page-test-server',process.env.SAME_PAGE_TEST_RUN);r.end('ready')});
    s.listen(Number(process.argv[process.argv.indexOf('--port')+1]),'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+s.address().port+'/'));
  `);
  let server, claimError, configuredOrigin;
  try {
    server = await startViteServer({ cwd, script: "dev", prepare: async ({ origin, configPath }) => {
      claimError = await claimPort(Number(new URL(origin).port));
      configuredOrigin = JSON.parse(await readFile(configPath, "utf8")).vars.BETTER_AUTH_URL;
    } });
    expect(claimError).toBe("EADDRINUSE");
    expect(server.backendOrigin).not.toBe(server.origin);
    expect(configuredOrigin).toBe(server.origin);
    expect(await fetch(server.origin).then(r => r.text())).toBe("ready");
    expect(await claimPort(Number(new URL(server.origin).port))).toBe("EADDRINUSE");
    await server.stop();
    expect(await claimPort(Number(new URL(server.origin).port))).toBeUndefined();
  } finally { await server?.stop(); await rm(cwd, { recursive: true, force: true }); }
}, 10_000);

it("preserves HTTP payloads, headers, streaming and upgrade bytes through the owned origin", async () => {
  const cwd = await fakeServer(`
    const s=require('node:http').createServer((q,r)=>{
      r.setHeader('x-same-page-test-server',process.env.SAME_PAGE_TEST_RUN);
      if(q.url==='/echo'){
        r.setHeader('set-cookie',['a=one; HttpOnly; SameSite=Lax','b=two; Path=/']);
        r.setHeader('x-observed-host',q.headers.host);r.setHeader('content-type','application/octet-stream');
        q.pipe(r);
      }else r.end('ready');
    });
    s.on('upgrade',(q,socket,head)=>{socket.write('HTTP/1.1 101 Switching Protocols\\r\\nConnection: Upgrade\\r\\nUpgrade: fixture\\r\\n\\r\\n');if(head.length)socket.write(head);socket.pipe(socket)});
    s.listen(Number(process.argv[process.argv.indexOf('--port')+1]),'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+s.address().port+'/'));
  `);
  let server, socket;
  try {
    server = await startViteServer({ cwd, script: "dev" });
    const payload = Buffer.from(Array.from({ length: 128 * 1024 }, (_, i) => i % 256));
    const r = await fetch(server.origin + "/echo", { method: "POST", body: payload });
    expect(r.headers.get("x-observed-host")).toBe(new URL(server.origin).host);
    expect(r.headers.getSetCookie()).toEqual(["a=one; HttpOnly; SameSite=Lax", "b=two; Path=/"]);
    expect(Buffer.from(await r.arrayBuffer()).equals(payload)).toBe(true);
    // A request-side FIN must not discard the response in the other direction.
    socket = connect({ host: "127.0.0.1", port: Number(new URL(server.origin).port) });
    await once(socket, "connect");
    socket.end('GET / HTTP/1.1\r\nHost: '+new URL(server.origin).host+'\r\nConnection: close\r\n\r\n');
    const response = [];
    for await (const chunk of socket) response.push(chunk);
    expect(Buffer.concat(response).toString()).toContain("ready");
    socket = connect({ host: "127.0.0.1", port: Number(new URL(server.origin).port) });
    await once(socket, "connect");
    const upgraded = once(socket, "data");
    socket.write('GET /upgrade HTTP/1.1\r\nHost: '+new URL(server.origin).host+'\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\n');
    expect(String((await upgraded)[0])).toContain("101 Switching Protocols");
    const bytes = Buffer.from([0, 1, 127, 128, 254, 255]);
    const echoed = once(socket, "data"); socket.write(bytes);
    expect((await echoed)[0].equals(bytes)).toBe(true);
    const closed = once(socket, "close");
    await server.stop(); await closed;
  } finally { socket?.destroy(); await server?.stop(); await rm(cwd, { recursive: true, force: true }); }
}, 10_000);

async function fakeServer(source) {
  const cwd = await mkdtemp(path.join(tmpdir(), "same-page-server-boundary-"));
  await writeFile(path.join(cwd, "package.json"), JSON.stringify({ scripts: { dev: "node server.cjs" } }));
  await writeFile(path.join(cwd, "wrangler.jsonc"), "{}");
  await writeFile(path.join(cwd, "server.cjs"), source);
  return cwd;
}

it("reports an occupied explicit port without preparing state or disturbing its owner", async () => {
  const cwd = await fakeServer(`
    const s=require('node:http').createServer((q,r)=>{r.setHeader('x-same-page-test-server',process.env.SAME_PAGE_TEST_RUN);r.end('owner')});
    s.listen(Number(process.argv[process.argv.indexOf('--port')+1]),'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+s.address().port+'/'));
  `);
  let owner, prepared = false;
  try {
    owner = await startViteServer({ cwd, script: "dev" });
    await expect(startViteServer({ cwd, script: "dev", port: Number(new URL(owner.origin).port), prepare: () => { prepared = true; } })).rejects.toThrow(/EADDRINUSE/);
    expect(prepared).toBe(false);
    expect(await fetch(owner.origin).then(r => r.text())).toBe("owner");
    const directory = path.join(cwd, "artifacts/verification/server-startup");
    const [file] = await readdir(directory);
    const evidence = JSON.parse(await readFile(path.join(directory, file), "utf8"));
    expect(evidence.origins).toEqual([owner.origin]);
    expect(evidence.childPid).toBeUndefined();
  } finally { await owner?.stop(); await rm(cwd, { recursive: true, force: true }); }
}, 10_000);

async function claimPort(port) {
  const server = createServer();
  try {
    return await new Promise(resolve => {
      server.once("error", error => resolve(error.code));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(undefined)));
    });
  } finally { if (server.listening) await new Promise(resolve => server.close(resolve)); }
}
