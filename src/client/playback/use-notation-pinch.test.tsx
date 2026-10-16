import { useRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useNotationPinch } from './use-notation-pinch';

afterEach(cleanup);
function setup() {
  let scale = .6;
  const player = { getSnapshot: () => ({ status: 'ready' as const, notationScale: scale }), notationScale: vi.fn((value: number) => { scale = value; }) };
  function Harness({ enabled = true }: { enabled?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    useNotationPinch(ref, player, enabled);
    return <div ref={ref} data-testid="score"><div className="practice-notation-paper" data-testid="paper" /></div>;
  }
  return { ...render(<Harness />), player, Harness, element: screen.getByTestId('score') };
}
const touches = (distance: number) => [{ identifier: 1, clientX: 100, clientY: 100 }, { identifier: 2, clientX: 100 + distance, clientY: 100 }];
it('owns a two-finger pinch and uses the initial distance, retaining native one-finger scrolling', () => {
  const { element, player } = setup();
  expect(fireEvent.touchStart(element, { touches: touches(100).slice(0, 1) })).toBe(true);
  expect(fireEvent.touchMove(element, { touches: touches(100).slice(0, 1) })).toBe(true);
  expect(fireEvent.touchStart(element, { touches: touches(100) })).toBe(false);
  expect(fireEvent.touchMove(element, { touches: touches(150) })).toBe(false);
  expect(player.notationScale).not.toHaveBeenCalled();
  expect(screen.getByTestId('paper').style.transform).toBe('scale(1.5)');
  fireEvent.touchMove(element, { touches: touches(200) });
  expect(player.notationScale).not.toHaveBeenCalled();
  fireEvent.touchEnd(element, { touches: [] });
  expect(player.notationScale).toHaveBeenLastCalledWith(1.2);
  expect(screen.getByTestId('paper').style.transform).toBe('');
  fireEvent.touchStart(element, { touches: touches(100) });
  fireEvent.touchMove(element, { touches: touches(25) });
  fireEvent.touchEnd(element, { touches: [] });
  expect(player.notationScale).toHaveBeenLastCalledWith(.3);
});
it('cancels on view changes and removes listeners on unmount', () => {
  const { element, player, Harness, rerender, unmount } = setup();
  fireEvent.touchStart(element, { touches: touches(100) });
  rerender(<Harness enabled={false} />);
  expect(fireEvent.touchMove(element, { touches: touches(200) })).toBe(true);
  expect(player.notationScale).not.toHaveBeenCalled();
  unmount();
  expect(fireEvent.touchStart(element, { touches: touches(100) })).toBe(true);
});
it('ignores canceled fingers and suppresses a pinch tap', () => {
  const { element, player } = setup();
  fireEvent.touchStart(element, { touches: touches(100) });
  fireEvent.touchCancel(element, { touches: [] });
  fireEvent.touchMove(element, { touches: touches(200) });
  expect(player.notationScale).not.toHaveBeenCalled();
  expect(fireEvent.click(element, { detail: 1 })).toBe(false);
  fireEvent.touchStart(element, { touches: touches(100).slice(0, 1) });
  expect(fireEvent.click(element, { detail: 1 })).toBe(true);
});
it('routes trackpad pinch wheel to notation while leaving ordinary wheel scrolling native', () => {
  const { element, player } = setup();
  expect(fireEvent.wheel(element, { deltaY: -200 })).toBe(true);
  expect(player.notationScale).not.toHaveBeenCalled();
  expect(fireEvent.wheel(element, { deltaY: -200, ctrlKey: true })).toBe(false);
  expect(player.notationScale.mock.lastCall?.[0]).toBeGreaterThan(.6);
});

it('previews Safari trackpad gestures and commits only on gesture end', () => {
  const { element, player } = setup();
  expect(fireEvent(element, new Event('gesturestart', { cancelable: true }))).toBe(false);
  const change = new Event('gesturechange', { cancelable: true });
  Object.defineProperty(change, 'scale', { value: 1.5 });
  expect(fireEvent(element, change)).toBe(false);
  expect(screen.getByTestId('paper').style.transform).toBe('scale(1.5)');
  expect(player.notationScale).not.toHaveBeenCalled();
  fireEvent(element, new Event('gestureend', { cancelable: true }));
  expect(player.notationScale).toHaveBeenLastCalledWith(.9);
  expect(screen.getByTestId('paper').style.transform).toBe('');
});
it('cancels preview on a third finger and permits a later tap or keyboard activation', () => {
  const { element, player } = setup();
  fireEvent.touchStart(element, { touches: touches(100) });
  fireEvent.touchMove(element, { touches: touches(150) });
  fireEvent.touchStart(element, { touches: [...touches(150), { identifier: 3, clientX: 400, clientY: 100 }] });
  fireEvent.touchEnd(element, { touches: [] });
  expect(player.notationScale).not.toHaveBeenCalled();
  expect(screen.getByTestId('paper').style.transform).toBe('');
  expect(fireEvent.click(element, { detail: 0 })).toBe(true);
  fireEvent.pointerDown(element, { pointerType: 'mouse' });
  expect(fireEvent.click(element, { detail: 1 })).toBe(true);
});

it('does not commit a preview when the original finger pair is replaced', () => {
  const { element, player } = setup();
  fireEvent.touchStart(element, { touches: touches(100) });
  fireEvent.touchMove(element, { touches: touches(150) });
  fireEvent.touchMove(element, { touches: touches(200).map(touch => ({ ...touch, identifier: touch.identifier + 2 })) });
  fireEvent.touchEnd(element, { touches: [] });
  expect(player.notationScale).not.toHaveBeenCalled();
  expect(screen.getByTestId('paper').style.transform).toBe('');
});
