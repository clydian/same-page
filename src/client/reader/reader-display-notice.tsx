import { useEffect } from 'react';
import { FeedbackMessage } from '../components/feedback-message';
import { useFeedbackMessage } from '../components/use-feedback-message';

export function ReaderDisplayNotice({ message, onDismiss }: { message: string; onDismiss(): void }) {
  const feedback = useFeedbackMessage(message, { duration: 8000 });
  useEffect(() => { if (!feedback.message) onDismiss(); }, [feedback.message, onDismiss]);
  return <FeedbackMessage feedback={feedback} className="reader-display-notice" closeLabel="关闭显示恢复提示" />;
}
