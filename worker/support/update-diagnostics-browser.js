// Deliberately independent of the application bundle, Dexie and authentication.
// Only fixed public cache metadata and an empty database probe leave the device.
(() => {
  const byId = id => document.getElementById(id);
  const safeBuild = value => typeof value === 'string' && /^(?:[0-9a-f]{7,40}|development)$/.test(value) ? value : null;
  const safeBytes = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const reasons = ['release-too-large', 'capacity-protected', 'quota-exceeded', 'integrity-mismatch', 'download-timeout', 'download-failed', 'storage-failed', 'unknown'];
  const scope = location.origin + '/';
  const prefixes = [1, 2].map(version => 'same-page-shell-v' + version + ':' + encodeURIComponent(scope) + ':');
  const registryName = 'same-page-shell-registry-v1:' + encodeURIComponent(scope);
  let registration, report, failure = null, frozen = null, busy = false;

  async function timed(action, ms = 3000) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(action).then(value => ({ status: 'ok', value }), () => ({ status: 'failed' })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ status: 'timeout' }), ms); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  async function identity(worker) {
    if (!worker) return null;
    let port;
    const result = await timed(() => new Promise(resolve => {
      const channel = new MessageChannel(); port = channel.port1;
      port.onmessage = event => resolve(safeBuild(event.data?.buildId));
      worker.postMessage({ type: 'SAME_PAGE_SHELL_IDENTITY' }, [channel.port2]);
    }), 1000);
    port?.close();
    return result.status === 'ok' ? result.value : null;
  }
  function environment() {
    const ua = navigator.userAgent;
    const browsers = [['edge', /(?:Edg|EdgiOS|EdgA)\/([\d.]+)/], ['firefox', /(?:Firefox|FxiOS)\/([\d.]+)/], ['chrome', /(?:Chrome|CriOS)\/([\d.]+)/], ['safari', /Version\/([\d.]+).*Safari/]];
    const systems = [['ios', /(?:iPhone OS|CPU OS) ([\d_]+)/], ['android', /Android ([\d.]+)/], ['macos', /Mac OS X ([\d_.]+)/], ['windows', /Windows NT ([\d.]+)/]];
    const browser = browsers.find(([, pattern]) => pattern.test(ua));
    const system = systems.find(([, pattern]) => pattern.test(ua));
    const desktopIPad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    const version = value => value && /^\d{1,4}(?:[._]\d{1,6}){0,3}$/.test(value) ? value.replaceAll('_', '.') : null;
    return { browser: browser?.[0] ?? 'unknown', browserVersion: version(browser?.[1].exec(ua)?.[1]),
      system: desktopIPad ? 'ios' : system?.[0] ?? (/Linux/.test(ua) ? 'linux' : 'unknown'), systemVersion: desktopIPad ? null : version(system?.[1].exec(ua)?.[1]),
      viewportWidth: Math.min(32768, Math.max(0, innerWidth)), viewportHeight: Math.min(32768, Math.max(0, innerHeight)),
      standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
      serviceWorkerControlled: !!navigator.serviceWorker?.controller, onlineHint: navigator.onLine };
  }
  async function databaseProbe() {
    if (!('indexedDB' in window)) return { status: 'unavailable', version: null };
    let expired = false, opened;
    const result = await timed(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('same-page'); // No version change, no deletion.
      request.onupgradeneeded = () => {
        request.transaction.abort(); // An absent database must remain absent.
        resolve({ status: 'missing', version: null });
      };
      request.onerror = () => reject();
      request.onblocked = () => resolve({ status: 'timeout', version: null });
      request.onsuccess = () => {
        opened = request.result;
        if (expired) { opened.close(); return; }
        opened.onversionchange = () => opened.close();
        if (!opened.objectStoreNames.contains('system')) { opened.close(); resolve({ status: 'missing', version: null }); return; }
        const version = opened.version;
        const tx = opened.transaction('system', 'readonly');
        // Probe a reserved nonexistent key; never read user records or count notes.
        tx.objectStore('system').get('__same_page_diagnostic_probe__');
        tx.oncomplete = () => { opened.close(); resolve({ status: 'ok', version }); };
        tx.onabort = tx.onerror = () => { opened.close(); reject(); };
      };
    }));
    expired = true; opened?.close();
    return result.status === 'ok' ? result.value : { status: result.status, version: null };
  }
  async function cacheProbe() {
    const empty = { cacheStatus: 'unavailable', shellCount: null, shellBytes: null, shellsTruncated: false, shells: [] };
    if (!('caches' in window)) return empty;
    const result = await timed(async () => {
      const names = (await caches.keys()).filter(name => prefixes.some(prefix => name.startsWith(prefix)));
      const shells = await Promise.all(names.slice(0, 16).map(async name => {
        const key = new URL('__same_page_shell__/' + encodeURIComponent(name), scope).href;
        // CacheStorage.match with a name does not create a cache on a miss.
        const response = await caches.match(key, { cacheName: registryName });
        const record = response ? await response.json() : null;
        const sizes = Array.isArray(record?.entries) && record.entries.length <= 1000 ? record.entries.map(entry => safeBytes(entry.bytes)) : [];
        const bytes = sizes.length && sizes.every(value => value !== null) ? safeBytes(sizes.reduce((a, b) => a + b, 0)) : null;
        const age = Number.isFinite(record?.activated) ? Math.max(0, (Date.now() - record.activated) / 3600000) : null;
        return { buildId: safeBuild(record?.buildId), bytes, complete: record?.complete === true, ageHours: age !== null && age <= 1000000 ? age : null };
      }));
      return { cacheStatus: 'ok', shellCount: Math.min(9999, names.length), shellsTruncated: names.length > 16,
        shellBytes: names.length <= 16 && shells.every(entry => entry.bytes !== null) ? safeBytes(shells.reduce((a, b) => a + b.bytes, 0)) : null, shells };
    });
    return result.status === 'ok' ? result.value : { ...empty, cacheStatus: result.status };
  }
  function display() {
    if (!report) return;
    byId('report').value = JSON.stringify(frozen ?? report, null, 2);
  }
  async function inspect() {
    if (busy) return;
    busy = true; frozen = null; byId('send').disabled = true;
    byId('status').textContent = '正在检查…'; byId('receipt').textContent = '';
    const [reg, cache, storage, database] = await Promise.all([
      timed(async () => {
        if (!('serviceWorker' in navigator)) return { registration: 'unavailable', activeBuild: null, waitingBuild: null, installingState: null };
        registration = await navigator.serviceWorker?.getRegistration(scope);
        const [activeBuild, waitingBuild] = await Promise.all([identity(registration?.active), identity(registration?.waiting)]);
        return { registration: registration ? 'ok' : 'missing', activeBuild, waitingBuild, installingState: registration?.installing?.state ?? null };
      }), cacheProbe(), navigator.storage?.estimate ? timed(() => navigator.storage.estimate()) : Promise.resolve({ status: 'unavailable' }), databaseProbe(),
    ]);
    const update = { serverBuild: safeBuild(document.querySelector('meta[name="same-page-support-build"]').content),
      locksSupported: !!navigator.locks,
      ...(reg.status === 'ok' ? reg.value : { registration: reg.status, activeBuild: null, waitingBuild: null, installingState: null }),
      ...cache, shellBudgetBytes: null, shellPolicy: 'references-v2', shellReleaseLimitBytes: Number(document.querySelector('meta[name="same-page-shell-limit"]').content),
      storage: { status: storage.status, usage: safeBytes(storage.value?.usage), quota: safeBytes(storage.value?.quota) }, database, failure };
    report = { id: crypto.randomUUID(), version: 1, clientBuild: update.activeBuild, retentionDays: 180,
      description: '独立更新诊断', environment: environment(), reader: null, records: [], update };
    busy = false; byId('send').disabled = false;
    const messages = { 'release-too-large': '新版程序资源超过单版本大小限制，请发送诊断反馈。', 'capacity-protected': '旧版本应用缓存仍受保护，本次更新被应用容量规则阻止。', 'quota-exceeded': '浏览器拒绝了存储写入，报告已记录存储估算。', 'integrity-mismatch': '更新资源未通过完整性校验。', 'download-timeout': '更新资源准备超时。', 'download-failed': '更新资源下载失败。', 'storage-failed': '应用缓存存储操作失败。', unknown: '更新安装失败，未取得更具体的分类。' };
    byId('status').textContent = failure ? messages[failure.reason] : database.status === 'timeout' ? '本机数据库未在限定时间内响应，请发送诊断反馈。' : cache.cacheStatus === 'timeout' ? '应用缓存未在限定时间内响应，请发送诊断反馈。' : update.waitingBuild ? '新版本已准备好。请关闭所有合谱窗口，再重新打开。' : update.registration === 'missing' ? '未找到本机应用更新服务。请联网返回合谱，重新打开后再试。' : '本次检查已完成，尚未确认更新故障原因。可以重试更新；若仍无法使用，请发送诊断反馈。';
    display();
  }
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type === 'SAME_PAGE_SHELL_PROBE') {
      // This document uses no shell assets. Protecting the existing controller's
      // build keeps legacy collectors conservative without vetoing collection.
      void identity(registration?.active).then(buildId => event.ports[0]?.postMessage(buildId ? { buildId, cacheName: '' } : null));
      return;
    }
    if (event.data?.type === 'SAME_PAGE_UPDATE_PROBE') { event.ports[0]?.postMessage(event.data.requested === true); return; }
    if (event.origin !== location.origin || event.data?.type !== 'SAME_PAGE_UPDATE_FAILURE' || !reasons.includes(event.data.reason)) return;
    failure = { reason: event.data.reason, buildId: safeBuild(event.data.buildId) };
    if (report) { report.update.failure = failure; display(); }
  });
  byId('inspect').onclick = () => { void inspect(); };
  byId('retry').onclick = async () => {
    if (busy) return;
    if (!registration) { byId('status').textContent = '未找到可重试的应用更新，请先重新检查。'; return; }
    failure = null;
    byId('retry').disabled = true;
    byId('status').textContent = '正在重试更新，准备过程可持续数分钟；完成或失败后可重新检查并发送反馈。';
    try {
      const found = () => {
        const worker = registration.installing;
        if (!worker) return;
        const changed = () => {
          if (!['installed', 'activated', 'redundant'].includes(worker.state)) return;
          worker.removeEventListener('statechange', changed);
          if (worker.state === 'redundant' && !failure) failure = { reason: 'unknown', buildId: null };
          void inspect();
        };
        worker.addEventListener('statechange', changed); changed();
      };
      registration.addEventListener('updatefound', found, { once: true });
      await registration.update();
      if (!registration.installing) { registration.removeEventListener('updatefound', found); await inspect(); }
    } catch { failure = { reason: 'download-failed', buildId: null }; await inspect(); }
    finally { byId('retry').disabled = false; }
  };
  byId('copy').onclick = async () => {
    try { await navigator.clipboard.writeText(byId('report').value); byId('receipt').textContent = '已复制诊断信息。'; }
    catch { byId('receipt').textContent = '请选中上面的诊断信息手动复制。'; }
  };
  byId('send').onclick = async () => {
    if (!report || busy || byId('send').disabled) return;
    const allowLegacy = frozen === null;
    busy = true;
    frozen ??= structuredClone(report); display(); byId('send').disabled = true;
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
    const submit = () => fetch('/api/diagnostic-reports', { method: 'POST', credentials: 'omit', cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(frozen) });
    try {
      let response = await submit();
      // Only an explicit first rejection permits a backwards-compatible retry.
      if (allowLegacy && response.status === 400 && frozen.update) { delete frozen.update; delete frozen.retentionDays; display(); response = await submit(); }
      if (!response.ok || (await response.json()).id !== frozen.id) throw new Error();
      byId('receipt').textContent = '反馈已收到，谢谢你。反馈编号：' + frozen.id + (frozen.retentionDays ? '' : '（旧服务保存 30 天；扩展诊断请另行复制。）');
    } catch { byId('receipt').textContent = '尚未确认收到，请重试发送或复制诊断信息。'; byId('send').disabled = false; }
    finally { clearTimeout(timer); busy = false; }
  };
  void inspect();
})();
