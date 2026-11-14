import "./score-download-progress.css";

// Keep the same ring and number for opening a score and saving it offline.
export function ScoreDownloadProgress({ percent }: { percent: number }) {
  return <span className="offline-score-progress">
    <progress className="visually-hidden" aria-label="下载乐谱" max={100} value={percent} />
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle className="offline-score-progress-track" cx="12" cy="12" r="10.5" /><circle className="offline-score-progress-fill" cx="12" cy="12" r="10.5" pathLength="100" strokeDasharray={`${percent} 100`} /></svg>
    <span aria-hidden="true">{percent}</span>
  </span>;
}
