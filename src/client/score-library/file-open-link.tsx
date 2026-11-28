import { useCallback, useLayoutEffect, useRef } from "react";
import { Link, type LinkProps } from "react-router-dom";
import "./file-open-link.css";

type Props = Pick<LinkProps, "children" | "className" | "onClick" | "aria-label" | "aria-description" | "target" | "rel"> &
  ({ to: string; href?: never; unavailable?: string; onLongPress?: () => void } | { href: string; to?: never; unavailable?: never; onLongPress?: never });
type TouchPress = { pointerId: number; started: number; x: number; y: number; contacts: Set<number>; blocked: boolean };
const MAX_TAP_MS = 500;
const MAX_TAP_MOVEMENT = 10;

export function FileOpenLink({ className = "", onClick, to, href, unavailable, onLongPress, ...props }: Props) {
  const target = useRef<HTMLElement>(null);
  const setTarget = useCallback((node: HTMLElement | null) => { target.current = node; }, []);
  const press = useRef<TouchPress | null>(null);
  const cancelHold = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    // A recycled link must not activate a new destination on an old release.
    if (press.current) press.current.blocked = true;
    target.current?.removeAttribute("data-touch-active");
    return () => cancelHold.current?.();
  }, [to, href, unavailable]);
  const clear = () => {
    cancelHold.current?.();
    press.current = null;
    target.current?.removeAttribute("data-touch-active");
  };
  const finish = (event: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
    if (event.pointerType !== "touch" || !press.current?.contacts.has(event.pointerId)) return;
    cancelHold.current?.();
    const current = press.current;
    current.blocked ||= cancelled || performance.now() - current.started >= MAX_TAP_MS || Math.hypot(event.clientX - current.x, event.clientY - current.y) >= MAX_TAP_MOVEMENT;
    current.contacts.delete(event.pointerId);
    if (!current.contacts.size) event.currentTarget.removeAttribute("data-touch-active");
  };
  const shared = { ...props, ref: setTarget, className: `file-open-link ${className}`,
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch") { clear(); return; }
      cancelHold.current?.();
      if (!event.isPrimary && press.current?.contacts.size) {
        press.current.contacts.add(event.pointerId);
        press.current.blocked = true;
      } else {
        const current = { pointerId: event.pointerId, started: performance.now(), x: event.clientX, y: event.clientY, contacts: new Set([event.pointerId]), blocked: !event.isPrimary };
        press.current = current;
        if (onLongPress && event.isPrimary) {
          const controller = new AbortController();
          const timer = window.setTimeout(() => {
            cancelHold.current?.();
            current.blocked = true;
            onLongPress();
          }, MAX_TAP_MS);
          cancelHold.current = () => {
            window.clearTimeout(timer);
            controller.abort();
            cancelHold.current = undefined;
          };
          // A second finger can land outside the file row during a pinch.
          event.currentTarget.ownerDocument.addEventListener("pointerdown", other => {
            if (other.pointerType !== "touch" || other.pointerId === current.pointerId) return;
            current.blocked = true;
            cancelHold.current?.();
          }, { capture: true, signal: controller.signal });
        }
      }
      event.currentTarget.setAttribute("data-touch-active", "");
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const current = press.current;
      if (event.pointerType === "touch" && current?.contacts.has(event.pointerId) && Math.hypot(event.clientX - current.x, event.clientY - current.y) >= MAX_TAP_MOVEMENT) {
        current.blocked = true;
        cancelHold.current?.();
      }
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => finish(event, false),
    onPointerCancel: (event: React.PointerEvent<HTMLElement>) => finish(event, true),
    onContextMenu: (event: React.MouseEvent<HTMLElement>) => {
      // Unknown/keyboard/mouse sources retain the browser menu, including on
      // hybrid devices. A coarse pointer media query cannot identify a press.
      const source = event.nativeEvent as MouseEvent & Partial<PointerEvent> & { sourceCapabilities?: { firesTouchEvents: boolean } };
      if (source.pointerType !== "touch" && !(onLongPress && !source.pointerType && source.sourceCapabilities?.firesTouchEvents)) return;
      event.preventDefault();
      // A delayed menu from an older contact cannot withdraw a fresh input.
      // The hold timer may still open the app menu for a stationary touch.
      const current = press.current;
      if (current && (source.pointerId === undefined || source.pointerId === current.pointerId || current.contacts.has(source.pointerId))) current.blocked = true;
    },
    onKeyDown: clear,
  };
  if (unavailable) return <div {...shared} aria-disabled="true" title={unavailable} />;
  const anchor = { ...shared,
    draggable: onLongPress ? false : undefined,
    onDragStart: onLongPress ? (event: React.DragEvent<HTMLAnchorElement>) => event.preventDefault() : undefined,
    onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (event.defaultPrevented) return;
      const current = press.current;
      // Keyboard/assistive activation and modified clicks keep their semantics.
      // Retain the withdrawal until a fresh down: some UAs emit no trailing click.
      if (event.detail !== 0 && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey &&
        current && (current.blocked || (current.contacts.size > 0 && performance.now() - current.started >= MAX_TAP_MS))) {
        event.preventDefault();
        return;
      }
      // Run before PreparedScoreLink's callback, which can start preparation.
      onClick?.(event);
    },
  };
  return to !== undefined ? <Link {...anchor} to={to} /> : <a {...anchor} href={href} />;
}
