import { liveQuery } from "dexie";
import type { AnnotationLayerSummary } from "../../shared/annotations";
import { scorePdfFileName } from "../../shared/score-display-name";
import { readScoreAnnotationState } from "../annotations/annotation-state";
import { LocalWorkspaceOwnerChangedError, type LocalWorkspace } from "../platform/local-workspace";
import { holdUpdate } from "../updates/update-safety";
import type { PDFDocumentProxy } from "./pdf-document";
import { exportScore } from "./export-score";
import { prepareExport } from "./prepare-export";

export type ExportTarget = {
  workspace: LocalWorkspace;
  versionId: string;
  fileName: string;
  authenticatedUserId: string | null;
  source?: PDFDocumentProxy;
  layers?: AnnotationLayerSummary[];
};

type ExportSnapshot = {
  prepared: boolean;
  layers: AnnotationLayerSummary[];
  selected: string[];
  includeNotes: boolean;
  file: File | null;
  message: string | null;
  readError: string | null;
  sharing: boolean;
  shareFailed: boolean;
};

// One mounted dialog owns one immutable target. A borrowed reader PDF is never destroyed.
export class ExportSession {
  private state: ExportSnapshot;
  private listeners = new Set<() => void>();
  private active = false;
  private source?: PDFDocumentProxy;
  private preparation?: ReturnType<typeof prepareExport>;
  private releasePreparation?: () => void;
  private observation?: { unsubscribe(): void };
  private observedSnapshot: string | null = null;
  private generated: { file: File; snapshot: string } | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private generation?: { controller: AbortController; release(): void };
  private selectionInitialized: boolean;

  constructor(private target: ExportTarget) {
    this.source = target.source;
    this.selectionInitialized = target.layers !== undefined;
    this.state = {
      prepared: Boolean(target.source), layers: target.layers ?? [],
      selected: defaults(target.layers ?? []), includeNotes: true,
      file: null, message: null, readError: null, sharing: false, shareFailed: false,
    };
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<ExportSnapshot>) {
    if (!this.active) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.observe();
    if (!this.source) this.prepare();
  }

  dispose() {
    this.active = false;
    this.observation?.unsubscribe();
    this.cancelGeneration();
    this.preparation?.destroy();
    this.preparation = undefined;
    this.releasePreparation?.();
  }

  private observe() {
    this.observation?.unsubscribe();
    this.observedSnapshot = null;
    this.publish({ file: null, readError: null });
    // Catch inside the query so a failed read can be retried without remounting.
    this.observation = liveQuery(async () => {
      try { return { state: await readScoreAnnotationState(this.target.workspace), error: null }; }
      catch (error) { return { state: null, error }; }
    }).subscribe(result => {
      if (!this.active) return;
      if (!result.state) {
        this.observedSnapshot = null;
        this.cancelGeneration();
        this.publish({ file: null, readError: result.error instanceof LocalWorkspaceOwnerChangedError
          ? "登录状态已变化，请关闭后重新打开分享。" : "无法读取本机笔记，请重试。" });
        return;
      }
      this.observedSnapshot = JSON.stringify(result.state);
      const selected = this.selectionInitialized || !this.source ? this.state.selected : defaults(result.state.layers);
      if (this.source) this.selectionInitialized = true;
      this.publish({ layers: result.state.layers, selected, readError: null });
      // Generation itself may pull fresh notes. Let it finish its permission checks
      // before deciding whether the observed snapshot requires another generation.
      this.reconcile();
    });
  }

  private prepare() {
    this.preparation?.destroy();
    this.releasePreparation?.();
    const task = this.preparation = prepareExport(this.target.workspace, this.target.versionId);
    const release = this.releasePreparation = holdUpdate();
    void task.promise.then(result => {
      if (!this.active || this.preparation !== task) return;
      this.source = result.source;
      const selected = this.selectionInitialized ? this.state.selected : defaults(result.layers);
      this.selectionInitialized = true;
      this.publish({ prepared: true, selected });
      this.reconcile();
    }).catch(error => {
      if (this.active && this.preparation === task) {
        this.publish({ message: errorMessage(error, "无法准备 PDF，请检查网络后重试。") });
      }
    }).finally(release);
  }

  setIncludeNotes = (includeNotes: boolean) => {
    if (!this.active || this.state.sharing || includeNotes === this.state.includeNotes) return;
    this.changeSelection({ includeNotes });
  };

  setLayerSelected = (id: string, checked: boolean) => {
    if (!this.active || this.state.sharing) return;
    const selected = this.state.selected.filter(value => value !== id);
    if (checked && this.state.layers.some(layer => layer.id === id)) selected.push(id);
    this.changeSelection({ selected });
  };

  removeUnavailableLayers = () => {
    if (!this.active || this.state.sharing) return;
    this.changeSelection({ selected: this.state.selected.filter(id => this.state.layers.some(layer => layer.id === id)) });
  };

  private changeSelection(patch: Partial<ExportSnapshot>) {
    this.cancelGeneration();
    this.generated = null;
    this.publish({ ...patch, file: null, message: null, shareFailed: false });
    this.reconcile();
  }

  retry = () => {
    if (!this.active || this.state.sharing) return;
    this.publish({ message: null, shareFailed: false });
    if (this.state.readError) this.observe();
    if (!this.source) this.prepare();
    this.reconcile();
  };

  private reconcile() {
    clearTimeout(this.timer);
    if (!this.active) return;
    const file = this.observedSnapshot && this.generated?.snapshot === this.observedSnapshot ? this.generated.file : null;
    this.publish({ file });
    if (file || !this.source || !this.observedSnapshot || this.state.readError || this.state.message || this.generation) return;
    this.timer = setTimeout(() => { void this.generate(); }, 300);
  }

  private cancelGeneration() {
    clearTimeout(this.timer);
    this.generation?.controller.abort();
    this.generation?.release();
    this.generation = undefined;
  }

  private async generate() {
    if (!this.active || !this.source) return;
    const task = this.generation = { controller: new AbortController(), release: holdUpdate() };
    this.generated = null;
    this.publish({ file: null, shareFailed: false });
    try {
      const result = await exportScore(this.target.workspace, this.source, this.target.versionId,
        this.state.includeNotes ? [...this.state.selected] : [], this.target.authenticatedUserId, task.controller.signal);
      if (!this.active || this.generation !== task) return;
      this.generated = { file: new File([result.blob], scorePdfFileName(this.target.fileName), { type: "application/pdf" }), snapshot: result.snapshot };
    } catch (error) {
      if (this.active && this.generation === task) this.publish({ message: errorMessage(error, "无法准备 PDF。请确认联网与笔记数据后重试。") });
    } finally {
      task.release();
      if (this.generation === task) {
        this.generation = undefined;
        this.reconcile();
      }
    }
  }

  // Invoke from the press itself: no awaited preparation before navigator.share.
  share = async () => {
    const file = this.state.file;
    if (!this.active || !file || this.state.sharing) return;
    this.publish({ sharing: true, message: null });
    const release = holdUpdate();
    try { await navigator.share({ files: [file] }); }
    catch (error) {
      if (!((error instanceof Error || error instanceof DOMException) && error.name === "AbortError")) {
        this.publish({ shareFailed: true, message: "无法打开系统分享，请重试或下载 PDF。" });
      }
    } finally { this.publish({ sharing: false }); release(); }
  };
}

function defaults(layers: AnnotationLayerSummary[]) {
  return layers.filter(layer => layer.subscribed || (layer.kind === "personal" && layer.canEdit)).map(layer => layer.id);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && /[\u3400-\u9fff]/.test(error.message) ? error.message : fallback;
}
