import { useId } from 'react';
import { Link } from 'react-router-dom';
import { useUpdateStatus } from './update-status';
import './resource-preparation.css';
const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

export function ResourcePreparation({ install = false }: { install?: boolean }) {
  const status = useUpdateStatus(), description = useId();
  const progress = status.progress;
  if (status.phase !== 'preparing') {
    if (!install) return null;
    if (status.initialInstall && status.phase === 'current' && progress?.stage === 'ready') return <p className="resource-preparation">应用和播放器资源已准备好。乐谱仍需另行保存到本机。</p>;
    return <p className="resource-preparation">添加桌面图标与离线资源准备分别进行。<Link to="/about">查看资源准备与更新状态</Link></p>;
  }
  const checking = !progress || progress.stage === 'checking';
  const verifying = progress?.stage === 'verifying' || progress?.stage === 'ready';
  const title = progress?.stage === 'ready' ? '资源校验完成，正在完成安装…' : verifying ? '正在校验并保存资源…' : checking ? '正在检查并复用本机资源…' : '正在下载并准备资源…';
  // Only verified, stored files count as prepared. Download reception is shown
  // separately; receiving all bytes must never imply successful installation.
  const percent = progress ? Math.floor(progress.preparedBytes / progress.totalBytes * 100) : null;
  const determinate = progress && !verifying && progress.preparedBytes < progress.totalBytes;
  return <section className="resource-preparation" aria-label={install ? '离线资源准备' : '更新资源准备'}>
    <p>{title}{determinate && <span className="resource-preparation-percent">{percent}%</span>}</p>
    <progress aria-label={install ? '离线资源准备进度' : '更新资源准备进度'} aria-describedby={description}
      max={progress?.totalBytes ?? 1} value={determinate ? progress.preparedBytes : undefined} />
    <p id={description} className="support-muted">{progress ? `已准备 ${mb(progress.preparedBytes)} / ${mb(progress.totalBytes)}` : '正在确认需要准备的资源大小。'}</p>
    {progress && <p className="support-muted">本机复用 {mb(progress.reusedBytes)} · 已接收下载资源 {mb(progress.downloadedBytes)}</p>}
    {install && <p className="support-muted">包含播放器资源；不包含你的 PDF、MXL 或笔记。</p>}
  </section>;
}
