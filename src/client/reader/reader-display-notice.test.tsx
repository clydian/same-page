import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReaderDisplayNotice } from './reader-display-notice';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('expires restored-display feedback and acknowledges it without reloading the document', () => {
  const dismiss = vi.fn(); render(<ReaderDisplayNotice message="已保留原谱面" onDismiss={dismiss} />);
  act(() => vi.advanceTimersByTime(8000));
  expect(screen.queryByText('已保留原谱面')).not.toBeInTheDocument(); expect(dismiss).toHaveBeenCalledOnce();
});
it('allows immediate dismissal', () => {
  const dismiss = vi.fn(); render(<ReaderDisplayNotice message="已保留原谱面" onDismiss={dismiss} />);
  fireEvent.click(screen.getByRole('button', { name: '关闭显示恢复提示' })); expect(dismiss).toHaveBeenCalledOnce();
});
