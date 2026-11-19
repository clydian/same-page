import { Hono } from "hono";
import type { AppEnvironment } from "../env";
import { buildId } from "../../src/shared/build";
import { safeBuildId } from "../../src/shared/diagnostics";
import { applicationShellReleaseLimitBytes } from "../../src/shared/update-diagnostics";
import { isAppLocale, localeFromAcceptLanguage, type AppLocale } from "../../src/i18n/locales";
import de from "../../src/i18n/messages/de/updateSupport.json";
import en from "../../src/i18n/messages/en/updateSupport.json";
import es419 from "../../src/i18n/messages/es-419/updateSupport.json";
import fr from "../../src/i18n/messages/fr/updateSupport.json";
import it from "../../src/i18n/messages/it/updateSupport.json";
import ja from "../../src/i18n/messages/ja/updateSupport.json";
import ko from "../../src/i18n/messages/ko/updateSupport.json";
import ptBR from "../../src/i18n/messages/pt-BR/updateSupport.json";
import zhHans from "../../src/i18n/messages/zh-Hans/updateSupport.json";
import zhHantTW from "../../src/i18n/messages/zh-Hant-TW/updateSupport.json";
import { renderUpdateDiagnostics, renderUpdateDiagnosticsScript } from "./update-diagnostics-render";
import html from "./update-diagnostics.html?raw";
import script from "./update-diagnostics-browser.js?raw";

const messages = { de, en, "es-419": es419, fr, it, ja, ko, "pt-BR": ptBR, "zh-Hans": zhHans, "zh-Hant-TW": zhHantTW } satisfies Record<AppLocale, typeof zhHans>;
const supportScript = renderUpdateDiagnosticsScript(script, zhHans);

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
updateDiagnosticRoutes.get("/support/update", c => {
  const requested = c.req.query("lang");
  const locale = isAppLocale(requested) ? requested : localeFromAcceptLanguage(c.req.header("Accept-Language"));
  return c.html(renderUpdateDiagnostics(html, messages[locale], locale, safeBuildId(buildId) ?? "development", applicationShellReleaseLimitBytes));
});
updateDiagnosticRoutes.get("/support/update-diagnostics.js", c => c.body(supportScript, 200, { "Content-Type": "text/javascript; charset=utf-8" }));
