import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { registration } from '../../test/pwa-register-mock';
import { holdUpdate } from '../updates/update-safety';
import { ReloadPrompt } from './reload-prompt';

const recovery = vi.hoisted(() => ({ reload: vi.fn(), created: vi.fn(), disposed: vi.fn() }));
vi.mock('../updates/shell-recovery', async importOriginal => {
 const actual = await importOriginal<typeof import('../updates/shell-recovery')>();
 return { ShellRecovery: class extends actual.ShellRecovery {
  constructor() { super(recovery.reload); recovery.created(); }
  dispose() { recovery.disposed(); super.dispose(); }
 } };
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('keeps a deferred page recovery through a failed service-worker registration retry', async () => {
 vi.useFakeTimers();
 const register = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(registration);
 Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
 Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
 Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { addEventListener: vi.fn(), removeEventListener: vi.fn(), register } });
 const view = render(<MemoryRouter initialEntries={['/about']}><ReloadPrompt /></MemoryRouter>);
 await act(async () => {});
 expect(register).toHaveBeenCalledTimes(1);
 const release = holdUpdate();
 act(() => window.dispatchEvent(new Event('same-page-recover-page')));
 expect(recovery.reload).not.toHaveBeenCalled();
 await act(async () => window.dispatchEvent(new Event('same-page-check-update')));
 expect(register).toHaveBeenCalledTimes(2);
 expect(recovery.created).toHaveBeenCalledOnce(); expect(recovery.disposed).not.toHaveBeenCalled();
 release(); act(() => vi.advanceTimersByTime(1000));
 expect(recovery.reload).toHaveBeenCalledOnce();
 view.unmount(); expect(recovery.disposed).toHaveBeenCalledOnce();
});
