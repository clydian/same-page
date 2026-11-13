import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PlayerSession } from '@same-page/player';
import { PlaybackAudioHint } from './playback-audio-hint';

const session = {} as PlayerSession;
const message = '若无声，请关闭静音模式并检查媒体音量。';
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('expires after eight seconds and does not return on playback updates in the same session', () => {
  const { rerender } = render(<PlaybackAudioHint session={session} message={message} />);
  act(() => vi.advanceTimersByTime(7999)); expect(screen.getByText(message)).toBeVisible();
  rerender(<PlaybackAudioHint session={session} message={message} />);
  act(() => vi.advanceTimersByTime(1)); expect(screen.queryByText(message)).not.toBeInTheDocument();
  rerender(<PlaybackAudioHint session={session} message={message} />);
  expect(screen.queryByText(message)).not.toBeInTheDocument();
});
it('can close immediately and becomes available for a different practice session', () => {
  const { rerender } = render(<PlaybackAudioHint session={session} message={message} />);
  fireEvent.click(screen.getByRole('button', { name: '关闭播放声音提示' }));
  expect(screen.queryByText(message)).not.toBeInTheDocument();
  rerender(<PlaybackAudioHint session={{} as PlayerSession} message={message} />);
  expect(screen.getByText(message)).toBeVisible();
  act(() => vi.advanceTimersByTime(8000)); expect(screen.queryByText(message)).not.toBeInTheDocument();
});
it('starts timing when advice arrives and pauses expiry while hovered or focused', () => {
  const { rerender } = render(<PlaybackAudioHint session={session} />);
  act(() => vi.advanceTimersByTime(20000));
  rerender(<PlaybackAudioHint session={session} message={message} />);
  const hint = screen.getByLabelText('播放声音提示');
  fireEvent.mouseEnter(hint); act(() => vi.advanceTimersByTime(10000));
  expect(screen.getByText(message)).toBeVisible();
  fireEvent.mouseLeave(hint); fireEvent.focus(screen.getByRole('button'));
  act(() => vi.advanceTimersByTime(10000)); expect(screen.getByText(message)).toBeVisible();
  fireEvent.blur(screen.getByRole('button'), { relatedTarget: document.body });
  act(() => vi.advanceTimersByTime(8000)); expect(screen.queryByText(message)).not.toBeInTheDocument();
});
