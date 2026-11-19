import { getMessages, getCurrentLocale } from "../../i18n";
import { connectionFetch } from "../connection/connection";
import { releaseChannelDiagnostics } from "../updates/release-channel";
import { diagnosticReceiptSchema, diagnosticReportSchema, type DiagnosticReader, type DiagnosticReport } from "../../shared/diagnostic-report";
import { exportDiagnostics, subscribeDiagnosticReset } from "./diagnostics";
import { buildId, buildVersion } from "../../shared/build";
import { currentUpdateFailure } from "../updates/update-diagnostics";

// Only parsed, bounded tokens leave this function; never retain a raw user agent.
const systemText = (key: string) => getMessages(getCurrentLocale(), "system")(key);

export function diagnosticEnvironment(ua = navigator.userAgent): DiagnosticReport["environment"] {
  const browserPatterns = [
    ["edge", /(?:Edg|EdgiOS|EdgA)\/([\d.]+)/], ["firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
    ["chrome", /(?:Chrome|CriOS)\/([\d.]+)/], ["safari", /Version\/([\d.]+).*Safari/],
  ] as const;
  const systemPatterns = [
    ["ios", /(?:iPhone OS|CPU OS) ([\d_]+)/], ["android", /Android ([\d.]+)/],
    ["macos", /Mac OS X ([\d_.]+)/], ["windows", /Windows NT ([\d.]+)/],
  ] as const;
  const browser = browserPatterns.find(([, pattern]) => pattern.test(ua));
  const system = systemPatterns.find(([, pattern]) => pattern.test(ua));
  const safeVersion = (value?: string) => value && /^\d{1,4}(?:[._]\d{1,6}){0,3}$/.test(value) ? value.replaceAll("_", ".") : null;
  // iPadOS may advertise a desktop Mac UA. Detect the family without inventing its OS version.
  const desktopIPad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return {
    browser: browser?.[0] ?? "unknown", browserVersion: safeVersion(browser?.[1].exec(ua)?.[1]),
    system: desktopIPad ? "ios" : system?.[0] ?? (/Linux/.test(ua) ? "linux" : "unknown"),
    systemVersion: desktopIPad ? null : safeVersion(system?.[1].exec(ua)?.[1]),
    viewportWidth: Math.min(32768, Math.max(0, Math.round(window.innerWidth))),
    viewportHeight: Math.min(32768, Math.max(0, Math.round(window.innerHeight))),
    standalone: window.matchMedia?.("(display-mode: standalone)").matches === true || ("standalone" in navigator && navigator.standalone === true),
    serviceWorkerControlled: !!navigator.serviceWorker?.controller,
    onlineHint: navigator.onLine,
  };
}

export function captureDiagnosticReport(description: string, reader: DiagnosticReader | null, id = crypto.randomUUID()): DiagnosticReport {
  return diagnosticReportSchema.parse({ ...JSON.parse(exportDiagnostics()), id,
    ...(/^v\d{2}\.\d{2}\.\d{2}\.\d{4}$/.test(buildVersion) ? { clientVersion: buildVersion } : {}),
    ...((currentUpdateFailure() || releaseChannelDiagnostics()) ? { update: { ...(currentUpdateFailure() ? { failure: currentUpdateFailure() } : {}), ...(releaseChannelDiagnostics() ? { release: { ...releaseChannelDiagnostics()!, running: buildId } } : {}) } } : {}),
    retentionDays: 180, description, environment: diagnosticEnvironment(), reader });
}

type Submission = {
  description: string;
  report: DiagnosticReport | null;
  phase: "idle" | "sending" | "failed" | "sent";
  message: string;
};
const empty = (): Submission => ({ description: "", report: null, phase: "idle", message: "" });
let state = empty();
let epoch = 0;
let pending: AbortController | null = null;
let reportDispatched = false;
const listeners = new Set<() => void>();
function update(next: Submission) { state = next; for (const listener of listeners) listener(); }
export const getDiagnosticSubmission = () => state;
export function subscribeDiagnosticSubmission(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function resetDiagnosticSubmission() {
  epoch += 1;
  pending?.abort();
  pending = null;
  reportDispatched = false;
  update(empty());
}
subscribeDiagnosticReset(resetDiagnosticSubmission);
export function setDiagnosticDescription(description: string) {
  if (state.report || state.phase !== "idle") return;
  update({ ...state, description: description.slice(0, 1000) });
}

export async function sendDiagnosticReport(reader: DiagnosticReader | null) {
  if (state.phase === "sending" || state.phase === "sent") return;
  let report: DiagnosticReport;
  try { report = state.report ?? captureDiagnosticReport(state.description, reader); }
  catch { update({ ...state, message: systemText("diagnosticSubmission.prepareFailed") }); return; }
  const started = ++epoch;
  update({ ...state, report, phase: "sending", message: systemText("diagnosticSubmission.sending") });
  const controller = new AbortController();
  pending = controller;
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    if (!navigator.onLine) throw new Error("offline");
    // Deliberately outside diagnosticFetch: a failed submission must not report itself or retry business writes.
    const allowLegacy = !reportDispatched;
    const submit = () => {
      reportDispatched = true;
      return connectionFetch("/api/diagnostic-reports", { method: "POST", credentials: "omit", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(report), signal: controller.signal });
    };
    let response = await submit();
    if (started !== epoch) return;
    // A cached new client may meet a rolled-back Worker with the old strict
    // schema. Only the first dispatch being explicitly rejected permits a legacy retry;
    // uncertain delivery always retains the exact previously sent payload/id.
    if (allowLegacy && response.status === 400 && (report.update || report.retentionDays || report.clientVersion || report.reader?.opening || report.records.some(record => record.opening || record.render))) {
      report = { ...report, reader: report.reader ? { interactionMode: report.reader.interactionMode, pendingCount: report.reader.pendingCount, conflictCount: report.reader.conflictCount } : null,
        records: report.records.map(record => { const legacy = { ...record }; delete legacy.opening; delete legacy.render; return legacy; }) };
      delete report.clientVersion;
      delete report.retentionDays;
      delete report.update;
      update({ ...state, report });
      response = await submit();
      if (started !== epoch) return;
    }
    if (response.status === 410) {
      update({ ...state, phase: "failed", message: systemText("diagnosticSubmission.deleted") });
      return;
    }
    if (response.status === 429) {
      update({ ...state, phase: "failed", message: systemText("diagnosticSubmission.throttled") });
      return;
    }
    if (!response.ok) throw new Error("unconfirmed");
    const receipt = diagnosticReceiptSchema.parse(await response.json());
    if (started !== epoch) return;
    if (receipt.id !== report.id) throw new Error("invalid_receipt");
    update({ ...state, phase: "sent", message: report.retentionDays ? systemText("diagnosticSubmission.sent") : systemText("diagnosticSubmission.sentLegacy") });
  } catch {
    if (started !== epoch) return;
    update({ ...state, phase: "failed", message: navigator.onLine
      ? systemText("diagnosticSubmission.unconfirmed")
      : systemText("diagnosticSubmission.offlineUnconfirmed") });
  } finally {
    clearTimeout(timeout);
    if (started === epoch) pending = null;
  }
}
