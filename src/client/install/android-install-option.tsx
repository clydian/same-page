import { useAppLocale, useMessages } from "../../i18n";
import { connectionFetch, connectionUrl } from "../connection/connection";
import { useEffect, useState, type ReactNode } from "react";
import { androidReleaseSchema, type AndroidRelease } from "../../shared/android-release";

/** Mounted only in external Android browsers, after the user opens installation. */
export function AndroidInstallOption({ children }: { children: ReactNode }) {
  const t = useMessages("system");
  const { locale } = useAppLocale();
  const [release, setRelease] = useState<AndroidRelease | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void connectionFetch("/api/android-release", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) return;
        const data: { release?: unknown } = await response.json();
        const parsed = androidReleaseSchema.safeParse(data.release);
        if (!controller.signal.aborted && parsed.success) setRelease(parsed.data);
      }).catch(() => { /* The existing PWA choice remains available offline. */ });
    return () => controller.abort();
  }, []);
  if (!release) return children;
  return <div className="install-choices">
    <p className="install-choice-intro">{t("androidInstallOption.choose")}</p>
    <section className="install-choice" aria-label={t("androidInstallOption.installBrowser")}>
      <h3>{t("androidInstallOption.installBrowser")}</h3>
      <p className="install-choice-description">{t("androidInstallOption.addIcon")}</p>
      {children}
    </section>
    <div className="install-choice-or">{t("androidInstallOption.or")}</div>
    <section className="install-choice" aria-label={t("androidInstallOption.apk")}>
    <h3>{t("androidInstallOption.installApk")}</h3>
    <p className="install-choice-description">{t("androidInstallOption.apkDescription")}</p>
    <a className="primary-button install-native" href={connectionUrl("/api/android-release/apk")} download>{t("androidInstallOption.download")}</a>
    <p className="install-note">{t("install.apkVersion", { version: release.versionName, size: (release.size / 1024 / 1024).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</p>

    <details className="install-fallback"><summary>{t("androidInstallOption.details")}</summary>
      <p>{t("androidInstallOption.permission")}</p>
      <p>{t("androidInstallOption.signIn")}</p>
    </details>
  </section></div>;
}
