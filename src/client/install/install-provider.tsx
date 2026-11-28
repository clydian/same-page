import { FeedbackMessage } from "../components/feedback-message";
import { useFeedbackMessage } from "../components/use-feedback-message";
import { useMessages } from "../../i18n";
import { ResourcePreparation } from "../updates/resource-preparation";
import { assetUrl } from "../../shared/asset-url";
import { AndroidInstallOption } from "./android-install-option";
import { InstallCompletion } from "./install-completion";
import { InstallSteps } from "./install-steps";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Download, X } from "lucide-react";
import { Dialog } from "../navigation/overlays";
import { detectInstallGuide, InstallContext } from "./install-context";
import { CopyInstallLink } from "./install-entry";
import "./install.css";

interface InstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: "accepted" | "dismissed" }>;
}

const modes = ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"];
function inAppMode() {
  return modes.some(mode => window.matchMedia?.(`(display-mode: ${mode})`).matches)
    || ("standalone" in navigator && navigator.standalone === true);
}

export function InstallProvider({ children }: { children: ReactNode }) {
  const t = useMessages("system");
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const deviceGuide = detectInstallGuide(navigator.userAgent, navigator.maxTouchPoints);
  const ios = deviceGuide === "safari" || deviceGuide.startsWith("ios");
  const [installed, setInstalled] = useState(inAppMode);
  const [runningInApp, setRunningInApp] = useState(inAppMode);
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const promptRef = useRef<InstallPromptEvent | null>(null);
  const busyRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const feedback = useFeedbackMessage();
  const guide = deviceGuide;
  useEffect(() => {
    const ready = (event: Event) => { event.preventDefault(); if (!deviceGuide.endsWith("external")) { promptRef.current = event as InstallPromptEvent; setPrompt(promptRef.current); } };
    const complete = () => { promptRef.current = null; setInstalled(true); setRequested(true); setPrompt(null); };
    const modeChanged = () => { if (inAppMode()) { complete(); setRunningInApp(true); setOpen(false); } };
    const queries = modes.map(mode => window.matchMedia?.(`(display-mode: ${mode})`));
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", complete);
    queries.forEach(query => query?.addEventListener("change", modeChanged));
    return () => {
      window.removeEventListener("beforeinstallprompt", ready);
      window.removeEventListener("appinstalled", complete);
      queries.forEach(query => query?.removeEventListener("change", modeChanged));
    };
  }, [deviceGuide]);
  const install = async () => {
    const event = promptRef.current;
    if (!event || busyRef.current) return;
    busyRef.current = true;
    promptRef.current = null;
    setBusy(true);
    setPrompt(null); // A browser event can only be consumed once.
    try {
      const result = await event.prompt();
      if (result.outcome === "accepted") setRequested(true);
      else feedback.setMessage(t("installProvider.cancelled"), { duration: 5000 });
    } catch { feedback.setMessage(t("installProvider.promptFailed"), { duration: 5000 }); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const show = () => {
    const drive = /^\/choirs\/([^/]+)/.exec(pathname)?.[1];
    if (deviceGuide.endsWith("external") && drive) {
      void navigate(`/install?drive=${encodeURIComponent(drive)}`);
      return;
    }
    feedback.dismiss(); setOpen(true);
    if (!installed && !deviceGuide.endsWith("external") && deviceGuide !== "android") void install();
  };
  const external = guide.endsWith("external");
  const android = deviceGuide.startsWith("android") || guide.startsWith("android");
  return <InstallContext value={{ hidden: installed, runningInApp, requested, nativeAvailable: Boolean(prompt) && !external, suggest: !installed && !requested, open: show }}>
    {children}
    <ModalOverlay className="modal-overlay" isOpen={open && !runningInApp} onOpenChange={setOpen} isDismissable>
      <Modal className="app-modal install-modal"><Dialog className="app-dialog install-dialog">
        <div className="dialog-heading"><Heading slot="title">{guide === "android" ? t("installProvider.install") : t("installProvider.add")}</Heading><Button className="icon-button" aria-label={t("installProvider.close")} onPress={() => setOpen(false)}><X size={22} /></Button></div>
        <div className="install-intro"><img src={assetUrl("icon-192.png")} width="56" height="56" alt="" /><div><strong>{t("installProvider.rehearse")}</strong><p>{t("installProvider.intro")}</p></div></div>
        {!external && <ResourcePreparation install />}
        {requested ? <InstallCompletion guide={guide} /> : <>
        {external && <p className="install-platform-note">{ios ? t("installProvider.useSafari") : t("installProvider.useBrowser")}</p>}
        {guide === "android" ? <AndroidInstallOption>
          {prompt ? <Button className="primary-button install-native" isDisabled={busy} onPress={() => void install()}><Download size={18} />{t("installProvider.add")}</Button> : <details className="install-choice-manual"><summary>{t("installProvider.manual")}</summary><InstallSteps guide={guide} /></details>}
        </AndroidInstallOption> : prompt && !external ? <Button className="primary-button install-native" isDisabled={busy} onPress={() => void install()}><Download size={18} />{t("installProvider.add")}</Button> : <InstallSteps guide={guide} />}
        <details className="install-fallback"><summary>{external ? t("installProvider.optionMissing") : t("installProvider.trouble")}</summary>
          {ios && <p>{t("installProvider.safariHelp")}</p>}
          {android && <><p>{t("installProvider.androidHelp")}</p><p>{t("installProvider.switchBrowser")}</p></>}
          {prompt && <InstallSteps guide={guide} />}
          <CopyInstallLink />
        </details>
        <FeedbackMessage feedback={feedback} />
        <p className="install-note">{t("installProvider.openApp")}</p>
        </>}
      </Dialog></Modal>
    </ModalOverlay>
  </InstallContext>;
}
