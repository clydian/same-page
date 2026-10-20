import { expect, test } from 'vitest';
import { requireShellAuditResult } from './shell-audit-diagnostics.mjs';

test('missing registration reports its fixed diagnostic instead of dereferencing undefined', () => {
  const snapshot = { role: 'active', url: 'http://localhost/about', scope: null,
    registration: null, controller: { scriptURL: 'http://localhost/sw.js', state: 'activated' },
    registrations: [], navigation: [{ type: 'reload', workerStart: 1 }], heading: '关于合谱' };
  expect(() => requireShellAuditResult({ missingAuditTarget: snapshot }))
    .toThrow('Missing service worker audit target: ' + JSON.stringify(snapshot));
});
test('missing waiting worker remains a failing audit even when an active worker exists', () => {
  expect(() => requireShellAuditResult({ missingAuditTarget: { role: 'waiting',
    registration: { active: { state: 'activated' }, waiting: null } } })).toThrow(/Missing service worker audit target/);
});
test('empty audit does not become a successful identity result', () => {
  expect(() => requireShellAuditResult(undefined)).toThrow('Missing service worker audit identity');
});
test('complete identity and integrity result is returned without mutation', () => {
  const result = { identity: { buildId: 'C', cacheName: 'same-page-shell-v1:C' }, entries: 124, failures: [] };
  expect(requireShellAuditResult(result)).toBe(result);
  expect(result).toEqual({ identity: { buildId: 'C', cacheName: 'same-page-shell-v1:C' }, entries: 124, failures: [] });
});
