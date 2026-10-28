import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlaybackPreparationNotice } from './playback-preparation-notice';

afterEach(() => vi.useRealTimers());
it('shows a real phase percentage and never fabricates progress for unknown work', () => {
 const {rerender}=render(<PlaybackPreparationNotice message="正在加载音色…" loaded={25} total={100} retry={()=>{}} />);
 expect(screen.getByText('25%')).toBeVisible();expect(screen.getByRole('progressbar')).toHaveAttribute('value','25');
 rerender(<PlaybackPreparationNotice message="正在处理乐谱…" retry={()=>{}} />);
 expect(screen.queryByText('25%')).not.toBeInTheDocument();expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');
});
it('offers an explicit retry during a long phase and fences the hint after phase change', () => {
 vi.useFakeTimers();const retry=vi.fn();
 const {rerender,unmount}=render(<PlaybackPreparationNotice message="正在加载音色…" retry={retry} />);
 act(()=>vi.advanceTimersByTime(30000));fireEvent.click(screen.getByRole('button',{name:'重试'}));expect(retry).toHaveBeenCalledOnce();
 rerender(<PlaybackPreparationNotice message="正在完成谱面排版…" retry={retry} />);
 expect(screen.queryByRole('button',{name:'重试'})).not.toBeInTheDocument();unmount();
});
