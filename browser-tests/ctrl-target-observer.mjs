// Diagnostic-only, no activation, navigation, or debugger-resume commands.
export async function observeBrowserTargets(context, record) {
  const browser = context.browser();
  const session = await browser.newBrowserCDPSession();
  let nextId = 1;
  const pending = new Map();
  session.on('Target.receivedMessageFromTarget', event => {
    const message = JSON.parse(event.message);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  });
  for (const type of ['targetCreated', 'targetInfoChanged', 'targetDestroyed', 'targetCrashed']) {
    session.on(`Target.${type}`, detail => record(`cdp-${type}`, detail));
  }
  await session.send('Target.setDiscoverTargets', {discover: true});
  const call = (sessionId, method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {pending.delete(id); reject(new Error(`${method} did not respond within 1500ms`));}, 1500);
    pending.set(id, {resolve, reject, timer});
    void session.send('Target.sendMessageToTarget', {sessionId, message: JSON.stringify({id, method, params})}).catch(error => {
      clearTimeout(timer); pending.delete(id); reject(error);
    });
  });
  return {
    async snapshot() {
      record('playwright-pages', {pages: context.pages().map(page => ({url: page.url(), closed: page.isClosed(), frames: page.frames().map(frame => ({url: frame.url(), name: frame.name()}))}))});
      const {targetInfos} = await session.send('Target.getTargets');
      record('cdp-targets', {version: await session.send('Browser.getVersion'), targetInfos});
      for (const target of targetInfos.filter(target => target.type === 'page')) {
        let sessionId;
        try {
          ({sessionId} = await session.send('Target.attachToTarget', {targetId: target.targetId, flatten: false}));
          record('cdp-frame-tree', {targetId: target.targetId, ...(await call(sessionId, 'Page.getFrameTree'))});
          const runtime = await call(sessionId, 'Runtime.evaluate', {expression: `JSON.stringify({url:location.href,readyState:document.readyState,visibility:document.visibilityState,title:document.title,body:document.body?.innerText?.slice(0,200),canvases:[...document.querySelectorAll('canvas[data-pdf-canvas-active]')].map(c=>({width:c.width,height:c.height}))})`, returnByValue: true});
          record('cdp-runtime', {targetId: target.targetId, ...runtime});
        } catch (error) {record('cdp-inspection-error', {targetId:target.targetId, message:error.message});}
        finally {if (sessionId) await session.send('Target.detachFromTarget', {sessionId}).catch(()=>{});}
      }
    },
    async close() {await session.detach();}
  };
}
