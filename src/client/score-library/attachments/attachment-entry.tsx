import { Component, useState, type ReactNode } from "react";
import { Button } from "react-aria-components";
import { ChevronRight, FileAudio, FileText, Link as LinkIcon } from "lucide-react";
import { attachmentAccept } from "../../../shared/attachments";
import { scoreDisplayName } from "../../../shared/score-display-name";
import { diagnosticErrorType, recordFailure } from "../../diagnostics/diagnostics";
import { AttachmentRecovery } from "./attachment-module";
import AttachmentDialog from "./attachment-dialog";
import { AttachmentShell } from "./attachment-shell";
import type { AttachmentDialogProps, FileKind } from "./attachment-dialog";

const choices = [
  { kind: "musicxml", title: "可播放乐谱", detail: ".musicxml · .xml · .mxl", Icon: FileAudio },
  { kind: "audio", title: "音频", detail: attachmentAccept("audio").split(",").join(" · "), Icon: FileAudio },
  { kind: "pdf", title: "PDF", detail: ".pdf", Icon: FileText },
  { kind: "markdown", title: "文档（仅 .md）", detail: "上传已有文档，或直接编写", Icon: FileText },
  { kind: "link", title: "链接", detail: "网页、视频等参考网址", Icon: LinkIcon },
] as const;

// The picker and its exit layer ship with the drive, before any optional module.
export function AttachmentEntry(props: AttachmentDialogProps) {
  const [kind, setKind] = useState<FileKind | "link" | null>(null);
  const [composing, setComposing] = useState(false);
  const back = () => { setKind(null); setComposing(false); };
  const adding = props.selection.action === "add";
  if (adding && !kind) return <AttachmentShell picker title="添加附件" subtitle={scoreDisplayName(props.selection.score.fileName)} onClose={props.onClose}>
    <div className="attachment-type-list">{choices.map(({ kind, title, detail, Icon }) => <Button key={kind} className="attachment-type-option" aria-label={title} onPress={() => setKind(kind)}>
      <Icon size={22} strokeWidth={1.5} aria-hidden="true" /><span><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={17} aria-hidden="true" />
    </Button>)}</div>
  </AttachmentShell>;
  const selection = adding ? { score: props.selection.score, action: composing ? "markdown" as const : kind === "link" ? "link" as const : "upload" as const } : props.selection;
  return <AttachmentBoundary key={`${kind}:${composing}`} fallback={<AttachmentShell title="打开附件" subtitle={scoreDisplayName(props.selection.score.fileName)} onClose={props.onClose} onBack={adding ? back : undefined}>
    <AttachmentRecovery />
  </AttachmentShell>}>
    <AttachmentDialog {...props} selection={selection} uploadKind={kind && kind !== "link" ? kind : undefined} onBack={adding ? back : undefined} onCompose={() => setComposing(true)} />
  </AttachmentBoundary>;
}

class AttachmentBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    recordFailure({ operation: "drive", step: "attachment-entry", category: "internal", stage: "decode", errorType: diagnosticErrorType(error) });
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
