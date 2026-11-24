import { useMessages } from "../../i18n";
import { useDriveInvitation } from "../drives/use-drive-invitation";
import { JoinDriveDialog } from "../drives/join-drive-dialog";
import { FeatureAnimation } from "../components/feature-animation";
import { InstallButton } from "../install/install-entry";
import { createDriveHref, loginHref } from "../auth/login-return";
import { useApplicationIdentity } from "../auth/application-identity";
import { StartupEntry } from "../auth/startup-entry";
import type { ApplicationIdentity } from "../auth/application-identity";
import { diagnosticFetch } from "../diagnostics/diagnostics";
import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";

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
import { readInviteLink } from "../components/invite-link";
import { startLoadingJourney } from "../performance/loading-performance";
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
  // Explicit admission owns its lifetime even when it replaces the local owner.
  const owner = startup && !location.search && !location.hash && !invitation.link
    ? identity.localUserId : identity.session.data?.user.id;
  return <HomeContent key={`${owner ?? "guest"}:${invitation.version}`} identity={identity} startup={startup} linkInvite={invitation.link} finishInvitation={finishInvitation} />;
}

function HomeContent({ identity, startup, linkInvite, finishInvitation }: { identity: ApplicationIdentity; startup: boolean; linkInvite: ReturnType<typeof readInviteLink>; finishInvitation: () => void }) {
  const { session } = identity;
  const t = useMessages("entry");
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [startupDismissed, setStartupDismissed] = useState(false);
  const startupIntent = startup && !startupDismissed && location.pathname === "/" && !location.search && !location.hash && !linkInvite;
  const [joinOpen, setJoinOpen] = useState(searchParams.get("join") === "1" || linkInvite !== null);
  const [previewChoir, setPreviewChoir] = useState<ChoirSummary | null>();
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const openPreviewOnLoad = useRef(false);
  const hasDriveIdentity = Boolean(identity.authenticatedUserId || identity.localUserId);
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
    finishInvitation();
    setStartupDismissed(true);
    setJoinOpen(false);
  };

  const previewAction = previewChoir ? (
    <Link className={hasDriveIdentity ? "hero-text-link" : "primary-button"} to={`/choirs/${previewChoir.id}`}
      onClick={() => startLoadingJourney("enter-drive", "warm")}>
      {t("home.preview")}
    </Link>
  ) : !hasDriveIdentity && (
    <Button className="primary-button" isPending={previewChoir === undefined} aria-describedby="home-preview-status" onPress={() => {
      openPreviewOnLoad.current = true;
      setPreviewChoir(undefined);
      setPreviewAttempt(attempt => attempt + 1);
    }}>
      {t("home.preview")}
    </Button>
  );

  const content = (
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
                  <p id="home-preview-status" className="hero-preview-status" role="status">{previewAttempt > 0 && previewChoir === null ? t("home.previewUnavailable") : ""}</p>
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


      <JoinDriveDialog open={joinOpen} onClose={finishJoinDialog} identity={identity} invitation={linkInvite} />

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
