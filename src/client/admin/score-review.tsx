import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "react-aria-components";
import { ArrowLeft, Upload } from "lucide-react";
import { LoadingStatus } from "../components/loading-status";
import { readAdminDetail, type AdminCapabilities } from "./api";
import { ImportXml } from "./import-xml";
import { ReviewContent } from "./review-content";
const date = (n: number) => new Date(n).toLocaleString("zh-CN");
type Capabilities = AdminCapabilities;

export function ScoreReview({
  id,
  cap,
  onError,
  onDenied,
}: {
  id: string;
  cap: Capabilities;
  onError(e: unknown): void;
  onDenied(): void;
}) {
  const [storedData, setData] = useState<Awaited<
      ReturnType<typeof readAdminDetail>
    > | null>(null),
    [selected, setSelected] = useState(""),
    [importing, setImporting] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [olderBusy, setOlderBusy] = useState(false);
  const olderAbort = useRef<AbortController | null>(null);
  useEffect(() => () => olderAbort.current?.abort(), []);
  const [loadedRevision, setLoadedRevision] = useState(-1);
  const data = loadedRevision === refresh ? storedData : null;
  const beforeLeaveRef = useRef<() => Promise<boolean | "cancelled">>(() =>
    Promise.resolve(true),
  );
  useEffect(() => {
    const c = new AbortController();
    void readAdminDetail(id, c.signal)
      .then((r) => {
        if (c.signal.aborted) return;
        setData(r);
        setLoadedRevision(refresh);
        setError("");
        setSelected((old) =>
          old &&
          (r.candidates.some((v) => v.id === old) ||
            (old === "published" && r.score.attachmentId))
            ? old
            : (r.candidates.find((v) => v.state === "ready")?.id ?? ""),
        );
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(e.message);
          onError(e);
        }
      });
    return () => c.abort();
  }, [id, refresh, onError]);
  if (!data)
    return (
      <>
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          <LoadingStatus>正在读取乐谱…</LoadingStatus>
        )}
        <Link to="/admin">返回工作台</Link>
      </>
    );
  const s = data.score,
    candidate = data.candidates.find((c) => c.id === selected);
  return (
    <>
      <Link to="/admin">
        <ArrowLeft size={15} /> 返回工作台
      </Link>
      <header className="admin-score-heading">
        <div>
          <h1 className="admin-title">{s.fileName}</h1>
          <p>
            {s.driveName} · {s.pageCount} 页
          </p>
        </div>
        <Button
          className="primary-button"
          isDisabled={!cap.reviewXml || !!s.disabled}
          onPress={async () => {
            if ((await beforeLeaveRef.current()) === true) setImporting(true);
          }}
        >
          <Upload size={16} /> 导入 XML
        </Button>
      </header>
      {!!s.disabled && <p role="status">用户已移除生成版；后台不能补回。</p>}
      {error && <p role="alert">{error}</p>}
      <div className="admin-result-picker">
        <label>
          比较结果{" "}
          <select
            aria-label="比较结果"
            value={selected}
            onChange={async (e) => {
              const next = e.target.value;
              if ((await beforeLeaveRef.current()) === true) {
                setSelected(next);
                setRefresh((r) => r + 1);
              }
            }}
          >
            <option value="">当前原 PDF</option>
            {data.candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {date(c.createdAt)} ·{" "}
                {c.state === "ready"
                  ? c.review === "approved"
                    ? "已通过"
                    : c.review === "rejected"
                      ? "已退回"
                      : "待检查"
                  : c.state === "failed"
                    ? "导入失败"
                    : "导入中"}
              </option>
            ))}
            {s.attachmentId && (
              <option value="published">
                当前正式练习版 · r{s.attachmentRevision}
              </option>
            )}
          </select>
        </label>
        {data.nextBefore && (
          <Button
            className="secondary-button"
            isDisabled={olderBusy}
            onPress={async () => {
              const c = (olderAbort.current = new AbortController());
              setOlderBusy(true);
              try {
                const older = await readAdminDetail(
                  id,
                  c.signal,
                  data.nextBefore!,
                );
                if (!c.signal.aborted)
                  setData((current) =>
                    current
                      ? {
                          ...older,
                          candidates: [
                            ...current.candidates,
                            ...older.candidates.filter(
                              (n) =>
                                !current.candidates.some((v) => v.id === n.id),
                            ),
                          ],
                        }
                      : current,
                  );
              } catch (e) {
                if (!c.signal.aborted) {
                  setError(e instanceof Error ? e.message : "无法读取历史。");
                  onError(e);
                }
              } finally {
                if (!c.signal.aborted) setOlderBusy(false);
              }
            }}
          >
            {olderBusy ? "正在读取…" : "更早的候选"}
          </Button>
        )}
        <Button
          className="secondary-button"
          onPress={async () => {
            if ((await beforeLeaveRef.current()) === true)
              setRefresh((r) => r + 1);
          }}
        >
          重新读取
        </Button>
      </div>
      <ReviewContent
        key={`${selected}:${candidate?.reviewRevision ?? 0}`}
        beforeLeaveRef={beforeLeaveRef}
        score={s}
        candidate={candidate}
        published={selected === "published"}
        cap={cap}
        onError={onError}
        onDenied={onDenied}
        refresh={() => setRefresh((r) => r + 1)}
      />
      {importing && (
        <ImportXml
          score={s}
          onClose={() => setImporting(false)}
          onError={onError}
          onImported={(candidateId) => {
            setSelected(candidateId);
            setImporting(false);
            setRefresh((r) => r + 1);
          }}
        />
      )}
    </>
  );
}
