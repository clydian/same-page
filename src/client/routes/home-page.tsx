import { useMessages } from "../../i18n";
import { useDriveInvitation } from "../drives/use-drive-invitation";
import { JoinDriveDialog, JoinDrivePanel } from "../drives/join-drive-dialog";
import { FeatureAnimation } from "../components/feature-animation";
import { InstallButton } from "../install/install-entry";
import { useInstall } from "../install/install-context";
import { createDriveHref, loginHref } from "../auth/login-return";
import { useApplicationIdentity } from "../auth/application-identity";
import { StartupEntry } from "../auth/startup-entry";
import type { ApplicationIdentity } from "../auth/application-identity";
import { diagnosticFetch } from "../diagnostics/diagnostics";
import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { PersonalMenu } from "../components/personal-menu";
import {
  previewChoirResponseSchema,
  type ChoirSummary,
} from "../../shared/choirs";
import sharedLayersIllustration from "../assets/home/shared-layers.webp";
import sharedLayersAnimation from "../assets/home/shared-layers-animation.webp";
import personalLayerAnimation from "../assets/home/personal-layer-animation.webp";
import personalLayerIllustration from "../assets/home/personal-layer.webp";
import replacePdfAnimation from "../assets/home/replace-pdf-animation.webp";
import replacePdfIllustration from "../assets/home/replace-pdf.webp";
import offlineSyncAnimation from "../assets/home/offline-sync-animation.webp";
import offlineSyncIllustration from "../assets/home/offline-sync.webp";
import everyDeviceIllustration from "../assets/home/every-device.webp";
import {
  clearPreviewGuestSession,
} from "../auth/preview-guest-session";
import { AppHeader } from "../components/app-header";
import { startLoadingJourney } from "../performance/loading-performance";
import "../drive-entry/drive-entry.css";
import {
  driveCacheOwnerKey,
  rememberDriveSummary,
} from "../score-library/drive-library-cache";


const productFeatures = [
  { title: "feature.shared.title", illustration: sharedLayersIllustration, description: "feature.shared.description" },
  { title: "feature.personal.title", illustration: personalLayerIllustration, description: "feature.personal.description" },
  { title: "feature.replace.title", illustration: replacePdfIllustration, description: "feature.replace.description" },
  { title: "feature.offline.title", illustration: offlineSyncIllustration, description: "feature.offline.description" },
  { title: "feature.devices.title", illustration: everyDeviceIllustration, description: "feature.devices.description" },
] as const;

export function HomePage({ startup = false }: { startup?: boolean }) {
  const identity = useApplicationIdentity();
  const location = useLocation();
  const { invitation, finishInvitation } = useDriveInvitation();
  const t = useMessages("entry");
  const inviteEntry = new URLSearchParams(location.search).get("join") === "1" || Boolean(invitation.link && location.hash);
  if (!inviteEntry && invitation.link) finishInvitation();
  // Explicit admission owns its lifetime even when it replaces the local owner.
  const owner = startup && !location.search && !location.hash && !invitation.link
    ? identity.localUserId : identity.session.data?.user.id;
  if (inviteEntry) {
    return <div className="app-page drive-entry-page">
      <AppHeader />
      <main className="drive-entry-main">
        <section className="drive-entry-welcome" aria-labelledby="invite-entry-title">
          <h1 id="invite-entry-title">{t("drive.join")}</h1>
          {!invitation.link?.code && <p className="drive-entry-copy">{t("join.cardCodeHint")}</p>}
          <JoinDrivePanel key={`${owner ?? "guest"}:${invitation.version}`} identity={identity} invitation={invitation.link} onClose={finishInvitation} focused />
        </section>
      </main>
    </div>;
  }
  return <HomeContent key={owner ?? "guest"} identity={identity} startup={startup} />;
}

function HomeContent({ identity, startup }: { identity: ApplicationIdentity; startup: boolean }) {
  const { session } = identity;
  const t = useMessages("entry");
  const location = useLocation();
  const navigate = useNavigate();
  const install = useInstall();
  const [startupDismissed, setStartupDismissed] = useState(false);
  const startupIntent = startup && !startupDismissed && location.pathname === "/" && !location.search && !location.hash;
  const [joinOpen, setJoinOpen] = useState(false);
  const [previewChoir, setPreviewChoir] = useState<ChoirSummary | null>();
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const openPreviewOnLoad = useRef(false);
  const hasDriveIdentity = Boolean(identity.authenticatedUserId || identity.localUserId);
  const appEntry = startupIntent && install?.runningInApp && !hasDriveIdentity;
  const userId = session.data?.user.id;
  useEffect(() => {
    let active = true;
    void loadPreviewChoir().then((choir) => {
      if (!active) return;
      setPreviewChoir(choir);
      if (choir) {
        rememberDriveSummary(
          driveCacheOwnerKey(userId ?? null, choir.id),
          choir,
        );
        if (openPreviewOnLoad.current) {
          openPreviewOnLoad.current = false;
          startLoadingJourney("enter-drive", "warm");
          void navigate(`/choirs/${choir.id}`);
        }
      }
    });
    return () => {
      active = false;
    };
  }, [previewAttempt, userId, navigate]);

  useEffect(() => {
    if (session.isPending || !userId) return;
    void clearPreviewGuestSession();
  }, [session.isPending, userId]);

  const finishJoinDialog = () => {
    setStartupDismissed(true);
    setJoinOpen(false);
  };

  const previewAction = previewChoir ? (
    <Link className={hasDriveIdentity ? "hero-text-link" : appEntry ? "secondary-button" : "primary-button"} to={`/choirs/${previewChoir.id}`}
      onClick={() => startLoadingJourney("enter-drive", "warm")}>
      {t("home.preview")}
    </Link>
  ) : !hasDriveIdentity && (
    <Button className={appEntry ? "secondary-button" : "primary-button"} isPending={previewChoir === undefined} aria-describedby="home-preview-status" onPress={() => {
      openPreviewOnLoad.current = true;
      setPreviewChoir(undefined);
      setPreviewAttempt(attempt => attempt + 1);
    }}>
      {t("home.preview")}
    </Button>
  );
  const previewStatus = <p id="home-preview-status" className="hero-preview-status" role="status">{previewAttempt > 0 && previewChoir === null ? t("home.previewUnavailable") : ""}</p>;

  const content = appEntry ? (
    <div className="app-page drive-entry-page">
      <AppHeader actions={<Link className="header-action" to="/login">{t("drive.login")}</Link>} />
      <main className="drive-entry-main">
        <section className="drive-entry-welcome" aria-labelledby="app-entry-title">
          <h1 id="app-entry-title">{t("home.appWelcome")}</h1>
          <div className="installed-entry-actions">
            <Link className="primary-button" to="/?join=1">{t("drive.join")}</Link>
            {previewAction}
            {previewStatus}
            <Link className="hero-text-link" to={loginHref(createDriveHref)}>{t("home.create")}</Link>
          </div>
        </section>
      </main>
    </div>
  ) : (
    <div className="marketing-page">
      <AppHeader
        actions={
          session.data?.user ? (
            <PersonalMenu email={session.data.user.email} />
          ) : session.isPending ? null : (
            <Link className="header-action header-action--primary" to="/login">
              {t("drive.login")}
            </Link>
          )
        }
      />

      <main className="marketing-content">
        <section className="marketing-hero" aria-labelledby="page-title">
          <div className="marketing-hero__content">
            <p className="hero-mark">合谱 · Same Page</p>
            <h1 id="page-title">{t("home.title")}</h1>
            <div className="hero-description"><p>{t("home.summary")}</p></div>
            <div className="hero-actions">
              {hasDriveIdentity && <Link className="primary-button hero-cta" to="/drives">{t("home.myDrives")}</Link>}
              {hasDriveIdentity ? previewAction : <>
                <div className="hero-cta hero-preview">
                  {previewAction}
                  {previewStatus}
                </div>
                <Button className="secondary-button" onPress={() => {
                  openPreviewOnLoad.current = false;
                  setStartupDismissed(true);
                  setJoinOpen(true);
                }}>
                  {t("home.join")}
                </Button>
                <Link className="hero-text-link" to={loginHref(createDriveHref)}>{t("home.create")}</Link>
              </>}
            </div>
          </div>
          <a className="marketing-more-features" href="#features">
            {t("home.more")} <span aria-hidden="true">↓</span>
          </a>
        </section>

        <section id="features" className="marketing-features" aria-label={t("home.features")}>
          {productFeatures.map((feature, index) => (
            <article
              className={`marketing-feature marketing-feature--${
                index % 2 === 0 ? "left" : "right"
              }`}
              key={feature.title}
            >
              <div className="marketing-feature__copy">
                <h2>{t(feature.title)}</h2>
                <p className="marketing-feature__description">
                  {t(feature.description)}
                </p>
              </div>
              {index < 4 ? (
                <FeatureAnimation
                  illustration={feature.illustration}
                  animation={index === 0 ? sharedLayersAnimation : index === 1 ? personalLayerAnimation : index === 2 ? replacePdfAnimation : offlineSyncAnimation}
                  label={t(feature.title)}
                />
              ) : <img
                className="marketing-feature__illustration"
                src={feature.illustration}
                alt=""
                width={1536}
                height={1024}
                loading="lazy"
                decoding="async"
              />}
            </article>
          ))}
          <div className="marketing-install"><InstallButton /></div>
        </section>
      </main>


      <JoinDriveDialog open={joinOpen} onClose={finishJoinDialog} identity={identity} />

    </div>
  );
  return startupIntent && !joinOpen ? <StartupEntry identity={identity}>{content}</StartupEntry> : content;
}

async function loadPreviewChoir(): Promise<ChoirSummary | null> {
  try {
    const response = await diagnosticFetch("/api/guest/preview-choir");
    if (!response.ok) return null;
    return previewChoirResponseSchema.parse(await response.json()).choir;
  } catch {
    return null;
  }
}
