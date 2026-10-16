import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LoadingStatus } from "../components/loading-status";
import { readAdminAudit } from "./api";
const date = (n: number) => new Date(n).toLocaleString("zh-CN");

export function Audit({ onError }: { onError(e: unknown): void }) {
  const [data, setData] = useState<Awaited<
    ReturnType<typeof readAdminAudit>
  > | null>(null);
  useEffect(() => {
    const c = new AbortController();
    void readAdminAudit(c.signal)
      .then(setData)
      .catch((e) => {
        if (!c.signal.aborted) onError(e);
      });
    return () => c.abort();
  }, [onError]);
  return (
    <section>
      <h1 className="admin-title">最近操作</h1>
      {!data ? (
        <LoadingStatus>正在读取…</LoadingStatus>
      ) : (
        <ul className="admin-audit">
          {data.events.map((e) => (
            <li key={e.id}>
              <strong>
                {(
                  {
                    "list-scores": "查找乐谱",
                    "view-score": "查看乐谱",
                    "read-pdf": "读取原 PDF",
                    "read-candidate": "读取候选 XML",
                    "read-published": "读取正式练习版",
                    import: "导入候选",
                    "import-failed": "导入失败",
                    approved: "检查通过",
                    rejected: "退回",
                    pending: "保存备注",
                    publish: "发布练习版",
                  } as Record<string, string>
                )[e.action] ?? e.action}
              </strong>{" "}
              · {date(e.createdAt)}
              <small>
                运营者 {e.operatorId}
                {e.scoreId && (
                  <>
                    {" "}
                    · <Link to={`/admin/scores/${e.scoreId}`}>{e.scoreId}</Link>
                  </>
                )}
              </small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
