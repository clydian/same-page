import { localeStorageKey, sourceLocale, type AppLocale } from "../src/i18n/locales";
import de from "../src/i18n/messages/de/recovery.json";
import en from "../src/i18n/messages/en/recovery.json";
import es419 from "../src/i18n/messages/es-419/recovery.json";
import fr from "../src/i18n/messages/fr/recovery.json";
import it from "../src/i18n/messages/it/recovery.json";
import ja from "../src/i18n/messages/ja/recovery.json";
import ko from "../src/i18n/messages/ko/recovery.json";
import ptBR from "../src/i18n/messages/pt-BR/recovery.json";
import zhHans from "../src/i18n/messages/zh-Hans/recovery.json";
import zhHantTW from "../src/i18n/messages/zh-Hant-TW/recovery.json";

const messages = { de, en, "es-419": es419, fr, it, ja, ko, "pt-BR": ptBR, "zh-Hans": zhHans, "zh-Hant-TW": zhHantTW } satisfies Record<AppLocale, typeof zhHans>;
const serializedMessages = JSON.stringify(messages).replaceAll("<", "\\u003c");

// No business state is opened on this page. Its approval still leaves every
// other window's two-round update veto in the waiting worker in force.
export function recoveryPage(locale: AppLocale = sourceLocale): string {
  const fallback = messages[locale];
  const html = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<!doctype html><html lang="${locale}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(fallback.title)}</title><body><main><h1 id="heading">${html(fallback.unavailable)}</h1><p id="status">${html(fallback.offline)}</p><button id="retry">${html(fallback.retry)}</button></main><script>
const button = document.getElementById('retry');
const status = document.getElementById('status');
const messages = ${serializedMessages};
let locale = ${JSON.stringify(locale)};
try {
  const saved = localStorage.getItem(${JSON.stringify(localeStorageKey)});
  if (Object.hasOwn(messages, saved)) locale = saved;
} catch { /* The response already uses the browser's language. */ }
const copy = messages[locale];
document.documentElement.lang = locale;
document.title = copy.title;
document.getElementById('heading').textContent = copy.unavailable;
status.textContent = copy.offline;
button.textContent = copy.retry;
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
  status.textContent = copy.preparing;
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
    status.textContent = copy.failed;
  } finally { button.disabled = false; }
};
</script></body></html>`;
}
