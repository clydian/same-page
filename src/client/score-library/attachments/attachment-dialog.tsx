import { useAppLocale, useMessages } from "../../../i18n";
import { AttachmentModule } from "./attachment-module";
import { AttachmentShell } from "./attachment-shell";
import MarkdownAttachment from "./markdown-attachment";
import { LoadingStatus } from "../../components/loading-status";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { connections, connectionUrl } from "../../connection/connection";
import { Button, Form, Input, Label, TextField } from "react-aria-components";
import { FileAudio, Pencil, Upload } from "lucide-react";
import { attachmentAccept, attachmentFormat, attachmentNameSchema, attachmentUrlSchema, type ScoreAttachment } from "../../../shared/attachments";
import { scoreDisplayName } from "../../../shared/score-display-name";
import { UploadProgressView } from "../upload-progress-view";
import { formatBytes } from "../library-format";
import type { AttachmentSelection } from "./attachment-list";
import { attachmentFileUrl, attachmentMessage } from "./api";
import { useAttachmentMutation } from "./use-attachment-mutation";
import { attachmentActionTitle } from "./attachment-presentation";
import { validateMusicXmlFile } from "../../playback/validate-musicxml";

const loadPdf = () => import("./pdf-preview");


export type FileKind = "audio" | "pdf" | "markdown" | "musicxml";
export type AttachmentDialogProps = { selection: AttachmentSelection; choirId: string; ownerKey: string; canModify: boolean; writable: boolean; onClose: () => void; onChanged: () => Promise<void>; uploadKind?: FileKind; onBack?: () => void; onCompose?: () => void };
type Props = AttachmentDialogProps;
export default function AttachmentDialog(props: Props) {
  const t = useMessages("library");
  const { selection, choirId, onClose } = props;
  const { attachment, score, action } = selection;
  if (action === "markdown" || (action === "open" && attachment?.kind === "markdown")) return <MarkdownAttachment {...props} />;
  if (action !== "open" || !attachment) return <AttachmentForm {...props} />;
  return <AttachmentShell title={attachment.name} subtitle={scoreDisplayName(score.fileName)} wide={attachment.kind === "pdf"} onClose={onClose}>
    {attachment.kind === "audio" ? <AudioPreview attachment={attachment} choirId={choirId} />
      : <AttachmentModule load={loadPdf} props={{ url: attachmentFileUrl(choirId, attachment) }} fallback={<LoadingStatus className="attachment-pdf">{t("attachmentOpeningPdf")}</LoadingStatus>} />}
  </AttachmentShell>;
}

function AudioPreview({ attachment, choirId }: { attachment: ScoreAttachment; choirId: string }) {
  const t = useMessages("library");
  const [failed, setFailed] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const resume = useRef<{ time: number; playing: boolean; speed: number; volume: number } | null>(null);
  useSyncExternalStore(connections.subscribe, connections.getSnapshot);
  const source = connectionUrl(attachmentFileUrl(choirId, attachment));
  useEffect(() => {
    const player = audio.current;
    if (player) player.src = source;
    return () => { if (player) { if (player.readyState >= HTMLMediaElement.HAVE_METADATA) resume.current = { time: player.currentTime, playing: !player.paused, speed: player.playbackRate, volume: player.volume }; player.pause(); player.removeAttribute("src"); player.load(); } };
  }, [source]);
  return <div className="attachment-audio"><div className="attachment-audio-art"><FileAudio size={36} strokeWidth={1.3} /></div>
    <p>{formatBytes(attachment.sizeBytes)}</p><audio ref={audio} crossOrigin="use-credentials" controls controlsList="nodownload" preload="metadata" onLoadedMetadata={() => { setFailed(false); if (resume.current && audio.current) { const player = audio.current; player.currentTime = resume.current.time; player.playbackRate = resume.current.speed; player.volume = resume.current.volume; if (resume.current.playing) void player.play().catch(() => setFailed(true)); resume.current = null; } }} onError={() => setFailed(true)} />
    {failed && <p role="status">{t("attachmentIfCurrentDeviceCannot")}</p>}
  </div>;
}

function AttachmentForm({ selection: { score, action, attachment }, choirId, writable, onClose, onChanged, uploadKind = "audio", onBack, onCompose }: Props & {
  uploadKind?: FileKind; onBack?: () => void; onCompose?: () => void;
}) {
  const t = useMessages("library");
  const { locale } = useAppLocale();
  const [name, setName] = useState(attachment?.name ?? "");
  const [url, setUrl] = useState(attachment?.url ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [requestId] = useState(() => attachment?.id ?? crypto.randomUUID());
  const validationAbort = useRef<AbortController | null>(null);
  useEffect(() => () => validationAbort.current?.abort(), []);
  const mutation = useAttachmentMutation({ choirId, scoreId: score.id, id: requestId, enabled: writable, onChanged, onComplete: onClose });
  const { progress } = mutation;
  const isLink = action === "link" || attachment?.kind === "link";
  const dirty = action === "upload" ? Boolean(file) : action === "trash" ? false : name !== (attachment?.name ?? "") || url !== (attachment?.url ?? "");
  const save = async () => {
    const validUrl = attachmentUrlSchema.safeParse(url);
    const effectiveName = name.trim() || (isLink && validUrl.success ? new URL(validUrl.data).hostname : "");
    if (action !== "trash" && (!attachmentNameSchema.safeParse(effectiveName).success || (isLink && !validUrl.success))) { setValidation(t("attachmentEnterNameValidHttp")); return false; }
    if (action === "upload" && !file) { setValidation(t("attachmentSelectFileFirst")); return false; }
    setValidation(null); setName(effectiveName);
    const saved = await mutation.save(action === "upload" && file ? { kind: "upload", name: effectiveName, file }
      : action === "trash" ? { kind: "trash", revision: attachment!.revision }
      : action === "link" ? { kind: "link", name: effectiveName, url }
      : { kind: "modify", name: effectiveName, ...(isLink ? { url } : {}), revision: attachment!.revision });
    return saved === true;
  };
  const uploadLabel = { audio: t("audio"), musicxml: t("attachmentPlayableSheetMusic"), pdf: "PDF", markdown: t("attachmentDocumentationMd") }[uploadKind];
  const title = attachmentActionTitle(action, attachment, uploadKind, locale);
  return <AttachmentShell title={title} subtitle={scoreDisplayName(score.fileName)} dirty={dirty && !mutation.saved} busy={mutation.pending} blocked={mutation.blocked} save={save} onClose={onClose} onBack={onBack} message={validation ?? mutation.message}>
    {!writable && <p className="attachment-help" role="status">{t("attachmentConnectionHasNotBeen")}</p>}
    <Form className="entry-form attachment-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      {action === "upload" && <>
        {uploadKind === "markdown" && !file && <><Button className="attachment-compose" onPress={onCompose}><Pencil size={18} />{t("attachmentWriteDirectly")}</Button><p className="attachment-or">{t("attachmentUploadExistingDocuments")}</p></>}
        <label className="attachment-file-picker"><Upload size={22} strokeWidth={1.5} /><span>{file?.name ?? { audio: t("attachmentSelectAudioFile"), musicxml: t("attachmentSelectMusicxmlFile"), pdf: t("attachmentSelectPdfFile"), markdown: t("attachmentSelectMdFile") }[uploadKind]}</span>
          <input className="visually-hidden" aria-label={t("attachmentSelectAttachmentFile")} type="file" accept={attachmentAccept(uploadKind)} disabled={mutation.blocked} onChange={async event => {
        validationAbort.current?.abort();
        const chosen = event.target.files?.[0]; if (!chosen) return;
        const format = attachmentFormat(chosen.name);
        if (!format || format.kind !== uploadKind) { setFile(null); setValidation(t("attachmentSelectFileWhichSupports", { uploadLabel: String(uploadLabel), value2: String(attachmentAccept(uploadKind).split(",").join("、")) })); return; }
        if (chosen.size > format.maxBytes) { setFile(null); setValidation(attachmentMessage(413, null)); return; }
        if (format.kind === "musicxml") {
          const controller = new AbortController(); validationAbort.current = controller;
          setFile(null); setValidation(t("attachmentCheckingSheetMusic"));
          try {
            await validateMusicXmlFile(chosen, controller.signal, locale);
          } catch (error) {
            if (!controller.signal.aborted) setValidation(error instanceof Error ? error.message : t("attachmentUnableReadSheetMusic"));
            return;
          }
          if (controller.signal.aborted) return;
        }
        setFile(chosen); setName(chosen.name); setValidation(null);
      }} /></label><p className="attachment-help">{t("attachmentUploadLimits", { formats: attachmentAccept(uploadKind).split(",").join(" · "), size: { audio: 50, musicxml: 20, pdf: 20, markdown: 1 }[uploadKind] })}</p></>}
      {action === "trash" ? <p>{t("confirmTrashAttachment", { name: attachment?.name ?? "" })}</p> : (action !== "upload" || file) && <>
        <TextField isRequired={!isLink} value={name} onChange={setName} maxLength={255} isDisabled={mutation.blocked}><Label>{isLink ? t("attachmentNameOptional") : t("attachmentName")}</Label><Input autoFocus={action !== "upload"} /></TextField>
        {isLink && <TextField isRequired value={url} onChange={setUrl} isDisabled={mutation.blocked}><Label>{t("attachmentUrl")}</Label><Input type="url" placeholder={t("urlPlaceholder")} /></TextField>}
      </>}
      {mutation.pending && action === "upload" && <><UploadProgressView name={name} progress={progress} /><p role="status">{progress?.processing ? t("attachmentSavingAttachment") : t("attachmentUploading")}</p></>}
      {(action !== "upload" || file || mutation.needsRefresh) && <div className="attachment-form-actions"><Button className="primary-button" type="submit" isDisabled={mutation.blocked || (action === "upload" && !file)}>{mutation.pending ? t("saving") : action === "trash" ? t("moveToTrash") : action === "upload" ? t("attachmentUpload") : action === "link" ? t("attachmentAdd") : t("save")}</Button>
        {mutation.pending && action === "upload" && <Button className="secondary-button" onPress={mutation.cancel}>{t("attachmentCancelUpload")}</Button>}
        {mutation.needsRefresh && <Button className="secondary-button" isDisabled={!writable} onPress={() => void mutation.refresh().catch(() => {})}>{t("attachmentCheckSavedResults")}</Button>}
      </div>}
    </Form>
  </AttachmentShell>;
}
