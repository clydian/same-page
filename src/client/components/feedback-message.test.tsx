import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FeedbackMessage } from './feedback-message';
import { useFeedbackMessage } from './use-feedback-message';

function Fixture() {
  const feedback = useFeedbackMessage();
  return <><button onClick={() => feedback.setMessage('已复制', { duration: 5000 })}>成功</button>
    <button onClick={() => feedback.setMessage('结果未确认，请重新读取')}>失败</button>
    <FeedbackMessage feedback={feedback} /></>;
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('expires success without allowing its old timer to clear a later error', () => {
  render(<Fixture />); fireEvent.click(screen.getByText('成功'));
  act(() => vi.advanceTimersByTime(5000)); expect(screen.queryByText('已复制')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('成功')); act(() => vi.advanceTimersByTime(4000));
  fireEvent.click(screen.getByText('失败')); act(() => vi.advanceTimersByTime(20000));
  expect(screen.getByText('结果未确认，请重新读取')).toBeVisible();
  expect(screen.queryByRole('button', { name: '关闭操作提示' })).not.toBeInTheDocument();
});
it('supports manual dismissal and pauses while a person reads or focuses the message', () => {
  render(<Fixture />); fireEvent.click(screen.getByText('成功'));
  const notice = screen.getByText('已复制').parentElement!;
  fireEvent.mouseEnter(notice); act(() => vi.advanceTimersByTime(10000));
  expect(screen.getByText('已复制')).toBeVisible(); fireEvent.mouseLeave(notice);
  const close = screen.getByRole('button', { name: '关闭操作提示' }); fireEvent.focus(close);
  act(() => vi.advanceTimersByTime(10000)); expect(screen.getByText('已复制')).toBeVisible();
  fireEvent.click(close); expect(screen.queryByText('已复制')).not.toBeInTheDocument();
});
