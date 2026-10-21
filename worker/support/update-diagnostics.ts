import { Hono } from "hono";
import type { AppEnvironment } from "../env";
import { buildId } from "../../src/shared/build";
import { safeBuildId } from "../../src/shared/diagnostics";
import { applicationShellBudgetBytes } from "../../src/shared/update-diagnostics";
import html from "./update-diagnostics.html?raw";
import script from "./update-diagnostics-browser.js?raw";

export const updateDiagnosticRoutes = new Hono<AppEnvironment>();
updateDiagnosticRoutes.use("/support/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  c.header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
});
// /api is deliberately excluded by released service workers. Old applications
// can load this page and script without first accepting a new application shell.
updateDiagnosticRoutes.get("/support/update", c => c.html(html.replace("__BUILD__", safeBuildId(buildId) ?? "development").replace("__BUDGET__", String(applicationShellBudgetBytes))));
updateDiagnosticRoutes.get("/support/update-diagnostics.js", c => c.body(script, 200, { "Content-Type": "text/javascript; charset=utf-8" }));
