import { useLayoutEffect, useRef } from "react";
import { Link, type LinkProps } from "react-router-dom";
import "./file-open-link.css";

type Props = Pick<LinkProps, "children" | "className" | "onClick" | "aria-label" | "aria-description"> & { to: string };
type TouchPress = { pointerId: number; started: number; x: number; y: number; contacts: Set<number>; blocked: boolean };
const MAX_TAP_MS = 500;
const MAX_TAP_MOVEMENT = 10;

// File actions remain on the existing ellipsis. This only withdraws a touch
// activation; it never schedules a long-press action or takes over scrolling.
export function FileOpenLink({ className = "", onClick, to, ...props }: Props) {
  const link = useRef<HTMLAnchorElement>(null);
  const press = useRef<TouchPress | null>(null);
  useLayoutEffect(() => {
    // A recycled link must not activate a new destination on an old release.
    if (press.current) press.current.blocked = true;
    link.current?.removeAttribute("data-touch-active");
  }, [to]);
  const clear = () => { press.current = null; link.current?.removeAttribute("data-touch-active"); };
  const finish = (event: React.PointerEvent<HTMLAnchorElement>, cancelled: boolean) => {
    if (event.pointerType !== "touch" || !press.current?.contacts.has(event.pointerId)) return;
    const current = press.current;
    current.blocked ||= cancelled || performance.now() - current.started >= MAX_TAP_MS || Math.hypot(event.clientX - current.x, event.clientY - current.y) >= MAX_TAP_MOVEMENT;
    current.contacts.delete(event.pointerId);
    if (!current.contacts.size) event.currentTarget.removeAttribute("data-touch-active");
  };
  return <Link {...props} ref={link} to={to} className={`file-open-link ${className}`}
    onPointerDown={event => {
      if (event.pointerType !== "touch") { clear(); return; }
      if (!event.isPrimary && press.current?.contacts.size) {
        press.current.contacts.add(event.pointerId);
        press.current.blocked = true;
      } else {
        press.current = { pointerId: event.pointerId, started: performance.now(), x: event.clientX, y: event.clientY, contacts: new Set([event.pointerId]), blocked: !event.isPrimary };
      }
      event.currentTarget.setAttribute("data-touch-active", "");
    }}
    onPointerMove={event => {
      const current = press.current;
      if (event.pointerType === "touch" && current?.contacts.has(event.pointerId) && Math.hypot(event.clientX - current.x, event.clientY - current.y) >= MAX_TAP_MOVEMENT) current.blocked = true;
    }}
    onPointerUp={event => finish(event, false)}
    onPointerCancel={event => finish(event, true)}
    onContextMenu={event => {
      // Unknown/keyboard/mouse sources retain the browser menu, including on
      // hybrid devices. A coarse pointer media query cannot identify a press.
      if (!("pointerType" in event.nativeEvent) || event.nativeEvent.pointerType !== "touch") return;
      event.preventDefault();
      // A delayed menu from an older contact cannot withdraw a fresh input.
      const source = event.nativeEvent as MouseEvent & Partial<PointerEvent>;
      const current = press.current;
      if (current && (source.pointerId === undefined || source.pointerId === current.pointerId || current.contacts.has(source.pointerId))) current.blocked = true;
    }}
    onKeyDown={clear}
    onClick={event => {
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
    }}
  />;
}
