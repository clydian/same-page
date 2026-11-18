import { useMessages } from "../../../i18n";
import { AttachmentModule } from "./attachment-module";
import { LoadingStatus } from "../../components/loading-status";
import { useEffect, useRef, useState } from "react";
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

const loadEditor = () => import("./markdown-editor");
type Props = { selection: AttachmentSelection; choirId: string; ownerKey: string; canModify: boolean; writable: boolean; onClose: () => void; onBack?: () => void; onChanged: () => Promise<void> };
type Snapshot = { attachment: ScoreAttachment | null; text: string };

export default function MarkdownAttachment(props: Props) {
  const t = useMessages("library");
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
  if (!snapshot) return <AttachmentShell title={attachment?.name ?? t("attachmentPresentationCreateNewDocumentMd")} subtitle={scoreDisplayName(score.fileName)} wide document onClose={onClose}>
    {failed ? <p role="alert">{t("markdownAttachmentCannotOpenedTemporarilyAttachment")}</p> : <LoadingStatus>{t("markdownAttachmentLoadingTextContent")}</LoadingStatus>}
    {failed && <Button className="secondary-button" onPress={() => setAttempt(value => value + 1)}>{t("retry")}</Button>}
  </AttachmentShell>;
  return <MarkdownSession {...props} snapshot={snapshot} />;
}

function MarkdownSession({ snapshot, selection: { score }, choirId, ownerKey, canModify, writable, onClose, onBack, onChanged }: Props & { snapshot: Snapshot }) {
  const t = useMessages("library");
  const [base, setBase] = useState(snapshot);
  const scope = { ownerKey, choirId, scoreId: score.id };
  const [draftEpoch] = useState(() => markdownDraftEpoch(ownerKey));
  const [draft] = useState(() => readMarkdownDraft(scope, snapshot.attachment?.id ?? null));
  const [id] = useState(() => draft?.id ?? snapshot.attachment?.id ?? crypto.randomUUID());
  const [name, setName] = useState(draft?.name ?? snapshot.attachment?.name ?? t("markdownAttachmentRehearsalNotesMd"));
  const [text, setText] = useState(draft?.text ?? snapshot.text);
  const revision = useRef(draft?.revision ?? snapshot.attachment?.revision ?? null);
  const [editing, setEditing] = useState(Boolean(draft) || !snapshot.attachment);
  const [initial, setInitial] = useState(draft?.text ?? snapshot.text);
  const [validation, setValidation] = useState<string | null>(draft && draft.revision !== (snapshot.attachment?.revision ?? null) ? t("markdownAttachmentCloudContentHasChanged") : null);
  const [parseFailed, setParseFailed] = useState(false);
  const [plainText, setPlainText] = useState(false);
  const dirty = text !== base.text || name !== (base.attachment?.name ?? t("markdownAttachmentRehearsalNotesMd"));
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
    if (parseFailed || !attachmentNameSchema.safeParse(name).success || attachmentFormat(name)?.kind !== "markdown") { setValidation(t("markdownAttachmentUseMdFileName")); return false; }
    const blob = new Blob([text], { type: "text/markdown; charset=utf-8" });
    if (blob.size > 1024 * 1024) { setValidation(t("markdownAttachmentMarkdownMaximumMbCurrent")); return false; }
    setValidation(null);
    return await mutation.save({ kind: "markdown", name, text, revision: revision.current }) === true;
  };
  const downloadDraft = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = name.endsWith(".md") ? name : `${name}.md`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const discard = () => { removeMarkdownDraft(scope, base.attachment?.id ?? null, draftEpoch); setText(base.text); setName(base.attachment?.name ?? t("markdownAttachmentRehearsalNotesMd")); };
  return <AttachmentShell title={base.attachment?.name ?? t("attachmentPresentationCreateNewDocumentMd")} subtitle={scoreDisplayName(score.fileName)} wide document onClose={onClose} onBack={!base.attachment ? onBack : undefined}
    dirty={dirty} busy={mutation.pending} save={save} discard={discard} blocked={mutation.blocked || parseFailed} message={validation ?? mutation.message}>
    {!writable && <p className="attachment-help" role="status">{t("attachmentConnectionHasNotBeen")}</p>}
    {editing ? <>
      <TextField className="attachment-name-field" value={name} onChange={setName} isDisabled={mutation.blocked} maxLength={255}><Label>{t("markdownAttachmentFileName")}</Label><Input /></TextField>
      <div className="attachment-editor-region">{plainText ? <textarea className="attachment-plain-editor" aria-label={t("markdownAttachmentMarkdownText")} value={text} disabled={mutation.blocked || parseFailed} onChange={event => setText(event.target.value)} />
        : <AttachmentModule load={loadEditor} props={{ initial, disabled: mutation.blocked || parseFailed, onChange: setText, onError: (source: string) => { setText(source); setParseFailed(true); setValidation(t("markdownAttachmentMarkdownContainsFormatsThat")); } }} fallback={<LoadingStatus>{t("markdownAttachmentLoadingEditor")}</LoadingStatus>}
          failure={<><p role="alert">{t("markdownAttachmentEditorCannotOpenedTemporarily")}</p><Button className="secondary-button" onPress={() => setPlainText(true)}>{t("markdownAttachmentUsePlainTextEditing")}</Button></>} />}</div>
      {parseFailed && <pre className="attachment-source">{text}</pre>}
      <div className="attachment-actions"><Button className="primary-button" isDisabled={mutation.blocked || parseFailed || (Boolean(base.attachment) && !dirty)} onPress={() => void save()}>{mutation.pending ? t("saving") : t("save")}</Button>
        <MenuTrigger><Button className="attachment-menu" aria-label={t("markdownAttachmentMoreOperationsDocuments")}><MoreHorizontal size={18} /></Button>
          <Popover className="file-menu-popover"><Menu aria-label={t("markdownAttachmentDocumentOperation")} onAction={key => { if (key === "download-draft") downloadDraft(); }}>
            <MenuItem id="download-draft">{t("markdownAttachmentDownloadDraftMd")}</MenuItem>
          </Menu></Popover>
        </MenuTrigger>
        {mutation.needsRefresh && <Button className="secondary-button" isDisabled={!writable} onPress={() => void mutation.refresh().catch(() => {})}>{t("attachmentCheckSavedResults")}</Button>}
      </div>
    </> : <>
      {canModify && <div className="attachment-actions attachment-read-actions"><Button className="secondary-button" onPress={() => { setInitial(text); setEditing(true); }}><Pencil size={15} />{t("membershipManagementEdit")}</Button></div>}
      <div className="attachment-prose"><Markdown skipHtml urlTransform={safeAttachmentUrl} components={{ img: () => null, a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{text}</Markdown>{!text && <p className="attachment-help">{t("markdownAttachmentNoTextYet")}</p>}</div>
      {mutation.needsRefresh && <Button className="secondary-button" onPress={() => void mutation.refresh().catch(() => {})}>{t("markdownAttachmentRefreshAttachmentList")}</Button>}
    </>}
  </AttachmentShell>;
}
