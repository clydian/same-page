import { FeedbackMessage } from "../components/feedback-message";
import { useFeedbackMessage } from "../components/use-feedback-message";
import { useMessages } from "../../i18n";
import { DriveSuggestion } from "../components/drive-suggestion";
import { prepareInstallLink } from "./install-transfer";
import { useEffect, useState } from "react";
import { Button } from "react-aria-components";
import { Download } from "lucide-react";
import { detectInstallGuide, useInstall } from "./install-context";

export function InstallButton({ className }: { className?: string }) {
  const t = useMessages("system");
  const install = useInstall();
  if (!install || install.hidden) return null;
  return <Button className={`install-button ${className ?? (install.nativeAvailable ? "primary-button" : "secondary-button")}`} onPress={install.open}><Download size={18} aria-hidden="true" />{detectInstallGuide(navigator.userAgent, navigator.maxTouchPoints) === "android" ? t("installEntry.install") : t("installEntry.add")}</Button>;
}

export function InstallSuggestion() {
  const t = useMessages("system");
  const install = useInstall();
  if (!install?.suggest) return null;
  return <DriveSuggestion id="install" label={t("installEntry.suggestion")} title={t("installEntry.addApp")}
    closeLabel={t("installEntry.dismiss")} action={<InstallButton className="secondary-button" />}>
    <p>{t("installEntry.rehearse")}</p>
  </DriveSuggestion>;
}


export function CopyInstallLink({ url }: { url?: string } = {}) {
  const t = useMessages("system");
  const feedback = useFeedbackMessage();
  const { message, setMessage } = feedback;
  const drive = /^\/choirs\/([^/]+)/.exec(window.location.pathname)?.[1];
  const [prepared, setPrepared] = useState<{ drive: string; url: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const link = url ?? (prepared?.drive === drive ? prepared?.url : null) ?? (drive ? "" : `${window.location.origin}/`);
  useEffect(() => {
    if (url || !drive) return;
    const controller = new AbortController();
    void prepareInstallLink(drive, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setPrepared({ drive, url: value ?? new URL(`/choirs/${encodeURIComponent(drive)}`, window.location.origin).href });
      if (!value) setMessage("installEntry.signInAfterSwitch");
    }).catch(() => { if (!controller.signal.aborted) setMessage("installEntry.linkFailed"); });
    return () => controller.abort();
  }, [url, drive, attempt, setMessage]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setMessage("installEntry.copied", { duration: 5000 }); }
    catch { setMessage("installEntry.copyManually"); }
  };
  if (!link) return <div className="install-copy"><p role="status">{t(message || "installEntry.preparing")}</p>{message && <Button onPress={() => { setMessage(""); setAttempt(value => value + 1); }}>{t("installEntry.retry")}</Button>}</div>;
  return <div className="install-copy"><Button className="secondary-button" onPress={() => void copy()}>{t("installEntry.copy")}</Button><input aria-label={t("installEntry.webAddress")} readOnly value={link} onFocus={event => event.target.select()} /><FeedbackMessage feedback={{ ...feedback, message: message ? t(message) : null }} /></div>;
}
