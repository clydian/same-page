// Synthetic lifecycle fixture only. Observe the native methods without changing
// their receiver, arguments, returned promise, or rejection behavior.
export function observeShellLifecycleCalls(bindingName) {
  let sequence = 0;
  const describe = worker => worker ? { scriptURL: worker.scriptURL, state: worker.state } : null;
  const emit = data => {
    if (++sequence > 100) return;
    try { void globalThis[bindingName]({ sequence, path: location.pathname, ...data }).catch(() => {}); } catch { /* observation must not affect the fixture */ }
  };
  const watched = new WeakSet();
  const watch = registration => {
    if (!registration || watched.has(registration)) return;
    watched.add(registration);
    const state = () => ({ scope: registration.scope, active: describe(registration.active), waiting: describe(registration.waiting), installing: describe(registration.installing) });
    registration.addEventListener('updatefound', () => {
      emit({ event: 'updatefound', ...state() });
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => emit({ event: 'statechange', ...state(), changed: describe(worker) }));
    });
  };
  for (const [prototype, name] of [[globalThis.ServiceWorkerRegistration?.prototype, 'unregister'], [globalThis.ServiceWorkerRegistration?.prototype, 'update'], [globalThis.ServiceWorkerContainer?.prototype, 'register']]) {
    if (!prototype || typeof prototype[name] !== 'function') continue;
    const original = prototype[name];
    prototype[name] = function (...args) {
      emit({ call: name, scriptURL: name === 'register' ? String(args[0]) : undefined, stack: new Error().stack?.split('\n').slice(0, 5).join('\n') });
      const result = Reflect.apply(original, this, args);
      // Observe settlement on a separate handled promise; return the exact native
      // promise below, including rejection, rather than a chained replacement.
      void result.then(value => { if (name === 'register') watch(value); emit({ resolved: name, value: typeof value === 'boolean' ? value : undefined }); }, error => emit({ rejected: name, error: String(error) })).catch(() => {});
      return result;
    };
  }
  navigator.serviceWorker?.addEventListener('controllerchange', () => emit({ event: 'controllerchange', controller: describe(navigator.serviceWorker.controller) }));
}

export async function snapshotShellRegistration() {
  const describe = worker => worker ? { scriptURL: worker.scriptURL, state: worker.state } : null;
  const registration = await navigator.serviceWorker.getRegistration();
  return { path: location.pathname, online: navigator.onLine, controller: describe(navigator.serviceWorker.controller),
    registration: registration ? { scope: registration.scope, active: describe(registration.active), waiting: describe(registration.waiting), installing: describe(registration.installing) } : null,
    registrations: (await navigator.serviceWorker.getRegistrations()).map(value => ({ scope: value.scope, active: describe(value.active), waiting: describe(value.waiting), installing: describe(value.installing) })) };
}
