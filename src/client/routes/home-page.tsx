import { useAppLocale, useMessages } from "../../i18n";
import { useDriveInvitation } from "../drives/use-drive-invitation";
import { JoinDriveDialog } from "../drives/join-drive-dialog";
import { FeatureAnimation } from "../components/feature-animation";
import { InstallButton } from "../install/install-entry";
import { useApplicationIdentity } from "../auth/application-identity";
import { StartupEntry } from "../auth/startup-entry";
import type { ApplicationIdentity } from "../auth/application-identity";
import { diagnosticFetch } from "../diagnostics/diagnostics";
import { useEffect, useState } from "react";
import { Button } from "react-aria-components";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import { BottomNavigation } from "../components/bottom-navigation";
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
  const { locale } = useAppLocale();
  const bilingual = locale === "zh-Hans";
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [startupDismissed, setStartupDismissed] = useState(false);
  const startupIntent = startup && !startupDismissed && location.pathname === "/" && !location.search && !location.hash && !linkInvite;
  const [joinOpen, setJoinOpen] = useState(searchParams.get("join") === "1" || linkInvite !== null);
  const [previewChoir, setPreviewChoir] = useState<ChoirSummary | null>(null);
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
      }
    });
    return () => {
      active = false;
    };
  }, [session.isPending, userId]);

  useEffect(() => {
    if (session.isPending || !userId) return;
    void clearPreviewGuestSession();
  }, [session.isPending, userId]);

  const finishJoinDialog = () => {
    finishInvitation();
    setStartupDismissed(true);
    setJoinOpen(false);
  };

  const content = (
    <div className="marketing-page">
      <AppHeader
        actions={
          session.data?.user || session.isPending ? null : (
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
            <h1 id="page-title" lang={bilingual ? "en" : undefined}>
              {t("home.title")}
            </h1>
            {bilingual && <p className="hero-zh" lang="zh-CN">
              {t("home.tagline")}
            </p>}
            <div className="hero-description">
              {bilingual && <p lang="en">
                {t("home.summaryEnglish")}
              </p>}
              <p lang={bilingual ? "zh-CN" : undefined}>{t("home.summary")}</p>
            </div>
            <div className="hero-actions">
              {identity.authenticatedUserId || identity.localUserId ? <Link className="primary-button hero-cta" to="/drives">{t("home.myDrives")}</Link> : <Button
                className="primary-button hero-cta"
                onPress={() => { setStartupDismissed(true); setJoinOpen(true); }}
              >
                {t("home.enter")}
              </Button>}
              {previewChoir ? (
                <Link
                  className="hero-preview-link"
                  to={`/choirs/${previewChoir.id}`}
                  onClick={() => startLoadingJourney("enter-drive", "warm")}
                >
                  {t("home.preview")}
                </Link>
              ) : null}
              <InstallButton />
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
        </section>
      </main>


      <JoinDriveDialog open={joinOpen} onClose={finishJoinDialog} identity={identity} invitation={linkInvite} />
      {session.data?.user && <BottomNavigation />}

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
