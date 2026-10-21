import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {test} from 'vitest';
import {observeInitialUpdateCheck, initialUpdateCheckSettled} from './pwa-update-readiness.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
function fixture(registration = deferred(), checks = []) {
  class Registration { update() { return checks.shift().promise; } }
  const container = {register() { return registration.promise; }};
  const context = {window: {}, navigator: {serviceWorker: container}, ServiceWorkerRegistration: Registration};
  runInNewContext(`(${observeInitialUpdateCheck.toString()})()`, context);
  return {context, container, registration, instance: new Registration(), state: context.window.__samePageInitialUpdateCheck,
    settled: () => runInNewContext(`(${initialUpdateCheckSettled.toString()})()`, context)};
}

test('registration readiness alone cannot switch the candidate before the app automatic check', async () => {
  const check = deferred(), f = fixture(deferred(), [check]);
  assert.equal(f.container.register('/sw.js'), f.registration.promise);
  f.registration.resolve(f.instance); await f.registration.promise;
  assert.equal(f.state.registrations, 1);
  assert.equal(f.settled(), false);
  assert.equal(f.instance.update(), check.promise);
  assert.equal(f.settled(), false);
  check.resolve(); await check.promise;
  assert.equal(f.settled(), true);
});
test('all already started automatic checks must settle, with their original promise identities', async () => {
  const first = deferred(), second = deferred(), f = fixture(deferred(), [first, second]);
  f.container.register('/sw.js'); f.registration.resolve(f.instance); await f.registration.promise;
  assert.equal(f.instance.update(), first.promise); assert.equal(f.instance.update(), second.promise);
  first.resolve(); await first.promise; assert.equal(f.settled(), false);
  second.resolve(); await second.promise; assert.equal(f.settled(), true);
});
test('failed registration and update remain failures rather than a successful readiness barrier', async () => {
  const f = fixture(); const rejected = f.container.register('/sw.js');
  f.registration.reject(new Error('register failed')); await assert.rejects(rejected, /register failed/);
  assert.equal(f.state.registrationErrors, 1); assert.equal(f.settled(), true);
  const check = deferred(), g = fixture(deferred(), [check]);
  g.container.register('/sw.js'); g.registration.resolve(g.instance); await g.registration.promise;
  const update = g.instance.update(); check.reject(new Error('update failed')); await assert.rejects(update, /update failed/);
  assert.equal(g.state.checkErrors, 1); assert.equal(g.settled(), true);
});
