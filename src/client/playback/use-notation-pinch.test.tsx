import { useRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useNotationPinch } from './use-notation-pinch';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup() {
  const player = { getSnapshot: () => ({ status: 'ready' as const }), suspendFollow: vi.fn(), seekAt: vi.fn(), notationScale: vi.fn() };
  function Harness({ enabled = true }: { enabled?: boolean }) {
    const ref = useRef<HTMLDivElement>(null), visual = useNotationPinch(ref, player, enabled);
    return <><div ref={ref} data-testid="score"><div><div className="practice-notation-paper" data-testid="paper" /></div></div><output>{visual.zoom}</output><button onClick={visual.reset}>适合宽度</button></>;
  }
  const result = render(<Harness />), element = screen.getByTestId('score'), paper = screen.getByTestId('paper');
  Object.defineProperties(element, { clientWidth: { value: 400 }, clientHeight: { value: 500 } });
  Object.defineProperty(paper, 'offsetHeight', { value: 1000 });
  vi.spyOn(paper, 'getBoundingClientRect').mockImplementation(() => ({ left: -element.scrollLeft, top: -element.scrollTop } as DOMRect));
  return { ...result, player, Harness, element, paper };
}
const touches = (span: number) => [{ identifier: 1, clientX: 100, clientY: 100 }, { identifier: 2, clientX: 100 + span, clientY: 100 }];
it('magnifies without reflow, preserves the touched anchor and supplies real scroll extents', () => {
  const { element, paper, player } = setup();
  expect(fireEvent.touchStart(element, { touches: touches(100).slice(0, 1) })).toBe(true);
  expect(fireEvent.touchMove(element, { touches: touches(100).slice(0, 1) })).toBe(true);
  expect(fireEvent.touchStart(element, { touches: touches(100) })).toBe(false);
  expect(fireEvent.touchMove(element, { touches: touches(150) })).toBe(false);
  expect(paper.style.transform).toBe('scale(1.5)');
  expect(paper.style.width).toBe('400px');
  expect(paper.parentElement?.style.width).toBe('600px');
  expect(paper.parentElement?.style.height).toBe('1500px');
  expect(element.scrollLeft).toBe(50); // (150 * 1.5) - new midpoint 175
  expect(element.scrollTop).toBe(50);
  fireEvent.touchEnd(element, { touches: [] });
  expect(paper.style.transform).toBe('scale(1.5)');
  expect(player.notationScale).not.toHaveBeenCalled();
  expect(player.suspendFollow).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '适合宽度' }));
  expect(paper.style.transform).toBe('scale(1)');
});
it('cancels a gesture on view changes and removes listeners on unmount', () => {
  const { element, paper, Harness, rerender, unmount } = setup();
  fireEvent.touchStart(element, { touches: touches(100) });
  fireEvent.touchMove(element, { touches: touches(150) });
  rerender(<Harness enabled={false} />);
  expect(paper.style.transform).toBe('');
  expect(fireEvent.touchMove(element, { touches: touches(200) })).toBe(true);
  unmount();
  expect(fireEvent.touchStart(element, { touches: touches(100) })).toBe(true);
});
it('rolls canceled gestures back and suppresses a pinch tap, preserving keyboard activation', () => {
  const { element, paper, player } = setup();
  fireEvent.touchStart(element, { touches: touches(100) });
  fireEvent.touchMove(element, { touches: touches(150) });
  fireEvent.touchCancel(element, { touches: [] });
  expect(paper.style.transform).toBe('scale(1)');
  expect(fireEvent.click(element, { detail: 1 })).toBe(false);
  expect(fireEvent.click(element, { detail: 0 })).toBe(true);
  fireEvent.touchStart(element, { touches: touches(100).slice(0, 1) });
  expect(fireEvent.click(element, { detail: 1 })).toBe(false);
  expect(player.seekAt).toHaveBeenCalled();
  expect(player.notationScale).not.toHaveBeenCalled();
});
it('routes trackpad pinch to visual magnification while retaining native ordinary wheel scrolling', () => {
  const { element, player, paper } = setup();
  expect(fireEvent.wheel(element, { deltaY: -200 })).toBe(true);
  expect(fireEvent.wheel(element, { deltaY: -200, ctrlKey: true, clientX: 100, clientY: 100 })).toBe(false);
  expect(Number(screen.getByRole('status').textContent)).toBeGreaterThan(1);
  expect(paper.style.width).toBe('400px');
  expect(player.notationScale).not.toHaveBeenCalled();
  expect(player.suspendFollow).toHaveBeenCalled();
});
it('keeps Safari gesture magnification after release without committing a reflow', () => {
  const { element, paper, player } = setup();
  expect(fireEvent(element, new Event('gesturestart', { cancelable: true }))).toBe(false);
  const change = new Event('gesturechange', { cancelable: true });
  Object.defineProperty(change, 'scale', { value: 1.5 });
  fireEvent(element, change);
  fireEvent(element, new Event('gestureend', { cancelable: true }));
  expect(paper.style.transform).toBe('scale(1.5)');
  expect(player.notationScale).not.toHaveBeenCalled();
});
it.each(['third', 'replacement'])('rolls back when the original finger pair is invalidated by %s fingers', kind => {
  const { element, paper } = setup();
  fireEvent.touchStart(element, { touches: touches(100) });
  fireEvent.touchMove(element, { touches: touches(150) });
  if (kind === 'third') fireEvent.touchStart(element, { touches: [...touches(150), { identifier: 3, clientX: 400, clientY: 100 }] });
  else fireEvent.touchMove(element, { touches: touches(200).map(t => ({ ...t, identifier: t.identifier + 2 })) });
  fireEvent.touchEnd(element, { touches: [] });
  expect(paper.style.transform).toBe('scale(1)');
});

it('normalizes magnified taps for engine hit testing, but never seeks after a pan', () => {
  const { element, player } = setup();
  fireEvent.wheel(element, { deltaY: -Math.log(2) / .005, ctrlKey: true, clientX: 0, clientY: 0 });
  fireEvent.pointerDown(element, { clientX: 100, clientY: 120, pointerType: 'mouse' });
  fireEvent.click(element, { clientX: 100, clientY: 120, detail: 1 });
  expect(player.seekAt).toHaveBeenLastCalledWith(50, 60);
  player.seekAt.mockClear();
  fireEvent.pointerDown(element, { clientX: 100, clientY: 120, pointerType: 'mouse' });
  fireEvent.pointerMove(element, { clientX: 180, clientY: 120, pointerType: 'mouse' });
  fireEvent.click(element, { clientX: 180, clientY: 120, detail: 1 });
  expect(player.seekAt).not.toHaveBeenCalled();
});

it('bounds viewing zoom independently of the engraving limits', () => {
  const { element, paper, player } = setup();
  fireEvent.touchStart(element, { touches: touches(100) });
  fireEvent.touchMove(element, { touches: touches(1000) });
  fireEvent.touchEnd(element, { touches: [] });
  expect(paper.style.transform).toBe('scale(4)');
  fireEvent.touchStart(element, { touches: touches(100) });
  fireEvent.touchMove(element, { touches: touches(1) });
  fireEvent.touchEnd(element, { touches: [] });
  expect(paper.style.transform).toBe('scale(1)');
  expect(player.notationScale).not.toHaveBeenCalled();
});
