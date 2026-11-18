import { useMessages } from "../../i18n";
import { ResourcePreparation } from "../updates/resource-preparation";
import { connectionFetch } from "../connection/connection";
import { assetUrl } from "../../shared/asset-url";
import { InstallCompletion } from "./install-completion";
import { prepareInstallLink } from "./install-transfer";
import { useLiveQuery } from "dexie-react-hooks";
import { localDatabase } from "../platform/local-database";
import { currentLocalOwnerKey } from "../platform/local-workspace";
import { GUEST_NOTE_LAYER_ID } from "../annotations/guest-notes";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "react-aria-components";
import { guestSessionResponseSchema } from "../../shared/choirs";
import { useApplicationIdentity } from "../auth/application-identity";
import { activateGuestLocalOwner } from "../platform/local-workspace";
import { detectInstallGuide, useInstall } from "./install-context";
import { CopyInstallLink, InstallButton } from "./install-entry";
import { InstallSteps } from "./install-steps";

export default function InstallPage() {
  const t = useMessages("system");
  const location = useLocation();
  const navigate = useNavigate();
  const identity = useApplicationIdentity();
  const install = useInstall();
  const guide = detectInstallGuide(navigator.userAgent, navigator.maxTouchPoints);
  const external = guide.endsWith("external");
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get("handoff"));
  const [driveId] = useState(() => new URLSearchParams(location.search).get("drive"));
  const [link, setLink] = useState(token ? window.location.href : "");
  const [destination, setDestination] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const checking = identity.restoring || identity.onlineState === "checking";
  const localUserId = identity.localUserId;
  const hasNotes = useLiveQuery(async () => {
    const owner = await currentLocalOwnerKey();
    if (!external || !owner?.startsWith("guest:")) return false;
    return Boolean(await localDatabase.annotations.where("ownerKey").equals(owner)
      .filter(note => (!driveId || note.choirId === driveId) && note.layerId === GUEST_NOTE_LAYER_ID && !note.deleted).first());
  }, [external, driveId], false);

  useEffect(() => {
    if (checking) return;
    let active = true;
    const controller = new AbortController();
    async function prepare() {
      try {
        if (external) {
          if (token) return;
          if (!driveId) throw new Error("missing");
          const prepared = await prepareInstallLink(driveId, controller.signal);
          if (!active) return;
          if (!prepared) {
            setNeedsLogin(true);
            setLink(new URL(`/install?drive=${encodeURIComponent(driveId)}`, window.location.origin).href);
            return;
          }
          const url = new URL(prepared);
          // WeChat's menu must carry the bridge too, not just Copy.
          await navigate(url.pathname + url.search + url.hash, { replace: true });
          if (active) setLink(prepared);
          return;
        }
        // Remove the bearer fragment before making a request. Keep it only in
        // this mounted component for explicit retries after transient failures.
        if (token) await navigate("/install", { replace: true });
        controller.signal.throwIfAborted();
        const response = token
          ? await connectionFetch("/api/guest/install-handoff/redeem", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) })
          : await connectionFetch("/api/guest/session", { cache: "no-store", signal: controller.signal });
        if (!token && driveId && response.status === 401) {
          if (active) { setNeedsLogin(true); setDestination(`/choirs/${encodeURIComponent(driveId)}`); }
          return;
        }
        if (!response.ok) throw new Error(response.status === 401 ? "expired" : "network");
        const guest = guestSessionResponseSchema.parse(await response.json());
        if (!active) return;
        if (!localUserId) await activateGuestLocalOwner(guest.choir.id, controller.signal);
        if (active) setDestination(`/choirs/${guest.choir.id}`);
      } catch (cause) {
        if (active && !controller.signal.aborted) setError(cause instanceof Error && cause.message === "expired" ? "installPage.expired" : "installPage.resumeFailed");
      }
    }
    void prepare();
    return () => { active = false; controller.abort(); };
  }, [checking, external, token, driveId, localUserId, attempt, navigate]);

  const ready = external ? Boolean(link) : Boolean(destination);
  return <main className="install-page page-shell">
    <Link className="install-brand" to="/" state={{ home: true }}><img src={assetUrl("icon-192.png")} alt="" width="48" height="48" /><span>{t("installPage.brand")}</span></Link>
    <div className="install-page-card">
      <p className="install-eyebrow">{external ? t("installPage.switchBrowser") : t("installPage.addIcon")}</p>
      <h1>{external ? guide === "ios-external" ? t("installPage.openSafari") : t("installPage.openBrowser") : t("installPage.rehearse")}</h1>
      {!external && <ResourcePreparation install />}
      {!ready && !error && <p role="status">{t("installPage.preparing")}</p>}
      {error && <div role="alert"><p>{t(error)}</p><Button className="secondary-button" onPress={() => { setError(""); setAttempt(value => value + 1); }}>{t("installPage.retry")}</Button></div>}
      {ready && !install?.hidden && !install?.requested && <>
        {guide === "android" ? <><InstallButton className="primary-button install-native" />{!install?.nativeAvailable && <InstallSteps guide={guide} />}</> : external || !install?.nativeAvailable ? <InstallSteps guide={guide} /> : <InstallButton className="primary-button install-native" />}
        {external ? <><p className="install-note">{needsLogin ? t("installPage.signInAfterSwitch") : t("installPage.resume")}</p><details className="install-fallback"><summary>{t("installPage.missingBrowser")}</summary><p>{t("install.copyInto", { browser: guide === "ios-external" ? " Safari " : t("install.systemBrowser") })}</p><CopyInstallLink url={link} /></details>{hasNotes && <p className="install-note">{t("installPage.localNotes")}</p>}</> : <><p className="install-note">{t("installPage.openApp")}</p><details className="install-fallback"><summary>{t("installPage.trouble")}</summary><p>{t("installPage.optionMissing")}</p><p>{t("installPage.iconMissing")}</p></details></>}
      </>}
      {install?.runningInApp ? <p>{t("installPage.launched")}</p> : (install?.requested || install?.hidden) && <InstallCompletion guide={guide} />}
      <Link className="install-skip" to={destination ?? (driveId ? `/choirs/${encodeURIComponent(driveId)}` : "/")} state={{ home: true }}>{t("installPage.skip")}</Link>
    </div>
  </main>;
}
