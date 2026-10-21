import assert from "node:assert/strict";

// Test-only observation of the application's own public SW calls. Returning the
// original promises preserves registration/update semantics and error handling.
// Install before navigation; this never initiates a registration or an update.
export function observeInitialUpdateCheck() {
  const state = { available: Boolean(navigator.serviceWorker), registrations: 0, registrationErrors: 0, checks: 0, finishedChecks: 0, checkErrors: 0 };
  window.__samePageInitialUpdateCheck = state;
  if (!state.available) return;
  const register = navigator.serviceWorker.register;
  navigator.serviceWorker.register = function (...args) {
    const pending = Reflect.apply(register, this, args);
    void pending.then(() => { state.registrations++; }, () => { state.registrationErrors++; });
    return pending;
  };
  const update = ServiceWorkerRegistration.prototype.update;
  ServiceWorkerRegistration.prototype.update = function (...args) {
    state.checks++;
    const pending = Reflect.apply(update, this, args);
    void pending.then(() => { state.finishedChecks++; }, () => { state.finishedChecks++; state.checkErrors++; });
    return pending;
  };
}

export function initialUpdateCheckSettled() {
  const state = window.__samePageInitialUpdateCheck;
  return Boolean(state && (!state.available || state.registrationErrors || state.checkErrors ||
    (state.registrations > 0 && state.checks > 0 && state.finishedChecks === state.checks)));
}

export async function waitForInitialUpdateCheck(page, label) {
  await page.waitForFunction(initialUpdateCheckSettled);
  const state = await page.evaluate(() => window.__samePageInitialUpdateCheck);
  assert.equal(state.available, true, `${label}: Service Worker unavailable`);
  assert.equal(state.registrationErrors, 0, `${label}: initial registration failed`);
  assert.equal(state.checkErrors, 0, `${label}: initial automatic update check failed`);
}
