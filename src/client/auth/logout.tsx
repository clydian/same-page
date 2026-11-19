import { useMessages } from "../../i18n";
import { currentLocalOwnerKey } from "../platform/local-workspace";
import { useRef, useState, type ReactNode } from "react";
import { Button, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useNavigate } from "react-router-dom";
import { Dialog } from "../navigation/overlays";
import { authClient } from "./auth-client";
import { clearPrivateLocalDataAfterLogout, getLogoutLocalSummary, type LogoutLocalSummary } from "./logout-local-data";
import { clearPreviewGuestSession } from "./preview-guest-session";
import { clearLibraryDeviceState } from "../score-library/library-view-state";
import { beginLogout, completeLogout, cancelLogout } from "./logout-fence";
import { LogoutContext } from "./logout-context";

export function LogoutProvider({ children }: { children: ReactNode }) {
  const logout = useLogoutController();
  return <LogoutContext value={logout.request}>{children}{logout.dialog}</LogoutContext>;
}

function useLogoutController() {
  const t = useMessages("entry");
  const session = authClient.useSession();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<LogoutLocalSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const request = async () => {
    try { setSummary(await getLogoutLocalSummary()); setMessage(null); }
    catch { setMessage(t("logout.checkError")); }
  };
  const finish = async () => {
    if (running.current) return;
    if (!navigator.onLine) { setMessage(t("logout.networkError")); return; }
    running.current = true; setBusy(true);
    let serverSignedOut = false;
    try {
      const owner = await currentLocalOwnerKey();
      const userId = session.data?.user.id ?? (owner?.startsWith("user:") ? owner.slice(5) : undefined);
      if (userId) await beginLogout(userId, session.data?.session?.id ?? null);
      const result = await authClient.signOut();
      if (result.error) throw new Error("sign_out_failed");
      serverSignedOut = true;
      await clearPreviewGuestSession();
      await clearPrivateLocalDataAfterLogout();
      clearLibraryDeviceState();
      await completeLogout();
      setSummary(null);
      await navigate("/?signedOut=1", { replace: true });
    } catch {
      if (!serverSignedOut) await cancelLogout().catch(() => undefined);
      setMessage(serverSignedOut ? t("logout.cleanupError") : t("logout.logoutError"));
    } finally { running.current = false; setBusy(false); }
  };
  const pending = summary && (summary.pendingOperations || summary.conflicts || summary.syncErrors || summary.attachmentDrafts);
  return { request, dialog: <>
    {message && !summary && <p role="alert">{message}</p>}
    <ModalOverlay className="modal-overlay" isOpen={Boolean(summary)} onOpenChange={open => { if (!open && !busy) setSummary(null); }} isDismissable={!busy}>
      <Modal className="app-modal app-modal--compact"><Dialog className="app-dialog" exitDisabled={busy}>
        <Heading slot="title">{t("logout.title")}</Heading>
        <p>{pending ? t("logout.pendingDetails", { pending: summary.pendingOperations, conflicts: summary.conflicts, errors: summary.syncErrors, drafts: summary.attachmentDrafts }) : t("logout.cleanDetails")}</p>
        {message && <p role="alert">{message}</p>}
        <div className="dialog-actions"><Button className="secondary-button" isDisabled={busy} onPress={() => setSummary(null)}>{t("logout.return")}</Button><Button className="primary-button" isDisabled={busy} onPress={() => void finish()}>{busy ? t("logout.working") : pending ? t("logout.discard") : t("logout.clear")}</Button></div>
      </Dialog></Modal>
    </ModalOverlay>
  </> };
}
