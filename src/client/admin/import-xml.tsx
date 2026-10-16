import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { AttachmentShell } from "../score-library/attachments/attachment-shell";
import { holdUpdate } from "../updates/update-safety";
import { attachmentFormat } from "../../shared/attachments";
import type { AdminScore } from "../../shared/admin";
import { adminFetch } from "./api";

export function ImportXml({
  score,
  onClose,
  onImported,
  onError,
}: {
  score: AdminScore;
  onClose(): void;
  onImported(id: string): void;
  onError(e: unknown): void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [tool, setTool] = useState(""),
    [parameters, setParameters] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const requestId = useRef(crypto.randomUUID()),
    abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    const c = (abort.current = new AbortController()),
      release = holdUpdate();
    try {
      if (
        attachmentFormat(file.name)?.kind !== "musicxml" ||
        file.size > 20971520 ||
        file.size === 0
      )
        throw new Error("请选择有效的 MusicXML / XML / MXL 文件，最大 20 MB。");
      const bytes = await file.arrayBuffer();
      const sha = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (v) => v.toString(16).padStart(2, "0"),
      ).join("");
      await adminFetch(
        `/scores/${score.id}/candidates/${requestId.current}?${new URLSearchParams({ name: file.name, size: String(file.size), sha256: sha, sourceVersionId: score.versionId, tool, parameters })}`,
        { method: "POST", body: bytes, signal: c.signal },
      );
      if (!c.signal.aborted) onImported(requestId.current);
    } catch (e) {
      if (!c.signal.aborted) {
        setError(e instanceof Error ? e.message : "导入失败。");
        onError(e);
      }
    } finally {
      release();
      if (!c.signal.aborted) setBusy(false);
    }
  };
  return (
    <AttachmentShell
      title="导入候选练习版"
      subtitle={`${score.driveName} · ${score.fileName}`}
      busy={busy}
      onClose={onClose}
    >
      <p>此候选绑定当前 PDF；导入后只在后台可见。</p>
      <label className="admin-field">
        MusicXML 文件
        <input
          type="file"
          accept=".xml,.musicxml,.mxl"
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            requestId.current = crypto.randomUUID();
          }}
        />
      </label>
      <label className="admin-field">
        来源工具与版本（选填）
        <input
          maxLength={200}
          value={tool}
          disabled={busy}
          onChange={(e) => setTool(e.target.value)}
        />
      </label>
      <label className="admin-field">
        参数或说明（选填）
        <textarea
          maxLength={1000}
          value={parameters}
          disabled={busy}
          onChange={(e) => setParameters(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <Button
        className="primary-button"
        isDisabled={!file || busy}
        onPress={() => void submit()}
      >
        {busy ? "正在导入…" : "导入并检查"}
      </Button>
    </AttachmentShell>
  );
}
