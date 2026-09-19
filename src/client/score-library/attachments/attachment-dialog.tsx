import { AttachmentShell, AttachmentLoading } from "./attachment-shell";
import { LoadingStatus } from "../../components/loading-status";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button, Form, Input, Label, TextField } from "react-aria-components";
import { ChevronRight, FileAudio, FileText, Link as LinkIcon, Pencil, Upload } from "lucide-react";
import { attachmentAccept, attachmentFormat, attachmentNameSchema, attachmentUrlSchema, type ScoreAttachment } from "../../../shared/attachments";
import { scoreDisplayName } from "../../../shared/score-display-name";
import { UploadProgressView } from "../upload-progress-view";
import { formatBytes } from "../library-format";
import type { AttachmentSelection } from "./attachment-list";
import { attachmentFileUrl, attachmentMessage } from "./api";
import { useAttachmentMutation } from "./use-attachment-mutation";
import { attachmentActionTitle } from "./attachment-presentation";

const MarkdownAttachment = lazy(() => import("./markdown-attachment"));
const PdfPreview = lazy(() => import("./pdf-preview"));


type Props = { selection: AttachmentSelection; choirId: string; ownerKey: string; canModify: boolean; writable: boolean; onClose: () => void; onChanged: () => Promise<void> };
export default function AttachmentDialog(props: Props) {
  const { selection, choirId, onClose } = props;
  const { attachment, score, action } = selection;
  if (action === "add") return <CreateAttachment {...props} />;
  if (action === "markdown" || (action === "open" && attachment?.kind === "markdown")) return <Suspense fallback={<AttachmentLoading selection={selection} onClose={onClose} />}><MarkdownAttachment {...props} /></Suspense>;
  if (action !== "open" || !attachment) return <AttachmentForm {...props} />;
  return <AttachmentShell title={attachment.name} subtitle={scoreDisplayName(score.fileName)} wide={attachment.kind === "pdf"} onClose={onClose}>
    {attachment.kind === "audio" ? <AudioPreview attachment={attachment} choirId={choirId} />
      : <Suspense fallback={<LoadingStatus className="attachment-pdf">正在打开 PDF…</LoadingStatus>}><PdfPreview url={attachmentFileUrl(choirId, attachment)} /></Suspense>}
  </AttachmentShell>;
}

type FileKind = "audio" | "pdf" | "markdown";
const attachmentChoices = [
  { kind: "audio", title: "音频", detail: attachmentAccept("audio").split(",").join(" · "), Icon: FileAudio },
  { kind: "pdf", title: "PDF", detail: ".pdf", Icon: FileText },
  { kind: "markdown", title: "文档（仅 .md）", detail: "上传已有文档，或直接编写", Icon: FileText },
  { kind: "link", title: "链接", detail: "网页、视频等参考网址", Icon: LinkIcon },
] as const;

function CreateAttachment(props: Props) {
  const [kind, setKind] = useState<FileKind | "link" | null>(null);
  const [composing, setComposing] = useState(false);
  const onBack = () => { setKind(null); setComposing(false); };
  if (composing) return <Suspense fallback={<AttachmentLoading selection={{ score: props.selection.score, action: "markdown" }} onClose={props.onClose} />}>
    <MarkdownAttachment {...props} selection={{ score: props.selection.score, action: "markdown" }} onBack={onBack} />
  </Suspense>;
  if (kind) return <AttachmentForm {...props} selection={{ score: props.selection.score, action: kind === "link" ? "link" : "upload" }}
    uploadKind={kind === "link" ? undefined : kind} onBack={onBack} onCompose={() => setComposing(true)} />;
  return <AttachmentShell picker title="添加附件" subtitle={scoreDisplayName(props.selection.score.fileName)} onClose={props.onClose}>
    <div className="attachment-type-list">{attachmentChoices.map(({ kind, title, detail, Icon }) => <Button key={kind} className="attachment-type-option" aria-label={title} onPress={() => setKind(kind)}>
      <Icon size={22} strokeWidth={1.5} aria-hidden="true" /><span><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={17} aria-hidden="true" />
    </Button>)}</div>
  </AttachmentShell>;
}

function AudioPreview({ attachment, choirId }: { attachment: ScoreAttachment; choirId: string }) {
  const [failed, setFailed] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const source = attachmentFileUrl(choirId, attachment);
  useEffect(() => {
    const player = audio.current;
    if (player) player.src = source;
    return () => { if (player) { player.pause(); player.removeAttribute("src"); player.load(); } };
  }, [source]);
  return <div className="attachment-audio"><div className="attachment-audio-art"><FileAudio size={36} strokeWidth={1.3} /></div>
    <p>{formatBytes(attachment.sizeBytes)}</p><audio ref={audio} controls controlsList="nodownload" preload="metadata" onError={() => setFailed(true)} />
    {failed && <p role="status">当前设备无法播放或文件暂不可用，可从附件的“⋯”菜单下载后打开。</p>}
  </div>;
}

function AttachmentForm({ selection: { score, action, attachment }, choirId, writable, onClose, onChanged, uploadKind = "audio", onBack, onCompose }: Props & {
  uploadKind?: FileKind; onBack?: () => void; onCompose?: () => void;
}) {
  const [name, setName] = useState(attachment?.name ?? "");
  const [url, setUrl] = useState(attachment?.url ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [requestId] = useState(() => attachment?.id ?? crypto.randomUUID());
  const mutation = useAttachmentMutation({ choirId, scoreId: score.id, id: requestId, enabled: writable, onChanged, onComplete: onClose });
  const { progress } = mutation;
  const isLink = action === "link" || attachment?.kind === "link";
  const dirty = action === "upload" ? Boolean(file) : action === "trash" ? false : name !== (attachment?.name ?? "") || url !== (attachment?.url ?? "");
  const save = async () => {
    const validUrl = attachmentUrlSchema.safeParse(url);
    const effectiveName = name.trim() || (isLink && validUrl.success ? new URL(validUrl.data).hostname : "");
    if (action !== "trash" && (!attachmentNameSchema.safeParse(effectiveName).success || (isLink && !validUrl.success))) { setValidation("请填写名称和有效的 HTTP(S) 网址。"); return false; }
    if (action === "upload" && !file) { setValidation("请先选择一个文件。"); return false; }
    setValidation(null); setName(effectiveName);
    const saved = await mutation.save(action === "upload" && file ? { kind: "upload", name: effectiveName, file }
      : action === "trash" ? { kind: "trash", revision: attachment!.revision }
      : action === "link" ? { kind: "link", name: effectiveName, url }
      : { kind: "modify", name: effectiveName, ...(isLink ? { url } : {}), revision: attachment!.revision });
    return saved === true;
  };
  const uploadLabel = { audio: "音频", pdf: "PDF", markdown: "文档（.md）" }[uploadKind];
  const title = attachmentActionTitle(action, attachment, uploadKind);
  return <AttachmentShell title={title} subtitle={scoreDisplayName(score.fileName)} dirty={dirty && !mutation.saved} busy={mutation.pending} blocked={mutation.blocked} save={save} onClose={onClose} onBack={onBack} message={validation ?? mutation.message}>
    {!writable && <p className="attachment-help" role="status">连接尚未恢复，输入已保留；联网后可继续保存或核对结果。</p>}
    <Form className="entry-form attachment-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      {action === "upload" && <>
        {uploadKind === "markdown" && !file && <><Button className="attachment-compose" onPress={onCompose}><Pencil size={18} />直接编写</Button><p className="attachment-or">或上传已有文档</p></>}
        <label className="attachment-file-picker"><Upload size={22} strokeWidth={1.5} /><span>{file?.name ?? { audio: "选择音频文件", pdf: "选择 PDF 文件", markdown: "选择 .md 文件" }[uploadKind]}</span>
          <input className="visually-hidden" aria-label="选择附件文件" type="file" accept={attachmentAccept(uploadKind)} disabled={mutation.blocked} onChange={event => {
        const chosen = event.target.files?.[0]; if (!chosen) return;
        const format = attachmentFormat(chosen.name);
        if (!format || format.kind !== uploadKind) { setFile(null); setValidation(`请选择${uploadLabel}文件，支持 ${attachmentAccept(uploadKind).split(",").join("、")}。`); return; }
        if (chosen.size > format.maxBytes) { setFile(null); setValidation(attachmentMessage(413, null)); return; }
        setFile(chosen); setName(chosen.name); setValidation(null);
      }} /></label><p className="attachment-help">{attachmentAccept(uploadKind).split(",").join(" · ")} · 最大 {{ audio: 50, pdf: 20, markdown: 1 }[uploadKind]} MB</p></>}
      {action === "trash" ? <p>将「{attachment?.name}」移到回收站？三十天内可以恢复，期间仍占云盘空间。</p> : (action !== "upload" || file) && <>
        <TextField isRequired={!isLink} value={name} onChange={setName} maxLength={255} isDisabled={mutation.blocked}><Label>{isLink ? "名称（选填）" : "名称"}</Label><Input autoFocus={action !== "upload"} /></TextField>
        {isLink && <TextField isRequired value={url} onChange={setUrl} isDisabled={mutation.blocked}><Label>网址</Label><Input type="url" placeholder="https://" /></TextField>}
      </>}
      {mutation.pending && action === "upload" && <><UploadProgressView name={name} progress={progress} /><p role="status">{progress?.processing ? "正在保存附件…" : "正在上传…"}</p></>}
      {(action !== "upload" || file || mutation.needsRefresh) && <div className="attachment-form-actions"><Button className="primary-button" type="submit" isDisabled={mutation.blocked || (action === "upload" && !file)}>{mutation.pending ? "正在保存…" : action === "trash" ? "移到回收站" : action === "upload" ? "上传" : action === "link" ? "添加" : "保存"}</Button>
        {mutation.pending && action === "upload" && <Button className="secondary-button" onPress={mutation.cancel}>取消上传</Button>}
        {mutation.needsRefresh && <Button className="secondary-button" isDisabled={!writable} onPress={() => void mutation.refresh().catch(() => {})}>核对保存结果</Button>}
      </div>}
    </Form>
  </AttachmentShell>;
}
