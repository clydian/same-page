import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { withBrowserEvidence } from "../browser-tests/browser-evidence.mjs";

it("preserves the test failure and releases tracing/listeners when evidence cannot be written", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "browser-evidence-"));
  const context = new EventEmitter();
  const page = new EventEmitter();
  context.pages = () => [page];
  context.tracing = { start: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const blocked = path.join(directory, "blocked");
    await writeFile(blocked, "A file prevents creation of the evidence directory.");
    const original = new Error("original browser assertion");
    await expect(withBrowserEvidence(context, blocked, async () => { throw original; })).rejects.toBe(original);
    expect(context.tracing.stop).toHaveBeenCalledOnce();
    expect(context.listenerCount("page")).toBe(0);
    expect(page.listenerCount("pageerror")).toBe(0);
    expect(warning).toHaveBeenCalledOnce();
  } finally {
    warning.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});
