// A route is only a candidate. Editors, operations and interaction veto reloads.
const tasks = new Set<symbol>();
let lastInteraction = Date.now();
let pathname = "/";

export function holdUpdate() {
  const key = Symbol();
  tasks.add(key);
  return () => { tasks.delete(key); };
}
export function noteUpdateInteraction() { lastInteraction = Date.now(); }
export function setUpdateRoute(path: string) { pathname = path; noteUpdateInteraction(); }
function operationBlocker() {
  const candidate = pathname === "/" || pathname === "/drives" || pathname === "/about" || /^\/choirs\/[^/]+$/.test(pathname);
  if (!candidate) return "updateSafety.leaveEditor";
  if (tasks.size) return "updateSafety.finishing";
  if (document.querySelector('[role="dialog"], [role="menu"], [data-update-busy]')) return "updateSafety.closeDialog";
  if (document.activeElement instanceof HTMLElement && document.activeElement.matches('input, textarea, select, [contenteditable="true"]')) return "updateSafety.finishTyping";
  return null;
}
export function pageReloadBlocker() {
  return document.visibilityState !== 'visible' ? "updateSafety.foreground" : operationBlocker();
}
export function canAcceptUpdate(requested = false) {
  return !operationBlocker() && navigator.onLine && (requested || Date.now() - lastInteraction >= 1000);
}

export function canApplyUpdate(requested = false) {
  return document.visibilityState === "visible" && canAcceptUpdate(requested);
}
