import { useEffect, useState } from "react";
import { Button } from "react-aria-components";
import { driveUsageListSchema } from "../../shared/drive-usage";
import { adminFetch } from "./api";
import { formatBytes } from "../score-library/library-format";
import { LoadingStatus } from "../components/loading-status";

const dateTime = (value: number) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
type UsageList = ReturnType<typeof driveUsageListSchema.parse>;

export function DriveUsageDirectory({ onError }: { onError(error: unknown): void }) {
  const [q, setQ] = useState(""), [after, setAfter] = useState(""), [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<UsageList | null>(null), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setData(null); setError("");
      void adminFetch(`/drive-usage?${new URLSearchParams({ q, after })}`, { signal: controller.signal })
        .then(response => response.json()).then(value => {
          if (!controller.signal.aborted) setData(driveUsageListSchema.parse(value));
        }).catch(error => {
          if (!controller.signal.aborted) { setError("暂时无法读取使用情况，请重试。"); onError(error); }
        });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [q, after, refresh, onError]);
  return <section className="drive-usage-directory" aria-labelledby="drive-usage-title">
    <h1 className="admin-title" id="drive-usage-title">云盘使用情况</h1>
    <p className="settings-copy">查看实际用量与已记录的成员联网访问。统计供了解使用情况，不作为闲置清理依据。</p>
    <div className="admin-filters">
      <label>搜索云盘<input aria-label="搜索云盘" value={q} onChange={event => { setQ(event.target.value); setAfter(""); }} placeholder="云盘名称" /></label>
      <Button className="secondary-button" onPress={() => setRefresh(value => value + 1)}>刷新用量</Button>
    </div>
    {error ? <p role="alert">{error}</p> : !data ? <LoadingStatus>正在读取云盘使用情况…</LoadingStatus> : <>
      <p className="drive-usage-stamp">更新于 {dateTime(data.asOf)}（北京时间）</p>
      <div className="admin-table drive-usage-table" tabIndex={0} role="region" aria-labelledby="drive-usage-title">
        <table>
          <thead><tr><th scope="col">云盘</th><th scope="col">文件空间</th><th scope="col">乐谱 / 成员</th><th scope="col">最后成员联网访问</th><th scope="col">访问成员数<br /><small>近 7 天 / 30 天</small></th></tr></thead>
          <tbody>{data.drives.map(drive => {
            const ratio = drive.usedBytes / drive.limitBytes;
            const warning = ratio >= .9;
            const visitors = (days: number, count: number) => drive.isPreviewEntry ? "不统计"
              : drive.createdAt < data.collectionStartedAt && data.asOf - data.collectionStartedAt < days * 86400000 ? `未知（已记录 ${count}）` : String(count);
            return <tr key={drive.id}>
              <th scope="row"><strong>{drive.name}</strong><small>{drive.plan === "free" ? "免费体验版" : "已配置云盘"}{drive.isPreviewEntry ? " · 公开体验" : ""}</small></th>
              <td><span>{formatBytes(drive.usedBytes)} / {formatBytes(drive.limitBytes)}</span>
                <progress value={drive.usedBytes} max={Math.max(drive.usedBytes, drive.limitBytes)} aria-label={`${drive.name} 文件空间已用 ${Math.round(ratio * 100)}%`} />
                <small className={warning ? "drive-usage-warning" : undefined}>{ratio >= 1 ? "已达容量上限" : warning ? "接近容量上限" : "已用"} · {Math.round(ratio * 100)}%</small></td>
              <td>乐谱 {drive.scoreCount}{drive.scoreLimit === null ? "（未设上限）" : ` / ${drive.scoreLimit}`}<small>成员 {drive.memberCount}{drive.memberLimit === null ? "（未设上限）" : ` / ${drive.memberLimit}`}</small></td>
              <td>{drive.isPreviewEntry ? "公开体验不统计" : drive.lastMemberVisitAt === null ? "未知（尚无记录）" : <time dateTime={new Date(drive.lastMemberVisitAt).toISOString()}>{dateTime(drive.lastMemberVisitAt)}</time>}</td>
              <td><span>7 天：{visitors(7, drive.visitors7d)}</span><small>30 天：{visitors(30, drive.visitors30d)}</small></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {!data.drives.length && <p>没有匹配的云盘。</p>}
      <div className="admin-actions">
        <Button className="secondary-button" isDisabled={!after} onPress={() => setAfter("")}>返回第一页</Button>
        <Button className="secondary-button" isDisabled={!data.next} onPress={() => setAfter(data.next ?? "")}>下一页</Button>
      </div>
      <details className="drive-usage-notes"><summary>这些数字如何计算</summary>
        <p>开始记录于 {dateTime(data.collectionStartedAt)}（北京时间）。窗口未覆盖的历史显示未知，并附上线后已记录数；没有记录不代表没有使用。旧版客户端与离线访问无法记录。</p>
        <p>仅记录有效成员在前台进入普通云盘或乐谱页、返回前台或交互时的联网报告，约 5 分钟粒度；后台轮询、同步、访客、公开体验与具有运营授权时的访问不计入。不是实时在线人数或阅读时长。</p>
        <p>7 / 30 天按滚动 24 小时计算，统计当前有效成员中有访问记录的人数；退出、被移除或删除用户后不计入。只保留最近时间，不记录访问明细、谱名或笔记。</p>
        <p>空间含回收站、保留版本、待确认文件与附件；彻底删除后的隔离保留不计用户额度。达到实际额度的 90% 提示接近上限，成员数表示有效成员关系，不表示活跃。</p>
      </details>
    </>}
  </section>;
}
