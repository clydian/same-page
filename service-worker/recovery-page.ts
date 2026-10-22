// No business state is opened on this page. Its approval still leaves every
// other window's two-round update veto in the waiting worker in force.
export const recoveryPage = `<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>合谱</title><body><main><h1>暂时无法打开合谱</h1><p id="status">请联网后重试。此设备保存的内容仍然保留。</p><button id="retry">重试</button></main><script>
const button = document.getElementById('retry');
const status = document.getElementById('status');
navigator.serviceWorker.addEventListener('message', event => {
  if (event.data?.type === 'SAME_PAGE_UPDATE_PROBE') event.ports[0]?.postMessage(true);
});
function ask(worker, message) {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 10000);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
    worker.postMessage(message, [channel.port2]);
  });
}
button.onclick = async () => {
  button.disabled = true;
  status.textContent = '正在准备可用版本…';
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) { location.reload(); return; }
    await registration.update();
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const waiting = registration.waiting;
      if (waiting?.state === 'installed') {
        const identity = await ask(waiting, { type: 'SAME_PAGE_SHELL_IDENTITY' });
        if (!identity?.buildId) throw new Error('identity');
        // The worker rechecks the authoritative channel before and after all
        // window approvals. A stale candidate cannot activate through recovery.
        const result = await ask(waiting, { type: 'SAME_PAGE_SAFE_UPDATE', requested: true });
        if (!result?.safe) throw new Error('busy');
        while (Date.now() < deadline) {
          const controller = navigator.serviceWorker.controller;
          const active = controller && await ask(controller, { type: 'SAME_PAGE_SHELL_IDENTITY' });
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
