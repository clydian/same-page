import { useAppLocale, useMessages } from "../../i18n";
import { useId } from 'react';
import { Link } from 'react-router-dom';
import { useUpdateStatus } from './update-status';
import './resource-preparation.css';
export function ResourcePreparation({ install = false }: { install?: boolean }) {
  const t = useMessages("system");
  const { locale } = useAppLocale();
  const mb = (bytes: number) => `${(bytes / 1_000_000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })} MB`;
  const status = useUpdateStatus(), description = useId();
  const progress = status.progress;
  if (status.phase !== 'preparing') {
    if (!install) return null;
    if (status.initialInstall && status.phase === 'current' && progress?.stage === 'ready') return <p className="resource-preparation">{t("resourcePreparation.ready")}</p>;
    return <p className="resource-preparation">{t.rich("install.resourceLink", { check: chunks => <Link to="/about">{chunks}</Link> })}</p>;
  }
  const checking = !progress || progress.stage === 'checking';
  const verifying = progress?.stage === 'verifying' || progress?.stage === 'ready';
  const title = progress?.stage === 'ready' ? t("resourcePreparation.finishing") : verifying ? t("resourcePreparation.verifying") : checking ? t("resourcePreparation.checking") : t("resourcePreparation.downloading");
  // Only verified, stored files count as prepared. Download reception is shown
  // separately; receiving all bytes must never imply successful installation.
  const percent = progress ? Math.floor(progress.preparedBytes / progress.totalBytes * 100) : null;
  const determinate = progress && !verifying && progress.preparedBytes < progress.totalBytes;
  return <section className="resource-preparation" aria-label={install ? t("resourcePreparation.offline") : t("resourcePreparation.update")}>
    <p>{title}{determinate && <span className="resource-preparation-percent">{percent}%</span>}</p>
    <progress aria-label={install ? t("resourcePreparation.offlineProgress") : t("resourcePreparation.updateProgress")} aria-describedby={description}
      max={progress?.totalBytes ?? 1} value={determinate ? progress.preparedBytes : undefined} />
    <p id={description} className="support-muted">{progress ? t("resourcePreparation.prepared", { prepared: mb(progress.preparedBytes), total: mb(progress.totalBytes) }) : t("resourcePreparation.estimating")}</p>
    {progress && <p className="support-muted">{t("resourcePreparation.reused")} {mb(progress.reusedBytes)} {t("resourcePreparation.downloaded")} {mb(progress.downloadedBytes)}</p>}
    {install && <p className="support-muted">{t("resourcePreparation.contents")}</p>}
  </section>;
}
