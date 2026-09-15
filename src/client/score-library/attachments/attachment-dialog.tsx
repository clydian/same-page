import { AttachmentShell, AttachmentLoading } from "./attachment-shell";
import { LoadingStatus } from "../../components/loading-status";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button, Form, Input, Label, TextField } from "react-aria-components";
import { ChevronRight, FileAudio, FileText, Link as LinkIcon, Pencil, Upload } from "lucide-react";
import { attachmentAccept, attachmentFormat, attachmentNameSchema, attachmentSchema, attachmentUrlSchema, type ScoreAttachment } from "../../../shared/attachments";
import { scoreDisplayName } from "../../../shared/score-display-name";
import { attachmentFetch as diagnosticFetch } from "./request";
import { useSettingsMutation } from "../../settings/settings-mutation";
import { SettingsRequestError } from "../../settings/settings-request";
import { UploadProgressView } from "../upload-progress-view";
import { uploadBody, type UploadProgress } from "../upload-transport";
import { formatBytes } from "../library-format";
import type { AttachmentSelection } from "./attachment-list";
import { musicXmlEnabled, attachmentFileUrl, attachmentMessage, attachmentPath, readAttachmentRecovery } from "./api";
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

type FileKind = "audio" | "pdf" | "markdown" | "musicxml";
const attachmentChoices = [
  { kind: "musicxml", title: "可播放乐谱", detail: ".musicxml · .xml · .mxl", Icon: FileAudio },
  { kind: "audio", title: "音频", detail: attachmentAccept("audio").split(",").join(" · "), Icon: FileAudio },
  { kind: "pdf", title: "PDF", detail: ".pdf", Icon: FileText },
  { kind: "markdown", title: "文档（仅 .md）", detail: "上传已有文档，或直接编写", Icon: FileText },
  { kind: "link", title: "链接", detail: "网页、视频等参考网址", Icon: LinkIcon },
] as const;

function CreateAttachment(props: Props) {
  const [kind, setKind] = useState<FileKind | "link" | null>(null);
  const [composing, setComposing] = useState(false);
  const [musicxml, setMusicxml] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void musicXmlEnabled(props.choirId, abort.signal).then(enabled => { if (!abort.signal.aborted) setMusicxml(enabled); }).catch(() => {});
    return () => abort.abort();
  }, [props.choirId]);
  const onBack = () => { setKind(null); setComposing(false); };
  if (composing) return <Suspense fallback={<AttachmentLoading selection={{ score: props.selection.score, action: "markdown" }} onClose={props.onClose} />}>
    <MarkdownAttachment {...props} selection={{ score: props.selection.score, action: "markdown" }} onBack={onBack} />
  </Suspense>;
  if (kind) return <AttachmentForm {...props} selection={{ score: props.selection.score, action: kind === "link" ? "link" : "upload" }}
    uploadKind={kind === "link" ? undefined : kind} onBack={onBack} onCompose={() => setComposing(true)} />;
  return <AttachmentShell picker title="添加附件" subtitle={scoreDisplayName(props.selection.score.fileName)} onClose={props.onClose}>
    <div className="attachment-type-list">{attachmentChoices.filter(choice => choice.kind !== "musicxml" || musicxml).map(({ kind, title, detail, Icon }) => <Button key={kind} className="attachment-type-option" aria-label={title} onPress={() => setKind(kind)}>
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
  const [progress, setProgress] = useState<UploadProgress>();
  const [requestId] = useState(() => attachment?.id ?? crypto.randomUUID());
  const abort = useRef<AbortController | null>(null);
  const validationAbort = useRef<AbortController | null>(null);
  useEffect(() => () => validationAbort.current?.abort(), []);
  const confirmed = useRef(false);
  const submitted = useRef<{ name: string; url: string; size: number } | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => () => abort.current?.abort(), []);
  const mutation = useSettingsMutation({ enabled: writable, refresh: async isCurrent => {
    if (!confirmed.current) {
      const creating = action === "upload" || action === "link";
      const result = await readAttachmentRecovery(choirId, score.id, requestId, creating ? "create" : action === "trash" ? "trash" : "modify");
      if (!isCurrent()) return;
      if (result.state === "pending") { setValidation("上传仍在处理中，请稍后再次核对。"); throw new SettingsRequestError(409); }
      if (creating && result.state === "absent") {
        setProgress(undefined); setValidation("附件尚未保存，可以重试。");
      } else if (action === "trash" && (result.state === "trashed" || result.state === "absent")) {
        confirmed.current = true; setSaved(true);
      } else if (result.state === "available") {
        const row = result.attachment;
        const expected = submitted.current;
        if (action !== "trash" && expected && row.name === expected.name && (row.kind !== "link" || row.url === expected.url)
          && (action !== "upload" || row.sizeBytes === expected.size)) {
          confirmed.current = true; setSaved(true);
        } else if (!creating && row.revision === attachment?.revision) {
          setValidation("修改尚未保存，可以重试。");
        } else { setValidation("附件已发生变化，请重新打开后核对。"); throw new SettingsRequestError(409); }
      } else throw new SettingsRequestError(404);
    }
    await onChanged(); if (isCurrent() && confirmed.current) onClose();
  } });
  const isLink = action === "link" || attachment?.kind === "link";
  const dirty = action === "upload" ? Boolean(file) : action === "trash" ? false : name !== (attachment?.name ?? "") || url !== (attachment?.url ?? "");
  const save = async () => {
    const validUrl = attachmentUrlSchema.safeParse(url);
    const effectiveName = name.trim() || (isLink && validUrl.success ? new URL(validUrl.data).hostname : "");
    if (action !== "trash" && (!attachmentNameSchema.safeParse(effectiveName).success || (isLink && !validUrl.success))) { setValidation("请填写名称和有效的 HTTP(S) 网址。"); return false; }
    if (action === "upload" && !file) { setValidation("请先选择一个文件。"); return false; }
    setValidation(null); setName(effectiveName);
    submitted.current = { name: effectiveName, url, size: file?.size ?? 0 };
    abort.current = new AbortController();
    const signal = abort.current.signal;
    const saved = await mutation.submit(async () => {
      const path = attachmentPath(choirId, score.id, requestId);
      if (action === "upload" && file) return uploadBody(`${path}/file?${new URLSearchParams({ name: effectiveName, size: String(file.size) })}`, file, signal, setProgress);
      if (action === "trash") return diagnosticFetch(`${path}?expectedRevision=${attachment!.revision}`, { method: "DELETE", signal });
      const body = action === "link" ? { id: requestId, name: effectiveName, url } : { name: effectiveName, ...(isLink ? { url } : {}), expectedRevision: attachment!.revision };
      return diagnosticFetch(action === "link" ? `/api/choirs/${choirId}/scores/${score.id}/attachments/links` : path, {
        method: action === "link" ? "POST" : "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal,
      });
    }, { rejectionMessage: attachmentMessage, confirmed: async (response, isCurrent) => {
      if (response.status !== 204) attachmentSchema.parse((await response.json()).attachment);
      if (isCurrent()) { confirmed.current = true; setSaved(true); }
    } });
    return saved === true;
  };
  const uploadLabel = { audio: "音频", musicxml: "可播放乐谱", pdf: "PDF", markdown: "文档（.md）" }[uploadKind];
  const title = attachmentActionTitle(action, attachment, uploadKind);
  return <AttachmentShell title={title} subtitle={scoreDisplayName(score.fileName)} dirty={dirty && !saved} busy={mutation.pending} blocked={mutation.blocked} save={save} onClose={onClose} onBack={onBack} message={validation ?? mutation.message}>
    {!writable && <p className="attachment-help" role="status">连接尚未恢复，输入已保留；联网后可继续保存或核对结果。</p>}
    <Form className="entry-form attachment-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      {action === "upload" && <>
        {uploadKind === "markdown" && !file && <><Button className="attachment-compose" onPress={onCompose}><Pencil size={18} />直接编写</Button><p className="attachment-or">或上传已有文档</p></>}
        <label className="attachment-file-picker"><Upload size={22} strokeWidth={1.5} /><span>{file?.name ?? { audio: "选择音频文件", musicxml: "选择 MusicXML 文件", pdf: "选择 PDF 文件", markdown: "选择 .md 文件" }[uploadKind]}</span>
          <input className="visually-hidden" aria-label="选择附件文件" type="file" accept={attachmentAccept(uploadKind)} disabled={mutation.blocked} onChange={async event => {
        validationAbort.current?.abort();
        const chosen = event.target.files?.[0]; if (!chosen) return;
        const format = attachmentFormat(chosen.name);
        if (!format || format.kind !== uploadKind) { setFile(null); setValidation(`请选择${uploadLabel}文件，支持 ${attachmentAccept(uploadKind).split(",").join("、")}。`); return; }
        if (chosen.size > format.maxBytes) { setFile(null); setValidation(attachmentMessage(413, null)); return; }
        if (format.kind === "musicxml") {
          const controller = new AbortController(); validationAbort.current = controller;
          setFile(null); setValidation("正在检查乐谱…");
          try {
            const { validateMusicXmlFile } = await import("../../playback/validate-musicxml");
            await validateMusicXmlFile(chosen, controller.signal);
          } catch (error) {
            if (!controller.signal.aborted) setValidation(error instanceof Error ? error.message : "无法读取乐谱。");
            return;
          }
          if (controller.signal.aborted) return;
        }
        setFile(chosen); setName(chosen.name); setValidation(null);
      }} /></label><p className="attachment-help">{attachmentAccept(uploadKind).split(",").join(" · ")} · 最大 {{ audio: 50, musicxml: 20, pdf: 20, markdown: 1 }[uploadKind]} MB</p></>}
      {action === "trash" ? <p>将「{attachment?.name}」移到回收站？三十天内可以恢复，期间仍占云盘空间。</p> : (action !== "upload" || file) && <>
        <TextField isRequired={!isLink} value={name} onChange={setName} maxLength={255} isDisabled={mutation.blocked}><Label>{isLink ? "名称（选填）" : "名称"}</Label><Input autoFocus={action !== "upload"} /></TextField>
        {isLink && <TextField isRequired value={url} onChange={setUrl} isDisabled={mutation.blocked}><Label>网址</Label><Input type="url" placeholder="https://" /></TextField>}
      </>}
      {mutation.pending && action === "upload" && <><UploadProgressView name={name} progress={progress} /><p role="status">{progress?.processing ? "正在保存附件…" : "正在上传…"}</p></>}
      {(action !== "upload" || file || mutation.needsRefresh) && <div className="attachment-form-actions"><Button className="primary-button" type="submit" isDisabled={mutation.blocked || (action === "upload" && !file)}>{mutation.pending ? "正在保存…" : action === "trash" ? "移到回收站" : action === "upload" ? "上传" : action === "link" ? "添加" : "保存"}</Button>
        {mutation.pending && action === "upload" && <Button className="secondary-button" onPress={() => abort.current?.abort()}>取消上传</Button>}
        {mutation.needsRefresh && <Button className="secondary-button" isDisabled={!writable} onPress={() => void mutation.refresh().catch(() => {})}>核对保存结果</Button>}
      </div>}
    </Form>
  </AttachmentShell>;
}
