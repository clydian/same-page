import { LoadingStatus } from "../../components/loading-status";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button, Input, Label, MenuItem, MenuTrigger, Popover, TextField } from "react-aria-components";
import Markdown from "react-markdown";
import { MoreHorizontal, Pencil } from "lucide-react";
import { Menu } from "../../navigation/overlays";
import { attachmentFormat, attachmentNameSchema, safeAttachmentUrl, type ScoreAttachment } from "../../../shared/attachments";
import { scoreDisplayName } from "../../../shared/score-display-name";
import { AttachmentShell } from "./attachment-shell";
import type { AttachmentSelection } from "./attachment-list";
import { readMarkdown } from "./api";
import { useAttachmentMutation, type AttachmentReceipt } from "./use-attachment-mutation";
import { markdownDraftEpoch, readMarkdownDraft, removeMarkdownDraft, writeMarkdownDraft } from "./markdown-drafts";

const Editor = lazy(() => import("./markdown-editor"));
type Props = { selection: AttachmentSelection; choirId: string; ownerKey: string; canModify: boolean; writable: boolean; onClose: () => void; onBack?: () => void; onChanged: () => Promise<void> };
type Snapshot = { attachment: ScoreAttachment | null; text: string };

export default function MarkdownAttachment(props: Props) {
  const { selection: { attachment, score }, choirId, onClose } = props;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(() => attachment ? null : { attachment: null, text: "" });
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!attachment) return;
    const abort = new AbortController();
    void readMarkdown(choirId, score.id, attachment.id, abort.signal).then(value => { if (!abort.signal.aborted) { setSnapshot(value); setFailed(false); } })
      .catch(() => { if (!abort.signal.aborted) setFailed(true); });
    return () => abort.abort();
  }, [choirId, score.id, attachment, attempt]);
  if (!snapshot) return <AttachmentShell title={attachment?.name ?? "新建文档（.md）"} subtitle={scoreDisplayName(score.fileName)} wide document onClose={onClose}>
    {failed ? <p role="alert">暂时无法打开，附件可能已变化或连接中断。</p> : <LoadingStatus>正在加载文字内容…</LoadingStatus>}
    {failed && <Button className="secondary-button" onPress={() => setAttempt(value => value + 1)}>重试</Button>}
  </AttachmentShell>;
  return <MarkdownSession {...props} snapshot={snapshot} />;
}

function MarkdownSession({ snapshot, selection: { score }, choirId, ownerKey, canModify, writable, onClose, onBack, onChanged }: Props & { snapshot: Snapshot }) {
  const [base, setBase] = useState(snapshot);
  const scope = { ownerKey, choirId, scoreId: score.id };
  const [draftEpoch] = useState(() => markdownDraftEpoch(ownerKey));
  const [draft] = useState(() => readMarkdownDraft(scope, snapshot.attachment?.id ?? null));
  const [id] = useState(() => draft?.id ?? snapshot.attachment?.id ?? crypto.randomUUID());
  const [name, setName] = useState(draft?.name ?? snapshot.attachment?.name ?? "排练笔记.md");
  const [text, setText] = useState(draft?.text ?? snapshot.text);
  const revision = useRef(draft?.revision ?? snapshot.attachment?.revision ?? null);
  const [editing, setEditing] = useState(Boolean(draft) || !snapshot.attachment);
  const [initial, setInitial] = useState(draft?.text ?? snapshot.text);
  const [validation, setValidation] = useState<string | null>(draft && draft.revision !== (snapshot.attachment?.revision ?? null) ? "云端内容已变化，已恢复本机草稿。请先下载草稿，再核对最新内容。" : null);
  const [parseFailed, setParseFailed] = useState(false);
  const dirty = text !== base.text || name !== (base.attachment?.name ?? "排练笔记.md");
  useEffect(() => {
    try {
      if (dirty) writeMarkdownDraft({ ownerKey, choirId, scoreId: score.id }, base.attachment?.id ?? null, { id, name, text, revision: revision.current }, draftEpoch);
      else removeMarkdownDraft({ ownerKey, choirId, scoreId: score.id }, base.attachment?.id ?? null, draftEpoch);
    } catch { /* Navigation and beforeunload guards still protect this tab. */ }
  }, [id, name, text, dirty, ownerKey, choirId, score.id, base.attachment?.id, draftEpoch]);

  const adoptSaved = (value: AttachmentReceipt) => {
    if (!value.attachment || value.text === undefined) return;
    setBase({ attachment: value.attachment, text: value.text });
    revision.current = value.attachment.revision;
    setEditing(false);
    removeMarkdownDraft(scope, base.attachment?.id ?? null, draftEpoch);
  };
  const mutation = useAttachmentMutation({ choirId, scoreId: score.id, id, enabled: writable && (canModify || !base.attachment), onChanged, onSaved: adoptSaved });
  const save = async () => {
    if (parseFailed || !attachmentNameSchema.safeParse(name).success || attachmentFormat(name)?.kind !== "markdown") { setValidation("请使用 .md 文件名；无法解析的内容请先下载保留。"); return false; }
    const blob = new Blob([text], { type: "text/markdown; charset=utf-8" });
    if (blob.size > 1024 * 1024) { setValidation("Markdown 最多 1 MB，当前内容仍保留，可下载草稿。"); return false; }
    setValidation(null);
    return await mutation.save({ kind: "markdown", name, text, revision: revision.current }) === true;
  };
  const downloadDraft = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = name.endsWith(".md") ? name : `${name}.md`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const discard = () => { removeMarkdownDraft(scope, base.attachment?.id ?? null, draftEpoch); setText(base.text); setName(base.attachment?.name ?? "排练笔记.md"); };
  return <AttachmentShell title={base.attachment?.name ?? "新建文档（.md）"} subtitle={scoreDisplayName(score.fileName)} wide document onClose={onClose} onBack={!base.attachment ? onBack : undefined}
    dirty={dirty} busy={mutation.pending} save={save} discard={discard} blocked={mutation.blocked || parseFailed} message={validation ?? mutation.message}>
    {!writable && <p className="attachment-help" role="status">连接尚未恢复，输入已保留；联网后可继续保存或核对结果。</p>}
    {editing ? <>
      <TextField className="attachment-name-field" value={name} onChange={setName} isDisabled={mutation.blocked} maxLength={255}><Label>文件名</Label><Input /></TextField>
      <div className="attachment-editor-region"><Suspense fallback={<LoadingStatus>正在加载编辑器…</LoadingStatus>}><Editor initial={initial} disabled={mutation.blocked || parseFailed} onChange={setText} onError={source => { setText(source); setParseFailed(true); setValidation("这份 Markdown 包含暂不支持的格式，原文已保留。请下载原文，不会用空白内容覆盖。"); }} /></Suspense></div>
      {parseFailed && <pre className="attachment-source">{text}</pre>}
      <div className="attachment-actions"><Button className="primary-button" isDisabled={mutation.blocked || parseFailed || (Boolean(base.attachment) && !dirty)} onPress={() => void save()}>{mutation.pending ? "正在保存…" : "保存"}</Button>
        <MenuTrigger><Button className="attachment-menu" aria-label="文档更多操作"><MoreHorizontal size={18} /></Button>
          <Popover className="file-menu-popover"><Menu aria-label="文档操作" onAction={key => { if (key === "download-draft") downloadDraft(); }}>
            <MenuItem id="download-draft">下载草稿 .md</MenuItem>
          </Menu></Popover>
        </MenuTrigger>
        {mutation.needsRefresh && <Button className="secondary-button" isDisabled={!writable} onPress={() => void mutation.refresh().catch(() => {})}>核对保存结果</Button>}
      </div>
    </> : <>
      {canModify && <div className="attachment-actions attachment-read-actions"><Button className="secondary-button" onPress={() => { setInitial(text); setEditing(true); }}><Pencil size={15} />编辑</Button></div>}
      <div className="attachment-prose"><Markdown skipHtml urlTransform={safeAttachmentUrl} components={{ img: () => null, a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{text}</Markdown>{!text && <p className="attachment-help">还没有正文。</p>}</div>
      {mutation.needsRefresh && <Button className="secondary-button" onPress={() => void mutation.refresh().catch(() => {})}>刷新附件列表</Button>}
    </>}
  </AttachmentShell>;
}
