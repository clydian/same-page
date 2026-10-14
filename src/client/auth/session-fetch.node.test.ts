import { expect, it, vi } from "vitest";
import { createSessionFetch } from "./session-fetch";

it("preserves cancellation supplied by a session Request", async () => {
  const controller = new AbortController();
  let finish!: (response: Response) => void;
  const transport = vi.fn<typeof fetch>((_input, init) => new Promise((resolve, reject) => {
    finish = resolve;
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  }));
  const acceptSession = vi.fn(async (response: Response) => response.clone());
  const fetchSession = createSessionFetch(transport, acceptSession);
  const pending = fetchSession(new Request("https://app.test/api/auth/get-session", { signal: controller.signal }));
  const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  finish(Response.json({ user: { id: "a" } }));
  await rejection;
  expect(acceptSession).not.toHaveBeenCalled();
});

it.each([new AbortController().signal, null])("uses an explicit init signal (%s) in preference to the Request signal", async signal => {
  const controller = new AbortController();
  controller.abort();
  const transport = vi.fn<typeof fetch>(async (_input, init) => {
    init?.signal?.throwIfAborted();
    return Response.json({ user: { id: "a" } });
  });
  const fetchSession = createSessionFetch(transport);
  const response = await fetchSession(new Request("https://app.test/api/auth/get-session", { signal: controller.signal }), { signal });
  expect(await response.json()).toEqual({ user: { id: "a" } });
});

it("does not deliver an old session response after a sign-in changes identity", async () => {
  let finish!: (response: Response) => void;
  const transport = vi.fn<typeof fetch>()
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(Response.json({ ok: true }))
    .mockResolvedValueOnce(Response.json({ user: { id: "b" } }));
  const fetchSession = createSessionFetch(transport);
  const old = fetchSession("https://app.test/api/auth/get-session");
  await fetchSession("https://app.test/api/auth/sign-in/email", { method: "POST" });
  const fresh = await fetchSession("https://app.test/api/auth/get-session");
  finish(Response.json({ user: { id: "a" } }));
  expect(await fresh.json()).toEqual({ user: { id: "b" } });
  expect(await (await old).json()).toEqual({ user: { id: "b" } });
});

it("a late failure cannot overwrite a newer successful session query", async () => {
  let fail!: (error: Error) => void;
  const transport = vi.fn<typeof fetch>()
    .mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }))
    .mockResolvedValueOnce(Response.json({ user: { id: "a" } }));
  const fetchSession = createSessionFetch(transport);
  const old = fetchSession("https://app.test/api/auth/get-session");
  const fresh = await fetchSession("https://app.test/api/auth/get-session");
  await fresh.json();
  fail(new TypeError("offline"));
  expect(await (await old).json()).toEqual({ user: { id: "a" } });
});
