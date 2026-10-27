import type { ConnectionController } from './controller';

// Completion-based scheduling: at most two small GETs per round, with no
// overlapping rounds. This observer owns no business recovery or identity work.
export function observeHealth(controller: Pick<ConnectionController, 'sample' | 'getSnapshot'>, visibility: Document = document, changed: () => void = () => {}) {
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  let abort: AbortController | null = null;
  let stable = 0, previous = '';
  const run = () => {
    if (stopped || visibility.hidden || abort) return;
    const current = new AbortController();
    abort = current;
    void controller.sample(current.signal).finally(() => {
      if (abort === current) abort = null;
      if (stopped || visibility.hidden) return;
      if (current.signal.aborted) { run(); return; }
      const { samples } = controller.getSnapshot();
      const result = [samples.direct.at(-1)?.state, samples.backup.at(-1)?.state].join('/');
      stable = result === previous ? stable + 1 : 1;
      previous = result;
      timer = setTimeout(run, stable >= 3 ? 30_000 : 10_000);
      changed();
    });
  };
  const onVisibility = () => {
    clearTimeout(timer);
    if (visibility.hidden) { abort?.abort(); stable = 0; previous = ''; }
    else run();
    changed();
  };
  visibility.addEventListener('visibilitychange', onVisibility);
  run();
  return () => { stopped = true; clearTimeout(timer); abort?.abort(); visibility.removeEventListener('visibilitychange', onVisibility); };
}
