import { Component, useState, type ReactNode } from "react";
import { Button } from "react-aria-components";
import { Link } from "react-router-dom";
import { ChevronRight, FileAudio, FileText, Link as LinkIcon } from "lucide-react";
import { attachmentAccept } from "../../../shared/attachments";
import { scoreDisplayName } from "../../../shared/score-display-name";
import { diagnosticErrorType, recordFailure } from "../../diagnostics/diagnostics";
import { AttachmentModule } from "./attachment-module";
import { AttachmentLoading, AttachmentShell } from "./attachment-shell";
import type { AttachmentDialogProps, FileKind } from "./attachment-dialog";

const loadDialog = () => import("./attachment-dialog");
const choices = [
  { kind: "musicxml", title: "可播放乐谱", detail: ".musicxml · .xml · .mxl", Icon: FileAudio },
  { kind: "audio", title: "音频", detail: attachmentAccept("audio").split(",").join(" · "), Icon: FileAudio },
  { kind: "pdf", title: "PDF", detail: ".pdf", Icon: FileText },
  { kind: "markdown", title: "文档（仅 .md）", detail: "上传已有文档，或直接编写", Icon: FileText },
  { kind: "link", title: "链接", detail: "网页、视频等参考网址", Icon: LinkIcon },
] as const;

// The picker and its exit layer ship with the drive, before any optional module.
export function AttachmentEntry({ load = loadDialog, ...props }: AttachmentDialogProps & { load?: typeof loadDialog }) {
  const [kind, setKind] = useState<FileKind | "link" | null>(null);
  const [composing, setComposing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const back = () => { setKind(null); setComposing(false); setAttempt(value => value + 1); };
  const adding = props.selection.action === "add";
  if (adding && !kind) return <AttachmentShell picker title="添加附件" subtitle={scoreDisplayName(props.selection.score.fileName)} onClose={props.onClose}>
    <div className="attachment-type-list">{choices.map(({ kind, title, detail, Icon }) => <Button key={kind} className="attachment-type-option" aria-label={title} onPress={() => setKind(kind)}>
      <Icon size={22} strokeWidth={1.5} aria-hidden="true" /><span><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={17} aria-hidden="true" />
    </Button>)}</div>
  </AttachmentShell>;
  const selection = adding ? { score: props.selection.score, action: composing ? "markdown" as const : kind === "link" ? "link" as const : "upload" as const } : props.selection;
  return <AttachmentBoundary key={attempt} fallback={<AttachmentShell title="打开附件" subtitle={scoreDisplayName(props.selection.score.fileName)} onClose={props.onClose} onBack={adding ? back : undefined}>
    <p role="alert">附件暂时无法打开，可能是连接中断或应用资源暂不可用。云盘内容仍保留。</p>
    <Button className="primary-button" onPress={() => setAttempt(value => value + 1)}>重试打开</Button>{" "}<Link to="/diagnostics">反馈问题</Link>
  </AttachmentShell>}>
    <AttachmentModule load={load} props={{ ...props, selection, uploadKind: kind && kind !== "link" ? kind : undefined, onBack: adding ? back : undefined, onCompose: () => setComposing(true) }} fallback={<AttachmentLoading selection={selection} onClose={props.onClose} />} />
  </AttachmentBoundary>;
}

class AttachmentBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    const loading = error instanceof Error && error.name === "AttachmentModuleError";
    recordFailure({ operation: "drive", step: "attachment-entry", category: loading ? "network" : "internal", stage: loading ? "prepare" : "decode", errorType: diagnosticErrorType(loading && error instanceof Error ? error.cause : error) });
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
