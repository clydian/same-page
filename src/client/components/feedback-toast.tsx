import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, Text, UNSTABLE_Toast as Toast, UNSTABLE_ToastContent as ToastContent, UNSTABLE_ToastQueue as ToastQueue, UNSTABLE_ToastRegion as ToastRegion } from 'react-aria-components';
import { X } from 'lucide-react';
import type { useFeedbackMessage } from './use-feedback-message';
import './feedback-toast.css';

type Feedback = ReturnType<typeof useFeedbackMessage>;
type Notice = { text: string; closeLabel: string; interaction: Feedback['interaction'] };
const QueueContext = createContext<ToastQueue<Notice> | null>(null);

/** One visible result, shared across pages and dialogs. The source owns its lifetime. */
export function FeedbackToastProvider({ children }: { children: ReactNode }) {
  const [queue] = useState(() => new ToastQueue<Notice>({ maxVisibleToasts: 1 }));
  return <QueueContext value={queue}>{children}<FeedbackToastRegion queue={queue} /></QueueContext>;
}

function FeedbackToastRegion({ queue }: { queue: ToastQueue<Notice> }) {
  const subscribe = useCallback((listener: () => void) => queue.subscribe(listener), [queue]);
  const visible = useSyncExternalStore(subscribe, () => queue.visibleToasts);
  const region = useRef<HTMLDivElement>(null);
  const notice = visible[0];
  const interaction = notice?.content.interaction;
  useEffect(() => {
    const element = region.current;
    if (!element || !interaction) return;
    // ToastRegion filters React focus handlers; include its F6 landmark itself
    // in the source timer's pause behavior, as well as the toast's children.
    const focus = () => interaction.onFocusCapture();
    const blur = (event: FocusEvent) => interaction.onBlurCapture({ currentTarget: element, relatedTarget: event.relatedTarget });
    element.addEventListener('focusin', focus);
    element.addEventListener('focusout', blur);
    if (element.contains(document.activeElement)) focus();
    return () => { element.removeEventListener('focusin', focus); element.removeEventListener('focusout', blur); };
  }, [interaction]);
  // Mount with content so React Aria can register the portal's keyboard landmark.
  if (!notice) return null;
  return <ToastRegion ref={region} queue={queue} className="feedback-toast-region" aria-label="操作提示">
      {({ toast }) => <div className="feedback-toast-interaction" {...toast.content.interaction}><Toast toast={toast} className="feedback-toast">
        <ToastContent role="status" aria-live="polite"><Text slot="title">{toast.content.text}</Text></ToastContent>
        <Button slot="close" className="feedback-toast-close" aria-label={toast.content.closeLabel}><X size={18} aria-hidden="true" /></Button>
      </Toast></div>}
    </ToastRegion>;
}

export function TemporaryFeedback({ feedback, closeLabel }: { feedback: Feedback; closeLabel: string }) {
  const queue = useContext(QueueContext);
  // Also works in isolated surfaces and component previews outside AppRoutes.
  return queue ? <QueuedFeedback queue={queue} feedback={feedback} closeLabel={closeLabel} />
    : <FeedbackToastProvider><TemporaryFeedback feedback={feedback} closeLabel={closeLabel} /></FeedbackToastProvider>;
}

function QueuedFeedback({ queue, feedback, closeLabel }: { queue: ToastQueue<Notice>; feedback: Feedback; closeLabel: string }) {
  const { message, dismiss, interaction } = feedback;
  useEffect(() => {
    if (!message) return;
    // A newer result replaces the previous one rather than queuing stale notices.
    queue.clear();
    let current = true;
    const key = queue.add({ text: message, closeLabel, interaction }, { onClose: () => { if (current) dismiss(); } });
    return () => { current = false; queue.close(key); };
  }, [queue, message, dismiss, interaction, closeLabel]);
  return null;
}
