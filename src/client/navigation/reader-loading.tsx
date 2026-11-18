import { useAppLocale, useMessages } from "../../i18n";
import { useEffect, useState } from "react";
import { readerOpeningFacts, readerOpeningLabel, type ReaderOpeningSnapshot } from "../reader/reader-opening";
import { formatBytes } from "../score-library/library-format";
import { scoreDisplayName } from "../../shared/score-display-name";
import { ArrowLeft } from "lucide-react";
import { useAppNavigation } from "./navigation-context";
export function ReaderLoading({ choirId, fileName, opening }: { choirId: string; fileName?: string; opening?: ReaderOpeningSnapshot | null }) {
  const t = useMessages("reader");
  const { locale } = useAppLocale();
  const navigation = useAppNavigation();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!opening || opening.stoppedAt !== null) return;
    const timer = setInterval(() => tick(value => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [opening]);
  const facts = opening ? readerOpeningFacts(opening) : null;
  const label = facts ? readerOpeningLabel(facts.phase, facts.source, locale) : t("openingScore");
  const downloading = facts?.phase === "file" || facts?.phase === "document";
  const knownTotal = downloading && facts.totalBytes !== null && facts.totalBytes > 0 && facts.loadedBytes !== null;

  return <main className="reader-loading" aria-label={t("loadingScore")}>
    <button className="reader-loading__back icon-button" onClick={() => navigation.back(`/choirs/${choirId}`)} aria-label={t("backToDrive")}><ArrowLeft size={22} aria-hidden="true" /></button>
    <div className="reader-loading__paper" aria-hidden="true" />
    <div className="reader-loading__feedback"><div className="reader-loading__label" role="status">{fileName && <strong>{scoreDisplayName(fileName)}</strong>}<span>{label}</span></div>
    <div className="reader-loading__progress">
      <progress aria-label={downloading ? t("pdfFileLoadingProgress") : t("scoreOpeningProgress")} max={knownTotal ? facts.totalBytes! : undefined} value={knownTotal ? facts.loadedBytes! : undefined} />
      {downloading && facts.loadedBytes !== null && <span>{knownTotal ? `${formatBytes(facts.loadedBytes)} / ${formatBytes(facts.totalBytes!)} · ${Math.floor(facts.loadedBytes / facts.totalBytes! * 100)}%` : t("downloadedAmount", { amount: formatBytes(facts.loadedBytes) })}</span>}
      {facts && facts.elapsedMs >= 3_000 && <span>{facts.lastProgressAgoMs >= 10_000 ? t("elapsedNoProgress", { seconds: Math.floor(facts.elapsedMs / 1_000) }) : t("elapsedSeconds", { seconds: Math.floor(facts.elapsedMs / 1_000) })}</span>}
    </div></div>
  </main>;
}
