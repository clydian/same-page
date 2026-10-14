import { spawn } from "node:child_process";
import process from "node:process";

import { describe, expect, it, vi } from "vitest";

import {
  detachedProcessGroup,
  stopChildProcessTree,
} from "./process-lifecycle.mjs";

describe("child process lifecycle", () => {
  it("waits for an isolated long-running process to exit", async () => {
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => undefined, 1000)"],
      { detached: detachedProcessGroup(), stdio: "ignore" },
    );

    await stopChildProcessTree(child);

    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });
});

it("cleans a descendant even after its launcher exits", async () => {
  if (process.platform === "win32") return;
  const child = spawn(process.execPath, ["-e", `const {spawn}=require('node:child_process'); const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(p.pid); p.unref();`], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const pid = await new Promise((resolve) => child.stdout.once("data", (chunk) => resolve(Number(String(chunk).trim()))));
  await new Promise((resolve) => child.once("exit", resolve));
  try {
    await stopChildProcessTree(child, 300);
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    try { process.kill(pid, "SIGKILL"); } catch { /* already stopped */ }
  }
});

it("waits for group disappearance after a temporarily denied existence probe", async () => {
  if (process.platform === "win32") return;
  const child = spawn(process.execPath, ["-e", "console.log('ready'); setInterval(()=>{},1000)"], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise(resolve => child.stdout.once("data", resolve));
  const kill = process.kill.bind(process);
  let terminated = false;
  let denied = false;
  const probe = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    if (pid === -child.pid && signal === 0 && terminated && !denied) {
      denied = true;
      throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
    }
    const result = kill(pid, signal);
    if (pid === -child.pid && signal === "SIGTERM") terminated = true;
    return result;
  });
  try {
    await stopChildProcessTree(child, 300);
    expect(denied).toBe(true);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  } finally {
    probe.mockRestore();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});

it("still reports a denied termination signal", async () => {
  if (process.platform === "win32") return;
  const child = spawn(process.execPath, ["-e", "console.log('ready'); setInterval(()=>{},1000)"], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise(resolve => child.stdout.once("data", resolve));
  const kill = process.kill.bind(process);
  const denied = Object.assign(new Error("kill EPERM"), { code: "EPERM" });
  const probe = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    if (pid === -child.pid && signal === "SIGTERM") throw denied;
    return kill(pid, signal);
  });
  try {
    await expect(stopChildProcessTree(child, 300)).rejects.toBe(denied);
  } finally {
    probe.mockRestore();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});
