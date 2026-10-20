import { createContext } from 'react';
import type { PointerEvent } from 'react';
import type { AnnotationEditor } from './annotation-editor';
import type { AnnotationInteractionHandle, AnnotationOverlayInteraction } from './annotation-overlay';

export type ObjectPointerPhase = 'down' | 'move' | 'up' | 'cancel';
export interface AnnotationPageHandle extends AnnotationInteractionHandle {
  canYield(): boolean;
  deactivate(): void;
  objectPointer(phase: ObjectPointerPhase, event: PointerEvent<Element>): boolean;
}
type Snapshot = { activePage: number | null; pinnedPages: number[]; interaction: AnnotationOverlayInteraction };
export const emptyAnnotationPages: Snapshot = { activePage: null, pinnedPages: [], interaction: 'idle' };
export const AnnotationPagesContext = createContext<AnnotationPages | null>(null);

// One continuous reader has one input owner and one durable editor/history.
// Other visible pages remain editable; changing input owner never changes the
// viewport-center reading page or remounts the outgoing overlay during a write.
export class AnnotationPages implements AnnotationInteractionHandle {
  private handles = new Map<number, AnnotationPageHandle>();
  private interactions = new Map<number, AnnotationOverlayInteraction>();
  private retained = new Set<number>();
  private snapshot = emptyAnnotationPages;
  private listeners = new Set<() => void>();
  constructor(private editor: AnnotationEditor | null) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  connect() {
    return this.editor?.subscribe(() => {
      if (this.editor?.getSnapshot() === 'idle') this.retained.clear();
      else if (this.snapshot.activePage !== null) this.retained.add(this.snapshot.activePage);
      this.publish();
    });
  }
  register(page: number, handle: AnnotationPageHandle) {
    this.handles.set(page, handle);
    return () => {
      if (this.handles.get(page) !== handle) return;
      this.handles.delete(page);
      this.interactions.delete(page);
      this.publish();
    };
  }
  activate(page: number) {
    const previous = this.snapshot.activePage;
    if (previous === page) return true;
    if (this.editor && ['failed', 'finishing'].includes(this.editor.getSnapshot())) return false;
    if ([...this.handles.values()].some(handle => !handle.canYield())) return false;
    if (previous !== null) {
      this.handles.get(previous)?.deactivate();
      if (this.editor?.getSnapshot() !== 'idle') this.retained.add(previous);
    }
    this.snapshot = { ...this.snapshot, activePage: page };
    this.publish(true);
    return true;
  }
  setInteraction(page: number, interaction: AnnotationOverlayInteraction) {
    this.interactions.set(page, interaction);
    this.publish();
  }
  forwardObjectPointer(page: number, phase: ObjectPointerPhase, event: PointerEvent<Element>) {
    for (const [owner, handle] of this.handles) {
      if (owner !== page && handle.ownsObjectGesture() && handle.objectPointer(phase, event)) return true;
    }
    return false;
  }
  interrupt = () => { for (const handle of this.handles.values()) handle.interrupt(); };
  ownsObjectGesture = () => [...this.handles.values()].some(handle => handle.ownsObjectGesture());
  private publish(force = false) {
    const pinnedPages = [...new Set([...this.retained, ...(this.snapshot.activePage === null ? [] : [this.snapshot.activePage])])].sort((a, b) => a - b);
    const interaction = [...this.interactions.values()].find(value => value !== 'idle') ?? 'idle';
    if (!force && interaction === this.snapshot.interaction && pinnedPages.join(',') === this.snapshot.pinnedPages.join(',')) return;
    this.snapshot = { ...this.snapshot, pinnedPages, interaction };
    for (const listener of this.listeners) listener();
  }
}
