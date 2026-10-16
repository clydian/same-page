import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "react-aria-components";
import { Search, Music2, ChevronRight } from "lucide-react";
import { LoadingStatus } from "../components/loading-status";
import { readAdminDrives, readAdminList } from "./api";

export function Directory({ onError }: { onError(e: unknown): void }) {
  const [q, setQ] = useState(""),
    [drive, setDrive] = useState(""),
    [filter, setFilter] = useState("all"),
    [after, setAfter] = useState(""),
    [refresh, setRefresh] = useState(0);
  const [storedData, setData] = useState<Awaited<
      ReturnType<typeof readAdminList>
    > | null>(null),
    [drives, setDrives] = useState<{ id: string; name: string }[]>([]),
    [error, setError] = useState(""),
    [loadedKey, setLoadedKey] = useState("");
  const requestKey = JSON.stringify([q, drive, filter, after, refresh]);
  const data = loadedKey === requestKey ? storedData : null;
  const loading = loadedKey !== requestKey;
  useEffect(() => {
    const c = new AbortController();
    void readAdminDrives(c.signal)
      .then((r) => setDrives(r.drives))
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(e.message);
          onError(e);
        }
      });
    return () => c.abort();
  }, [onError]);
  useEffect(() => {
    const c = new AbortController();
    const timer = setTimeout(() => {
      void readAdminList(
        new URLSearchParams({ q, drive, filter, after }),
        c.signal,
      )
        .then((result) => {
          if (!c.signal.aborted) {
            setData(result);
            setLoadedKey(requestKey);
            setError("");
          }
        })
        .catch((e) => {
          if (!c.signal.aborted) {
            setError(e.message);
            setData(null);
            setLoadedKey(requestKey);
            onError(e);
          }
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [q, drive, filter, after, refresh, onError, requestKey]);
  return (
    <>
      <h1 className="admin-title">乐谱工作台</h1>
      <p className="settings-copy">跨云盘找谱、导入练习版，检查后再发布。</p>
      <div className="admin-filters">
        <label>
          <Search size={16} />
          <input
            aria-label="搜索乐谱或云盘"
            placeholder="搜索谱名、云盘"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setAfter("");
            }}
          />
        </label>
        <select
          aria-label="云盘"
          value={drive}
          onChange={(e) => {
            setDrive(e.target.value);
            setAfter("");
          }}
        >
          <option value="">全部试点云盘</option>
          {drives.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          aria-label="处理状态"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setAfter("");
          }}
        >
          {Object.entries({
            all: "全部乐谱",
            missing: "未提供生成版",
            review: "待检查",
            stale: "来源 PDF 已变化",
            failed: "导入失败",
            disabled: "用户已移除",
          }).map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
        <Button
          className="secondary-button"
          onPress={() => setRefresh((n) => n + 1)}
        >
          刷新
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {loading && <LoadingStatus>正在查找乐谱…</LoadingStatus>}
      {data && (
        <>
          <div className="admin-table">
            <table>
              <thead>
                <tr>
                  <th>乐谱</th>
                  <th>云盘</th>
                  <th>正式练习版</th>
                  <th>最新候选</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.scores.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Music2 size={16} /> {s.fileName}
                      <small>{s.pageCount} 页</small>
                    </td>
                    <td>{s.driveName}</td>
                    <td>
                      {s.disabled ? (
                        "用户已移除"
                      ) : !s.attachmentId ? (
                        "尚未提供"
                      ) : (
                        <>
                          已发布 · r{s.attachmentRevision}
                          <small>
                            {!s.publishedSource
                              ? "来源未记录"
                              : s.publishedSource !== s.versionId
                                ? "来源 PDF 已变化"
                                : "对应当前 PDF"}
                          </small>
                        </>
                      )}
                    </td>
                    <td>
                      {s.candidateState === "failed"
                        ? "导入失败"
                        : s.candidateState === "pending"
                          ? "正在导入"
                          : s.candidateState
                            ? `${s.candidateReview === "approved" ? "已通过" : s.candidateReview === "rejected" ? "已退回" : "待检查"}${s.candidateSource !== s.versionId ? " · 来源已变化" : ""}`
                            : "—"}
                    </td>
                    <td>
                      <Link className="admin-open-score" to={`/admin/scores/${s.id}`}>打开<ChevronRight size={16} aria-hidden="true" /></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.scores.length === 0 && (
            <p>没有匹配的乐谱。仅显式纳入运营试点的云盘会在此显示。</p>
          )}
          <div className="admin-actions">
            <Button
              className="secondary-button"
              isDisabled={!after}
              onPress={() => setAfter("")}
            >
              返回第一页
            </Button>
            <Button
              className="secondary-button"
              isDisabled={!data.next}
              onPress={() => setAfter(data.next!)}
            >
              下一页
            </Button>
          </div>
        </>
      )}
    </>
  );
}
