import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createServer, connect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { detachedProcessGroup, stopChildProcessTree } from "./process-lifecycle.mjs";

const running = new Set();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void Promise.all([...running].map((stop) => stop())).finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  });
}

export async function startViteServer({ script, port, cwd = process.cwd(), env = process.env, timeoutMs = 30_000, prepare }) {
  const statePath = await mkdtemp(path.join(tmpdir(), "same-page-vite-"));
  const logs = [];
  let child;
  let stopping;
  let preparing;
  let listener;
  let backendOrigin;
  const runId = randomUUID();
  const shutdown = new AbortController();
  const stop = () => stopping ??= (async () => {
    shutdown.abort();
    try {
      await preparing?.catch(() => undefined);
      try { if (child) await stopChildProcessTree(child); }
      finally { await listener?.stop(); }
    }
    finally { await rm(statePath, { recursive: true, force: true }); running.delete(stop); }
  })();
  running.add(stop);
  try {
    preparing = (async () => {
      // Own the public origin continuously, including fixture and workerd startup.
      // Vite independently binds port 0; neither address is checked then released.
      listener = await ownedListener(port);
      const origin = listener.origin;
      const sourceConfig = script === "preview" ? path.join(cwd, "dist/same_page/wrangler.json") : path.join(cwd, "wrangler.jsonc");
      const config = JSON.parse(await readFile(sourceConfig, "utf8"));
      const configPath = path.join(statePath, "wrangler.json");
      if (config.main) config.main = path.resolve(path.dirname(sourceConfig), config.main);
      if (config.assets?.directory) config.assets.directory = path.resolve(path.dirname(sourceConfig), config.assets.directory);
      delete config.configPath; delete config.userConfigPath;
      for (const db of config.d1_databases ?? []) db.migrations_dir = path.resolve(path.dirname(sourceConfig), db.migrations_dir ?? "migrations");
      config.vars = { ...config.vars, BETTER_AUTH_URL: origin, AUTH_EMAIL_FROM: "Fixture <fixture@example.invalid>", BETTER_AUTH_SECRET: "same-page-local-test-secret-only", INVITE_SECRET: "same-page-local-test-invite-only" };
      config.routes = []; config.triggers = {}; config.observability = { enabled: false };
      await writeFile(configPath, JSON.stringify(config));
      await writeFile(path.join(statePath, ".dev.vars"), "");
      if (script === "preview") {
        await mkdir(path.join(statePath, ".wrangler/deploy"), { recursive: true });
        await writeFile(path.join(statePath, ".wrangler/deploy/config.json"), JSON.stringify({ configPath, auxiliaryWorkers: [] }));
      }
      shutdown.signal.throwIfAborted();
      await prepare?.({ statePath, configPath, origin, signal: shutdown.signal });
      shutdown.signal.throwIfAborted();
      return { origin, configPath };
    })();
    const { origin, configPath } = await preparing;
    shutdown.signal.throwIfAborted();
    const executable = process.platform === "win32" ? "npm.cmd" : "npm";
    child = spawn(executable, ["run", script, "--", "--host", "127.0.0.1", "--port", "0", "--strictPort"], {
      cwd, detached: detachedProcessGroup(),
      env: { ...env, SAME_PAGE_TEST_STATE: statePath, SAME_PAGE_TEST_RUN: runId, CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: configPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      rememberLog(logs, chunk);
      output = (output + String(chunk)).slice(-16_384);
      // Vite dev and preview print the actual bound address. Require a complete
      // loopback URL; readiness still verifies our per-run response header.
      const matches = [...output.replace(/\u001b\[[0-9;]*m/g, "").matchAll(/\bLocal:\s+(http:\/\/127\.0\.0\.1:(\d+))\//g)];
      const match = matches.at(-1);
      if (match && Number(match[2]) > 0 && Number(match[2]) <= 65_535 && match[1] !== origin) {
        backendOrigin = match[1];
        listener.forwardTo(Number(match[2]));
      }
    });
    child.stderr.on("data", (chunk) => rememberLog(logs, chunk));
    const controller = new AbortController();
    const failed = new Promise((_, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => reject(new Error(`Vite exited: ${code ?? signal}`)));
    });
    try {
      await Promise.race([waitForServer(origin, runId, timeoutMs, AbortSignal.any([controller.signal, shutdown.signal])), failed]);
    } finally { controller.abort(); }
    return { origin, backendOrigin, logs, stop };
  } catch (error) {
    // Capture ownership before stopping the child tree. A failed global setup
    // otherwise produces no test artifact and destroys the useful /proc state.
    await saveStartupFailure({ cwd, script, runId, child, listener, requestedPort: port, backendOrigin, logs, error }).catch(() => undefined);
    await stop();
    throw new Error(`Vite ${script} failed:\n${logs.join("")}`, { cause: error });
  }
}

async function ownedListener(port = 0) {
  let backendPort;
  const sockets = new Set();
  const track = socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    return socket;
  };
  // Forward raw TCP so HTTP headers/bodies, streaming, and WebSocket upgrades
  // retain their original bytes and origin. No test assertions are retried.
  const server = createServer({ allowHalfOpen: true }, socket => {
    track(socket);
    if (!backendPort) { socket.destroy(); return; }
    const upstream = track(connect({ host: "127.0.0.1", port: backendPort, allowHalfOpen: true }));
    socket.on("error", () => upstream.destroy());
    upstream.on("error", () => socket.destroy());
    socket.once("close", () => upstream.destroy());
    upstream.once("close", () => socket.destroy());
    socket.pipe(upstream).pipe(socket);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    forwardTo: port => { backendPort = port; },
    stop: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

async function saveStartupFailure({ cwd, script, runId, child, listener, requestedPort, backendOrigin, logs, error }) {
  const requestedOrigin = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65_535 ? `http://127.0.0.1:${requestedPort}` : undefined;
  const origins = [listener?.origin ?? requestedOrigin, backendOrigin].filter(Boolean);
  const owners = await Promise.all(origins.map(origin => new Promise(resolve => {
    execFile("ss", ["-ltnp", "sport", "=", `:${new URL(origin).port}`], { timeout: 1_000, maxBuffer: 16_384 }, (error, stdout) => {
      resolve({ origin, snapshot: stdout ?? "", ...(error ? { unavailable: error.code } : {}) });
    });
  })));
  // Capture only our child process group, without argv or environment values.
  // workerd may already own RPC sockets even when Vite has not printed a URL.
  const processList = await diagnosticCommand("ps", ["-eo", "pid=,ppid=,pgid=,comm="]);
  const processes = processList.output.split("\n").map(line => {
    const [pid, ppid, pgid, ...name] = line.trim().split(/\s+/);
    return { pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), name: name.join(" ") };
  }).filter(row => child?.pid && row.pgid === child.pid);
  const listeners = await diagnosticCommand("ss", ["-ltnp"]);
  const childListeners = listeners.output.split("\n").filter(line => processes.some(row => line.includes(`pid=${row.pid},`)));
  const evidence = { runId, script, parentPid: process.pid, childPid: child?.pid, node: process.version, error: String(error), origins, owners, processes, childListeners, diagnosticsUnavailable: [processList.unavailable, listeners.unavailable].filter(Boolean), logs };
  const directory = path.join(cwd, "artifacts/verification/server-startup");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${runId}.json`), JSON.stringify(evidence, null, 2));
  rememberLog(logs, `SERVER_STARTUP_FAILURE ${JSON.stringify({ ...evidence, logs: undefined })}\n`);
}

function diagnosticCommand(command, args) {
  return new Promise(resolve => execFile(command, args, { timeout: 1_000, maxBuffer: 256 * 1024 }, (error, stdout) => {
    resolve({ output: stdout ?? "", ...(error ? { unavailable: `${command}:${error.code}` } : {}) });
  }));
}

async function waitForServer(origin, runId, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline && !signal.aborted) {
    try {
      const response = await fetch(origin, { signal: AbortSignal.any([signal, AbortSignal.timeout(1_000)]) });
      if (response.ok && response.headers.get("x-same-page-test-server") === runId) return;
      lastError = new Error(`Unexpected server response: ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Vite server did not respond at ${origin}`, { cause: lastError });
}

function rememberLog(logs, chunk) {
  logs.push(String(chunk));
  if (logs.length > 40) logs.splice(10, 1);
}
