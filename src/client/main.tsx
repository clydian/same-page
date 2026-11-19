import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { buildId } from "../shared/build";
import { applyLocale, getInitialLocale, rememberLocale } from "../i18n/browser-locale";
import { loadLocale } from "../i18n/catalogs";
import { sourceLocale } from "../i18n/locales";
import { AppLocaleProvider } from "../i18n/provider";
import { App } from "./app";
import { getLoadingPerformanceSnapshot } from "./performance/loading-performance";
import { getDriveLibraryCacheDiagnostics } from "./score-library/drive-library-cache";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root element");
}

document.documentElement.dataset.buildId = buildId;
Object.defineProperty(window, "__SAME_PAGE_DIAGNOSTICS__", {
  configurable: false,
  value: Object.freeze({
    buildId,
    driveLibraryCache: getDriveLibraryCacheDiagnostics,
    loadingPerformance: getLoadingPerformanceSnapshot,
  }),
  writable: false,
});

const preferredLocale = getInitialLocale();
void loadLocale(preferredLocale).then((loaded) => {
  const initialLocale = loaded ? preferredLocale : sourceLocale;
  applyLocale(initialLocale);
  rememberLocale(preferredLocale);
  createRoot(root).render(
    <StrictMode>
      <AppLocaleProvider initialLocale={initialLocale} initialLoadFailed={!loaded}><App /></AppLocaleProvider>
    </StrictMode>,
  );
});
