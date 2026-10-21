import { env, exports } from "cloudflare:workers";
import { expect, it } from "vitest";

it("serves independent support HTML and script without authentication or application assets", async () => {
  const html = await exports.default.fetch(new Request("https://same-page.test/api/support/update"));
  expect(html.status).toBe(200);
  expect(html.headers.get("content-type")).toContain("text/html");
  expect(html.headers.get("cache-control")).toBe("no-store");
  expect(html.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  const body = await html.text();
  expect(body).toContain("/api/support/update-diagnostics.js");
  expect(body).not.toContain("__BUILD__");
  expect(body).not.toContain("/assets/");
  const script = await exports.default.fetch(new Request("https://same-page.test/api/support/update-diagnostics.js"));
  expect(script.status).toBe(200);
  expect(script.headers.get("content-type")).toContain("javascript");
  expect(script.headers.get("cache-control")).toBe("no-store");
});

it("stores extended update observations through the existing explicit feedback endpoint", async () => {
  const id = crypto.randomUUID();
  const update = { failure: { reason: "capacity-protected", buildId: "abcdef1" } };
  const response = await exports.default.fetch(new Request("https://same-page.test/api/diagnostic-reports", {
    method: "POST", headers: { Origin: "https://same-page.test", "Content-Type": "application/json" },
    body: JSON.stringify({ id, version: 1, clientBuild: "abcdef0", description: "独立更新诊断", retentionDays: 180,
      environment: { browser: "chrome", browserVersion: "155.0.0.0", system: "android", systemVersion: "10", viewportWidth: 369, viewportHeight: 762, standalone: true, serviceWorkerControlled: true, onlineHint: true },
      reader: null, records: [], update }),
  }));
  expect(response.status).toBe(201);
  const stored = await env.DB.prepare("SELECT payload FROM diagnostic_reports WHERE id=?").bind(id).first<{ payload: string }>();
  expect(JSON.parse(stored!.payload).update).toEqual(update);
});
