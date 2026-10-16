import { useExitLayer } from "../navigation/navigation-context";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import { LoadingStatus } from "../components/loading-status";
import { holdUpdate } from "../updates/update-safety";
import { useUnsavedChangesGuard } from "../settings/use-unsaved-changes";
import type { AdminScore, XmlCandidate } from "../../shared/admin";
import { adminFetch, jsonPost, type AdminCapabilities } from "./api";
const PdfPreview = lazy(
  () => import("../score-library/attachments/pdf-preview"),
);
const XmlPreview = lazy(() => import("./admin-musicxml"));
const date = (n: number) => new Date(n).toLocaleString("zh-CN");
type Capabilities = AdminCapabilities;

export function ReviewContent({
  score,
  candidate,
  published,
  cap,
  onError,
  onDenied,
  refresh,
  beforeLeaveRef,
}: {
  beforeLeaveRef: MutableRefObject<() => Promise<boolean | "cancelled">>;
  score: AdminScore;
  candidate?: XmlCandidate;
  published: boolean;
  cap: Capabilities;
  onError(e: unknown): void;
  onDenied(): void;
  refresh(): void;
}) {
  const [ready, setReady] = useState(false),
    [note, setNote] = useState(candidate?.reviewNote ?? ""),
    [savedNote, setSavedNote] = useState(candidate?.reviewNote ?? ""),
    [reviewRevision, setReviewRevision] = useState(
      candidate?.reviewRevision ?? 0,
    ),
    [reviewStatus, setReviewStatus] = useState(candidate?.review ?? "pending"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false),
    [success, setSuccess] = useState(false);
  useExitLayer(busy, "form", () => "cancelled");
  const publication = useRef({
    id: crypto.randomUUID(),
    attachmentId: score.attachmentId ?? crypto.randomUUID(),
  });
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const saveNotes = async () => {
    if (!candidate || busy) return false;
    const c = (abort.current = new AbortController());
    setBusy(true);
    try {
      await adminFetch(
        `/scores/${score.id}/candidates/${candidate.id}/review`,
        {
          ...jsonPost({
            expectedRevision: reviewRevision,
            decision: "pending",
            technicalPassed: ready,
            note,
          }),
          signal: c.signal,
        },
      );
      if (c.signal.aborted) return false;
      setSavedNote(note);
      setReviewRevision(reviewRevision + 1);
      setReviewStatus("pending");
      setError("");
      return true;
    } catch (e) {
      if (!c.signal.aborted) {
        setError(e instanceof Error ? e.message : "保存失败。");
        onError(e);
      }
      return false;
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  };
  const guard = useUnsavedChangesGuard({
    dirty: note !== savedNote,
    save: saveNotes,
    discard: () => setNote(savedNote),
    saveState: { blocked: busy, message: null },
    subject: "检查备注",
  });
  useEffect(() => {
    beforeLeaveRef.current = () =>
      busy ? Promise.resolve("cancelled") : guard.confirm();
    return () => {
      beforeLeaveRef.current = () => Promise.resolve(true);
    };
  }, [beforeLeaveRef, busy, guard]);
  const post = async (path: string, data: unknown, done: () => void) => {
    setBusy(true);
    setError("");
    const c = (abort.current = new AbortController()),
      release = holdUpdate();
    try {
      await adminFetch(path, { ...jsonPost(data), signal: c.signal });
      if (c.signal.aborted) return false;
      done();
      return true;
    } catch (e) {
      if (!c.signal.aborted) {
        setError(e instanceof Error ? e.message : "操作失败。");
        onError(e);
      }
      return false;
    } finally {
      release();
      if (!c.signal.aborted) setBusy(false);
    }
  };
  const base = `/scores/${score.id}/candidates/${candidate?.id}`;
  const stale = !!candidate && candidate.sourceVersionId !== score.versionId;
  const xmlPath = published
    ? `/scores/${score.id}/published?revision=${score.attachmentRevision}`
    : candidate?.state === "ready"
      ? `${base}/file`
      : null;
  const canPublish =
    candidate?.state === "ready" &&
    !!cap.reviewXml &&
    ready &&
    !stale &&
    !score.disabled &&
    !!cap.publishXml &&
    !success;
  return (
    <>
      <div className="admin-comparison">
        <section aria-label="原始 PDF">
          <h2>{candidate ? "候选对应的原 PDF" : "当前原 PDF"}</h2>
          <Suspense fallback={<LoadingStatus>正在准备 PDF…</LoadingStatus>}>
            <PdfPreview
              key={candidate?.sourceVersionId ?? score.versionId}
              url={`/api/admin/scores/${score.id}/pdf?versionId=${candidate?.sourceVersionId ?? score.versionId}`}
            />
          </Suspense>
        </section>
        <section aria-label="XML 检查">
          <h2>{published ? "当前正式练习版" : "候选练习版"}</h2>
          {xmlPath ? (
            <Suspense fallback={<LoadingStatus>正在准备播放器…</LoadingStatus>}>
              <XmlPreview
                key={xmlPath}
                path={xmlPath}
                onReady={setReady}
                onDenied={onDenied}
              />
            </Suspense>
          ) : (
            <p>
              {candidate?.state === "failed"
                ? "该次导入失败，请重新导入。"
                : candidate
                  ? "导入尚未完成，请重新读取或重试。"
                  : "先导入 XML，再对照检查和试听。"}
            </p>
          )}
        </section>
      </div>
      {candidate && (
        <section className="admin-review">
          <h2>检查与发布</h2>
          {stale && (
            <p role="alert">
              来源 PDF 已变化，此候选可以检查，但不能发布到当前乐谱。
            </p>
          )}
          <p>草稿已保存 · 保留至 {date(candidate.expiresAt)}</p>
          <details className="admin-source-details">
            <summary>导入信息</summary>
            <p>
              导入于 {date(candidate.createdAt)} · {candidate.sizeBytes} 字节
              <br />
              来源工具：{candidate.tool || "未记录"} {candidate.parameters}
            </p>
          </details>
          <label className="admin-field">
            检查备注（可选）
            <textarea
              aria-label="检查备注"
              placeholder="记录需要保留的说明，留空也可以发布。"
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
            />
          </label>
          <p>
            状态：
            {success
              ? "已发布"
              : reviewStatus === "approved"
                ? "已检查，待发布"
                : reviewStatus === "rejected"
                  ? "已退回"
                  : "待检查"}
            {reviewStatus !== "pending" &&
              candidate.reviewedAt &&
              ` · ${date(candidate.reviewedAt)}`}
          </p>
          <div className="admin-actions">
            <Button
              className="secondary-button"
              isDisabled={busy || !cap.reviewXml || candidate.state !== "ready"}
              onPress={async () => {
                if (await saveNotes()) refresh();
              }}
            >
              保存草稿
            </Button>
            <Button
              className="primary-button"
              isDisabled={busy || !canPublish}
              onPress={() => setConfirm(true)}
            >
              发布练习版
            </Button>
          </div>
          {error && <p role="alert">{error}</p>}
          {success && (
            <p role="status">
              发布成功，成员现在可以使用这份练习版。
              <Button onPress={refresh}>重新读取结果</Button>
            </p>
          )}
        </section>
      )}
      {confirm && candidate && (
        <ModalOverlay
          className="modal-overlay"
          isOpen
          isDismissable={!busy}
          onOpenChange={(open) => {
            if (!busy) setConfirm(open);
          }}
        >
          <Modal className="app-modal">
            <Dialog
              className="app-dialog"
              aria-label="发布练习版"
              data-update-busy={busy ? "true" : undefined}
            >
              <Heading slot="title">发布到 {score.driveName}</Heading>
              <p>
                将「{candidate.name}」{score.attachmentId ? "更新为" : "发布为"}
                「{score.fileName}」的自动生成练习版。成员将可以看到并播放，原
                PDF 与用户附件保持不变。
              </p>
              <p>
                确认发布表示你已完成检查。检查备注会一并保存。
              </p>
              {error && <p role="alert">{error}</p>}
              <div className="admin-actions">
                <Button
                  className="secondary-button"
                  isDisabled={busy}
                  onPress={() => setConfirm(false)}
                >
                  返回检查
                </Button>
                <Button
                  className="primary-button"
                  isDisabled={busy || !canPublish}
                  onPress={async () => {
                    let revision = reviewRevision;
                    if (reviewStatus !== "approved" || note !== savedNote) {
                      const approved = await post(
                        `${base}/review`,
                        {
                          expectedRevision: revision,
                          decision: "approved",
                          technicalPassed: ready,
                          note,
                        },
                        () => {
                          setSavedNote(note);
                          setReviewRevision(revision + 1);
                          setReviewStatus("approved");
                        },
                      );
                      if (!approved) return;
                      revision += 1;
                    }
                    await post(
                      `${base}/publish`,
                      {
                        ...publication.current,
                        expectedReviewRevision: revision,
                        expectedAttachmentRevision: score.attachmentRevision ?? 0,
                      },
                      () => {
                        setConfirm(false);
                        setSuccess(true);
                      },
                    );
                  }}
                >
                  {busy ? "正在发布…" : "确认发布"}
                </Button>
              </div>
            </Dialog>
          </Modal>
        </ModalOverlay>
      )}
      {guard.confirmation}
    </>
  );
}
