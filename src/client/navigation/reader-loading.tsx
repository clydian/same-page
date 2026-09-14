import { useEffect, useState } from "react";
import { readerOpeningFacts, readerOpeningLabel, type ReaderOpeningSnapshot } from "../reader/reader-opening";
import { formatBytes } from "../score-library/library-format";
import { scoreDisplayName } from "../../shared/score-display-name";
import { ArrowLeft } from "lucide-react";
import { useAppNavigation } from "./navigation-context";
export function ReaderLoading({ choirId, fileName, opening }: { choirId: string; fileName?: string; opening?: ReaderOpeningSnapshot | null }) {
  const navigation = useAppNavigation();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!opening || opening.stoppedAt !== null) return;
    const timer = setInterval(() => tick(value => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [opening]);
  const facts = opening ? readerOpeningFacts(opening) : null;
  const label = facts ? readerOpeningLabel(facts.phase, facts.source) : "正在打开乐谱…";
  const downloading = facts?.phase === "file" || facts?.phase === "document";
  const knownTotal = downloading && facts.totalBytes !== null && facts.totalBytes > 0 && facts.loadedBytes !== null;

  return <main className="reader-loading" aria-label="正在加载乐谱">
    <button className="reader-loading__back icon-button" onClick={() => navigation.back(`/choirs/${choirId}`)} aria-label="返回云盘"><ArrowLeft size={22} aria-hidden="true" /></button>
    <div className="reader-loading__paper" aria-hidden="true" />
    <div className="reader-loading__feedback"><div className="reader-loading__label" role="status">{fileName && <strong>{scoreDisplayName(fileName)}</strong>}<span>{label}</span></div>
    <div className="reader-loading__progress">
      <progress aria-label={downloading ? "PDF 文件加载进度" : "打开乐谱进度"} max={knownTotal ? facts.totalBytes! : undefined} value={knownTotal ? facts.loadedBytes! : undefined} />
      {downloading && facts.loadedBytes !== null && <span>{formatBytes(facts.loadedBytes)}{knownTotal ? ` / ${formatBytes(facts.totalBytes!)} · ${Math.floor(facts.loadedBytes / facts.totalBytes! * 100)}%` : " 已获取"}</span>}
      {facts && facts.elapsedMs >= 3_000 && <span>已等待 {Math.floor(facts.elapsedMs / 1_000)} 秒{facts.lastProgressAgoMs >= 10_000 ? "，暂未收到新的加载进展" : ""}</span>}
    </div></div>
  </main>;
}
