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
  if (!candidate) return '请先保存当前操作，并返回关于合谱或文件库。';
  if (tasks.size) return '正在等待本机保存或当前任务完成，完成后会自动重新加载。';
  if (document.querySelector('[role="dialog"], [role="menu"], [data-update-busy]')) return '请先完成或关闭当前对话框、菜单。';
  if (document.activeElement instanceof HTMLElement && document.activeElement.matches('input, textarea, select, [contenteditable="true"]')) return '请先结束当前输入，完成后会自动重新加载。';
  return null;
}
export function pageReloadBlocker() {
  return document.visibilityState !== 'visible' ? '请保持合谱在前台，返回后会继续恢复。' : operationBlocker();
}
export function canAcceptUpdate(requested = false) {
  return !operationBlocker() && navigator.onLine && (requested || Date.now() - lastInteraction >= 1000);
}

export function canApplyUpdate(requested = false) {
  return document.visibilityState === "visible" && canAcceptUpdate(requested);
}
