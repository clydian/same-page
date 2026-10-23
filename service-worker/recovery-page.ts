// No business state is opened on this page. Its approval still leaves every
// other window's two-round update veto in the waiting worker in force.
export const recoveryPage = `<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>合谱</title><body><main><h1>暂时无法打开合谱</h1><p id="status">请联网后重试。此设备保存的内容仍然保留。</p><button id="retry">重试</button></main><script>
const button = document.getElementById('retry');
const status = document.getElementById('status');
navigator.serviceWorker.addEventListener('message', event => {
  if (event.data?.type === 'SAME_PAGE_UPDATE_PROBE') event.ports[0]?.postMessage(true);
});
function within(promise, deadline) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), Math.max(0, deadline - Date.now()));
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); Date.now() < deadline ? resolve(value) : reject(new Error('timeout')); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}
async function ask(worker, message, deadline) {
  const channel = new MessageChannel();
  try {
    return await within(new Promise(resolve => {
      // The previous awaited reply can settle just before the deadline while
      // this continuation runs after it. Never send a new handover then.
      if (Date.now() >= deadline) throw new Error('timeout');
      channel.port1.onmessage = event => resolve(event.data);
      worker.postMessage(message, [channel.port2]);
    }), Math.min(deadline, Date.now() + 10000));
  } finally { channel.port1.onmessage = null; channel.port1.close(); }
}
button.onclick = async () => {
  if (button.disabled) return;
  button.disabled = true;
  status.textContent = '正在准备可用版本…';
  const deadline = Date.now() + 20000;
  try {
    const registration = await within(navigator.serviceWorker.getRegistration(), deadline);
    if (!registration) { location.reload(); return; }
    // Bound each awaited step, rather than racing the whole async operation:
    // a timed-out native update cannot later resume this attempt and activate.
    await within(registration.update(), deadline);
    while (Date.now() < deadline) {
      const waiting = registration.waiting;
      if (waiting?.state === 'installed') {
        const identity = await ask(waiting, { type: 'SAME_PAGE_SHELL_IDENTITY' }, deadline);
        if (!identity?.buildId) throw new Error('identity');
        // The worker rechecks the authoritative channel before and after all
        // window approvals. A stale candidate cannot activate through recovery.
        const result = await ask(waiting, { type: 'SAME_PAGE_SAFE_UPDATE', requested: true }, deadline);
        if (!result?.safe) throw new Error('busy');
        while (Date.now() < deadline) {
          const controller = navigator.serviceWorker.controller;
          const active = controller && await ask(controller, { type: 'SAME_PAGE_SHELL_IDENTITY' }, deadline);
          if (active?.buildId === identity.buildId) { location.reload(); return; }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('activation');
      }
      if (!registration.installing) { location.reload(); return; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('timeout');
  } catch {
    status.textContent = '暂时无法切换。请联网，并保存其他窗口的编辑后重试。此设备保存的内容仍然保留。';
  } finally { button.disabled = false; }
};
</script></body></html>`;
