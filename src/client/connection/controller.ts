import { connectionPath, connectionRoutes, isPublicConnectionPath, type ConnectionMode, type ConnectionRoute } from "../../shared/connection";

import { completeGuestAdmission, guestEntryBudgetMs } from "./guest-admission";
import { untilAborted } from "../platform/abortable";

export type EntryReadiness = "unknown" | "ready" | "unprepared" | "conflict";
export interface RouteHealth { state: "unknown" | "reachable" | "unreachable"; checkedAt: number | null; latency: number | null }
export interface ConnectionSnapshot {
  mode: ConnectionMode;
  active: ConnectionRoute;
  checking: boolean;
  preparing: boolean;
  health: Record<ConnectionRoute, RouteHealth>;
  identity: Record<ConnectionRoute, EntryReadiness>;
}
export interface ConnectionOptions {
  origins: Record<ConnectionRoute, string>;
  pageOrigin: string;
  send: typeof fetch;
  now?: () => number;
  random?: () => number;
  changedIdentity?: (sessionId: string | null) => void;
  sessionId?: string | null;
}
const other = (route: ConnectionRoute): ConnectionRoute => route === "direct" ? "backup" : "direct";
const emptyHealth = (): RouteHealth => ({ state: "unknown", checkedAt: null, latency: null });
const abortError = () => new DOMException("Connection identity changed", "AbortError");
export class EntryIdentityConflictError extends Error {
  constructor() { super("entry_identity_conflict"); this.name = "EntryIdentityConflictError"; }
}

// One controller per page. Business callers keep ownership of reconciliation
// and idempotency; only reads and the explicitly stateless guest admission
// endpoint can fail over. Submitted business writes are never replayed.
export class ConnectionController {
  private snapshot: ConnectionSnapshot = { mode: "auto", active: "direct", checking: false, preparing: false,
    health: { direct: emptyHealth(), backup: emptyHealth() }, identity: { direct: "unknown", backup: "unknown" } };
  private listeners = new Set<() => void>();
  private failures = { direct: 0, backup: 0 };
  private cooldown = { direct: 0, backup: 0 };
  private recovery: number | null = null;
  private generation = 0;
  private sessionId: string | null;
  private preparation: Promise<void> | null = null;
  private preparationAbort = new AbortController();
  private probe: Promise<void> | null = null;
  private probeGeneration = 0;
  private guestPreparation: Promise<void> | null = null;
  private admissionAbort = new AbortController();
  private lastForegroundProbe = 0;
  private now: () => number;
  private random: () => number;

  constructor(private options: ConnectionOptions) {
    this.sessionId = options.sessionId ?? null;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<ConnectionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach(listener => listener());
  }
  setMode(mode: ConnectionMode) {
    this.generation++;
    this.preparationAbort.abort();
    this.preparationAbort = new AbortController();
    this.preparation = null;
    this.recovery = null;
    this.update({ mode, active: mode === "auto" ? this.availableRoute() : mode, preparing: false });
  }
  private availableRoute() {
    if (this.cooldown.direct > this.now()) return "backup";
    return this.snapshot.active === "backup" ? "backup" : "direct";
  }
  endpoint(path: string, route = this.snapshot.active) {
    const url = new URL(path, this.options.pageOrigin);
    if (url.origin !== this.options.pageOrigin || !url.pathname.startsWith("/api/") || url.pathname.startsWith("/api/_entry/")) return path;
    return `${this.options.origins[route]}${connectionPath(route, url.pathname)}${url.search}`;
  }
  nativeEndpoint(path: string) {
    if (isPublicConnectionPath(new URL(path, this.options.pageOrigin).pathname)) return this.endpoint(path);
    // Native media/download requests cannot inspect a credential response. Do
    // not send them to an unverified identity while manual preparation runs.
    if (this.snapshot.identity[this.snapshot.active] !== "ready") return this.endpoint("/api/connection/unprepared");
    const url = new URL(this.endpoint(path), this.options.pageOrigin);
    if (!url.pathname.startsWith("/api/_entry/")) return path;
    url.searchParams.set("_sp_session", this.sessionId ?? "none");
    return url.href;
  }
  async writeEndpoint(path: string, signal: AbortSignal) {
    const generation = this.generation;
    const route = this.snapshot.mode === "auto" ? this.availableRoute() : this.snapshot.mode;
    await this.authorize(route, AbortSignal.any([signal, AbortSignal.timeout(3000)]));
    if (generation !== this.generation) throw abortError();
    if (this.snapshot.mode === "auto" && route !== this.snapshot.active) this.update({ active: route });
    return this.nativeEndpoint(path);
  }
  async readEndpoint(path: string, signal: AbortSignal) {
    const url = new URL(path, this.options.pageOrigin);
    if (url.origin !== this.options.pageOrigin || !url.pathname.startsWith("/api/")) return path;
    if (this.snapshot.identity[this.snapshot.active] !== "ready") {
      const response = await this.fetch(path, { method: "HEAD", signal });
      if (!response.ok) throw Object.assign(new Error("native_file_unavailable"), { status: response.status });
    }
    return this.nativeEndpoint(path);
  }
  async recoverMedia(route: ConnectionRoute, signal?: AbortSignal) {
    this.reportFailure(route);
    const generation = this.generation;
    if (this.snapshot.mode !== "auto") return false;
    const target = other(route);
    try {
      await this.authorize(target, AbortSignal.any([AbortSignal.timeout(3000), ...(signal ? [signal] : [])]), true);
      if (generation !== this.generation || signal?.aborted || this.snapshot.mode !== "auto") return false;
      this.update({ active: target });
      return true;
    } catch { return false; }
  }
  reportFailure(route: ConnectionRoute) {
    this.failures[route]++;
    this.cooldown[route] = this.now() + Math.min(120_000, 15_000 * 2 ** Math.min(3, this.failures[route] - 1)) * (0.8 + this.random() * 0.4);
    if (route === "direct") this.recovery = null;
    this.update({ health: { ...this.snapshot.health, [route]: { state: "unreachable", checkedAt: this.now(), latency: null } } });
  }
  reportIdentityConflict(route: ConnectionRoute) {
    this.update({ identity: { ...this.snapshot.identity, [route]: "conflict" } });
  }
  private reachable(route: ConnectionRoute, elapsed: number) {
    this.failures[route] = 0;
    this.cooldown[route] = 0;
    this.update({ health: { ...this.snapshot.health, [route]: { state: "reachable", checkedAt: this.now(), latency: elapsed } } });
  }
  invalidateIdentity(sessionId: string | null = null) {
    this.generation++;
    this.sessionId = sessionId;
    this.preparationAbort.abort();
    this.preparationAbort = new AbortController();
    this.preparation = null;
    this.update({ preparing: false, identity: { direct: "unknown", backup: "unknown" } });
  }
  acceptIdentity(sessionId: string) {
    if (this.sessionId !== sessionId) this.invalidateIdentity(sessionId);
    this.options.changedIdentity?.(sessionId);
    this.update({ identity: { ...this.snapshot.identity, [this.snapshot.active]: "ready" } });
    void this.prepare(this.snapshot.active);
  }
  private raw = (route: ConnectionRoute, path: string, init?: RequestInit) => this.options.send(this.endpoint(path, route), {
    ...init, credentials: "include", cache: "no-store", redirect: "error",
  });
  private async status(route: ConnectionRoute, signal: AbortSignal) {
    const response = await this.raw(route, "/api/connection/status", { signal });
    if (!response.ok) throw new Error("entry_status_unavailable");
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("sessionId" in body) || body.sessionId !== null && typeof body.sessionId !== "string") throw new Error("invalid_entry_status");
    return body.sessionId;
  }
  private async authorize(route: ConnectionRoute, signal: AbortSignal, fresh = false) {
    if (!fresh && this.snapshot.identity[route] === "ready") return;
    const expected = this.sessionId, started = this.generation;
    const actual = await this.status(route, signal);
    if (started !== this.generation) throw abortError();
    this.update({ identity: { ...this.snapshot.identity, [route]: actual === expected ? "ready" : actual ? "conflict" : "unprepared" } });
    if (actual !== expected) throw new EntryIdentityConflictError();
  }
  prepare(source: ConnectionRoute) {
    if (!this.sessionId) return Promise.resolve();
    if (this.preparation) return this.preparation;
    const target = other(source), expected = this.sessionId, generation = this.generation;
    const signal = AbortSignal.any([this.preparationAbort.signal, AbortSignal.timeout(6000)]);
    this.update({ preparing: true });
    const current = () => { if (generation !== this.generation || signal.aborted) throw abortError(); };
    const post = async (route: ConnectionRoute, path: string, body?: unknown) => {
      current();
      const response = await this.raw(route, `/api/connection/${path}`, { method: "POST", signal,
        headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
      if (!response.ok) throw new Error("entry_preparation_failed");
      const result: unknown = await response.json();
      current();
      return result;
    };
    const work = (async () => {
      try {
        const actual = await this.status(target, signal);
        current();
        if (actual && actual !== expected) {
          this.update({ identity: { ...this.snapshot.identity, [target]: "conflict" } });
          return;
        }
        if (actual !== expected) {
          const flow = await post(target, "begin");
          if (!flow || typeof flow !== "object" || !("flow" in flow) || typeof flow.flow !== "string") throw new Error("invalid_exchange");
          const issued = await post(source, "issue", { flow: flow.flow, sessionId: expected });
          if (!issued || typeof issued !== "object" || !("code" in issued) || typeof issued.code !== "string") throw new Error("invalid_exchange");
          await post(target, "redeem", { flow: flow.flow, code: issued.code, sessionId: expected });
        }
        if (await this.status(target, signal) !== expected) throw new EntryIdentityConflictError();
        current();
        this.update({ identity: { ...this.snapshot.identity, [source]: "ready", [target]: "ready" } });
      } catch {
        if (generation === this.generation && this.snapshot.identity[target] !== "conflict") this.update({ identity: { ...this.snapshot.identity, [target]: "unprepared" } });
      } finally {
        if (generation === this.generation) { this.preparation = null; this.update({ preparing: false }); }
      }
    })();
    this.preparation = work;
    return work;
  }
  check = (): Promise<void> => {
    if (this.probe) {
      const requestedGeneration = this.generation;
      return this.probe.then((): void | Promise<void> => {
        if (requestedGeneration === this.generation && this.probeGeneration !== requestedGeneration) return this.check();
      });
    }
    this.update({ checking: true });
    const generation = this.generation;
    this.probeGeneration = generation;
    this.probe = Promise.all(connectionRoutes.map(async route => {
      const start = this.now();
      let healthConfirmed = false;
      try {
        const response = await this.raw(route, "/api/health", { signal: AbortSignal.timeout(3000) });
        const body: unknown = response.ok ? await response.json() : null;
        if (!body || typeof body !== "object" || !("status" in body) || body.status !== "ok") throw new Error("unhealthy");
        this.reachable(route, this.now() - start);
        healthConfirmed = true;
        if (generation === this.generation) await this.authorize(route, AbortSignal.timeout(2000), true);
      } catch (error) {
        if (error instanceof EntryIdentityConflictError) return;
        if (healthConfirmed) this.update({ identity: { ...this.snapshot.identity, [route]: "unprepared" } });
        else this.reportFailure(route);
      }
    })).then(async () => {
      if (generation !== this.generation) return;
      if (this.snapshot.mode === "auto") {
        const { health, identity } = this.snapshot;
        const usable = (route: ConnectionRoute) => health[route].state === "reachable" && identity[route] === "ready";
        if (this.snapshot.active === "direct" && !usable("direct") && usable("backup")) this.update({ active: "backup" });
        else if (this.snapshot.active === "backup" && usable("direct")) {
          // Two foreground confirmations separated by at least 10 seconds.
          if (this.recovery !== null && this.now() - this.recovery >= 10_000) { this.update({ active: "direct" }); this.recovery = null; }
          else if (this.recovery === null) this.recovery = this.now();
        }
      }
      // Authentication preparation is control-plane work, independent of a
      // pinned business route. A missing direct cookie can be prepared from a
      // still-valid backup even when the user has just pinned direct.
      const source = connectionRoutes.find(route => this.snapshot.identity[route] === "ready" && this.snapshot.health[route].state === "reachable");
      if (this.sessionId && source) await this.prepare(source);
    }).finally(() => { this.probe = null; this.update({ checking: false }); });
    return this.probe;
  };

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, this.options.pageOrigin);
    if (url.origin !== this.options.pageOrigin || !url.pathname.startsWith("/api/") || url.pathname.startsWith("/api/_entry/")) return this.options.send(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const read = method === "GET" || method === "HEAD";
    const admission = method === "POST" && url.pathname === "/api/guest/session";
    const bounded = read || admission;
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : null);
    callerSignal?.throwIfAborted();
    if (admission || method === "DELETE" && url.pathname === "/api/guest/session") {
      this.admissionAbort.abort();
      this.admissionAbort = new AbortController();
      this.guestPreparation = null;
    }
    const admissionSignal = this.admissionAbort.signal;
    const authMutation = url.pathname.startsWith("/api/auth/") && !read;
    if (authMutation) this.invalidateIdentity(this.sessionId);
    const generation = this.generation;
    const sessionRead = url.pathname === "/api/auth/get-session";
    const activeAtStart = this.snapshot.active;
    if (read && this.snapshot.mode === "auto" && activeAtStart === "backup" && this.cooldown.direct <= this.now() && this.now() - this.lastForegroundProbe >= 30_000) {
      this.lastForegroundProbe = this.now();
      void this.check();
    }
    // On a new page, inspect that page's own cookie first. A different login on
    // the other host must not silently become this page's local owner.
    const route = sessionRead && !this.sessionId && this.snapshot.mode === "auto"
      ? this.options.pageOrigin === this.options.origins.backup ? "backup" : "direct"
      : this.snapshot.mode === "auto" ? this.availableRoute() : this.snapshot.mode;
    const choices = this.snapshot.mode === "auto" && bounded && this.cooldown[other(route)] <= this.now() ? [route, other(route)] : [route];
    const budget = new AbortController();
    const budgetTimer = bounded ? setTimeout(() => budget.abort(new DOMException("Connection deadline", "TimeoutError")), guestEntryBudgetMs) : undefined;
    let missingSessions = 0;
    try {
    for (let index = 0; index < choices.length; index++) {
      const chosen = choices[index];
      const attempt = new AbortController();
      const attemptTimer = bounded ? setTimeout(() => attempt.abort(new DOMException("Connection timeout", "TimeoutError")), 4000) : undefined;
      const signal = bounded ? AbortSignal.any([budget.signal, attempt.signal, ...(callerSignal ? [callerSignal] : []), ...(admission ? [admissionSignal, this.preparationAbort.signal] : [])]) : callerSignal;
      const start = this.now();
      try {
        if (read && index > 0 && this.guestPreparation) await this.guestPreparation;
        if (!this.sessionId && url.pathname === "/api/user/lifecycle" && this.options.origins[chosen] === this.options.pageOrigin) {
          // The product get-session intentionally hides recovery-only users.
          // Inspect this page's own native credential for the lifecycle screen;
          // this never accepts a local workspace owner or bypasses permission.
          const credential = await this.status(chosen, signal ?? AbortSignal.timeout(2000));
          if (generation !== this.generation) throw abortError();
          if (credential) this.sessionId = credential;
        }
        if (chosen !== this.snapshot.active || this.snapshot.identity[chosen] !== "ready") {
          if (!isPublicConnectionPath(url.pathname) && (this.sessionId || chosen !== "direct")) await this.authorize(chosen, signal ?? AbortSignal.timeout(3000));
        }
        if (generation !== this.generation) throw abortError();
        const endpoint = this.endpoint(`${url.pathname}${url.search}`, chosen);
        // Admission has a small JSON payload, so recreate it as text rather
        // than forwarding a consumed Request stream when trying the fallback.
        const source = input instanceof Request ? admission
          ? new Request(endpoint, { method, headers: input.headers, body: await untilAborted(input.clone().text(), signal!) })
          : new Request(endpoint, input) : endpoint;
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (isPublicConnectionPath(url.pathname)) headers.delete("X-Same-Page-Session");
        else headers.set("X-Same-Page-Session", this.sessionId ?? "none");
        const credentials = init?.credentials ?? (input instanceof Request ? input.credentials : undefined);
        const sending = this.options.send(source, { ...init, headers, credentials: credentials === "omit" ? "omit" : "include", redirect: "error", ...(signal ? { signal } : {}) });
        let response = await (admission ? untilAborted(sending, signal!) : sending);
        if (admission && response.ok) response = await completeGuestAdmission(response, signal!);
        // Reads bound connection setup, not an entire 20 MB file transfer.
        // Stateless admission also bounds its small, validated JSON body.
        clearTimeout(attemptTimer);
        if (bounded && generation !== this.generation) throw abortError();
        if (admission) signal!.throwIfAborted();
        // Any HTTP response is proof of a route, including permission errors.
        // A shared backend 5xx does not justify replaying a business operation.
        this.reachable(chosen, this.now() - start);
        if (response.headers.get("X-Same-Page-Entry-Conflict") === "1") this.reportIdentityConflict(chosen);
        if (sessionRead && response.ok) {
          const body: unknown = await response.clone().json();
          if (generation !== this.generation) throw abortError();
          const id = body && typeof body === "object" && "session" in body && body.session && typeof body.session === "object" && "id" in body.session && typeof body.session.id === "string" ? body.session.id : null;
          if (this.sessionId && id && id !== this.sessionId) throw new EntryIdentityConflictError();
          if (!this.sessionId && index > 0 && id) throw new EntryIdentityConflictError();
          if (!id && this.sessionId) {
            const credential = await this.status(chosen, signal ?? AbortSignal.timeout(2000));
            if (generation !== this.generation) throw abortError();
            if (credential === this.sessionId) {
              this.update({ identity: { ...this.snapshot.identity, [chosen]: "ready" } });
              if (this.snapshot.mode === "auto" && this.snapshot.active === activeAtStart) this.update({ active: chosen });
              return response;
            }
          }
          // A missing cookie on one entry is not proof that the common session
          // was revoked. Recover only the previously accepted exact session.
          if (!id) missingSessions++;
          if (!id && this.sessionId && index + 1 < choices.length) continue;
          if (!id && this.sessionId && missingSessions < 2) {
            this.update({ identity: { ...this.snapshot.identity, [chosen]: "unprepared" } });
            return Response.json({ error: "entry_session_unprepared" }, { status: 503 });
          }
          if (!id && this.sessionId && missingSessions === 2) { this.invalidateIdentity(); this.options.changedIdentity?.(null); }
          if (id === this.sessionId && id) this.update({ identity: { ...this.snapshot.identity, [chosen]: "ready" } });
          // LocalIdentityObserver prepares credentials only after the existing
          // logout fence has accepted the session and its workspace ownership.
        }
        if (generation === this.generation && this.snapshot.mode === "auto" && this.snapshot.active === activeAtStart && chosen !== activeAtStart) this.update({ active: chosen });
        if (authMutation && generation === this.generation && response.ok && /\/(sign-out|sign-in\/(?:email|social)|registration\/complete)$/.test(url.pathname)) {
          this.invalidateIdentity(); this.options.changedIdentity?.(null);
          if (/\/(?:sign-in\/email|registration\/complete)$/.test(url.pathname)) {
            const establishedGeneration = this.generation;
            const credential = await this.status(chosen, AbortSignal.timeout(2000)).catch(() => null);
            if (credential && establishedGeneration === this.generation) {
              this.sessionId = credential;
              this.update({ identity: { ...this.snapshot.identity, [chosen]: "ready" } });
            }
          }
        }
        // This endpoint issues only a stateless guest cookie. It neither joins
        // a membership nor creates business data, so preparing both entries is
        // safe. Never generalize this exception to arbitrary POSTs.
        if (generation === this.generation && admission && response.ok) {
          const body = init?.body ?? (input instanceof Request ? await untilAborted(input.clone().text(), signal!) : undefined);
          signal!.throwIfAborted();
          if (this.sessionId) {
            // Explicit, validated guest admission may leave an expired login;
            // it must not make guest files carry that obsolete session guard.
            const actual = await untilAborted(this.status(chosen, AbortSignal.any([signal!, AbortSignal.timeout(2000)])), signal!).catch(() => undefined);
            signal!.throwIfAborted();
            if (generation !== this.generation) return response;
            if (actual === null) { this.invalidateIdentity(); this.options.changedIdentity?.(null); }
          }
          this.update({ identity: { ...this.snapshot.identity, [chosen]: "ready" } });
          // Prepare a healthy second entry, but do not immediately retry the
          // just-failed route again after a successful failover.
          if (this.cooldown[other(chosen)] <= this.now()) {
            const preparation = this.raw(other(chosen), url.pathname, { ...init, body, headers,
              signal: AbortSignal.any([admissionSignal, this.preparationAbort.signal, AbortSignal.timeout(3000)]) })
              .then(() => undefined, () => undefined);
            this.guestPreparation = preparation;
            void preparation.finally(() => { if (this.guestPreparation === preparation) this.guestPreparation = null; });
          }
        }
        if (url.pathname === "/api/guest/session" && method === "DELETE" && response.ok &&
          !callerSignal?.aborted && !admissionSignal.aborted && generation === this.generation) {
          await this.raw(other(chosen), url.pathname, { method: "DELETE",
            signal: AbortSignal.any([admissionSignal, this.preparationAbort.signal, ...(callerSignal ? [callerSignal] : []), AbortSignal.timeout(3000)]) }).catch(() => undefined);
        }
        return response;
      } catch (error) {
        if (callerSignal?.aborted || generation !== this.generation || error instanceof EntryIdentityConflictError || error instanceof DOMException && error.name === "AbortError" && !signal?.aborted) throw error;
        const ownTimeout = attempt.signal.aborted || budget.signal.aborted;
        if (!ownTimeout && !(error instanceof TypeError) && !(error instanceof DOMException && error.name === "TimeoutError")) throw error;
        this.reportFailure(chosen);
        if (index + 1 === choices.length || budget.signal.aborted) throw error;
      } finally {
        clearTimeout(attemptTimer);
      }
    }
    throw new Error("connection_unavailable");
    } finally { clearTimeout(budgetTimer); }
  };
}
