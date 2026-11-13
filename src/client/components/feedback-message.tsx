import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import type { useFeedbackMessage } from './use-feedback-message';
import './feedback-message.css';

export function FeedbackMessage({ feedback, className = '', children, fallback, closeLabel = '关闭操作提示', dismissible = feedback.temporary }: {
  feedback: ReturnType<typeof useFeedbackMessage>; className?: string; children?: ReactNode; fallback?: string; closeLabel?: string; dismissible?: boolean;
}) {
  const text = feedback.message || fallback;
  if (!text) return null;
  return <div className={`feedback-message ${className}`} {...feedback.interaction}>
    <span role="status">{text}</span>{children}
    {feedback.message && dismissible && <button type="button" className="feedback-message-close" aria-label={closeLabel} onClick={feedback.dismiss}><X size={16} aria-hidden="true" /></button>}
  </div>;
}
