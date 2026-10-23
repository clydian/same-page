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
  {
    title: "不同声部，分层共享笔记",
    illustration: sharedLayersIllustration,
    description:
      "排练要求按声部分层共享，获授权的人可以留下笔记，大家在同一份谱上查看。",
  },
  {
    title: "共享笔记按需看，个人笔记自己留",
    illustration: personalLayerIllustration,
    description:
      "选择需要查看的声部笔记，也能在个人层记下自己的提醒，默认仅自己可见。",
  },
  {
    title: "替换乐谱，保留笔记",
    illustration: replacePdfIllustration,
    description:
      "替换 PDF 后保留已有笔记，仍按原页码和位置显示；排版变化后，请核对笔记位置。",
  },
  {
    title: "离线可用，联网同步",
    illustration: offlineSyncIllustration,
    description:
      "提前保存供离线使用，断网也能继续看谱、做笔记；恢复联网后，笔记会继续同步。",
  },
  {
    title: "一份乐谱，多设备可用",
    illustration: everyDeviceIllustration,
    description:
      "建议将合谱像应用一样安装到 Android 手机和平板、iPhone、iPad、Windows 电脑或 Mac，随时打开同一份乐谱和笔记。",
  },
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
          session.data?.user ? (
            <PersonalMenu email={session.data.user.email} />
          ) : session.isPending ? null : (
            <Link className="header-action header-action--primary" to="/login">
              登录
            </Link>
          )
        }
      />

      <main className="marketing-content">
        <section className="marketing-hero" aria-labelledby="page-title">
          <div className="marketing-hero__content">
            <p className="hero-mark">合谱 · Same Page</p>
            <h1 id="page-title" lang="en">
              Harmony begins on the Same Page
            </h1>
            <p className="hero-zh" lang="zh-CN">
              你的笔记我的谱
            </p>
            <div className="hero-description">
              <p lang="en">
                A cloud-based score library built for choir rehearsals and shared
                annotations.
              </p>
              <p lang="zh-CN">为合唱排练与共享笔记打造的乐谱云盘。</p>
            </div>
            <div className="hero-actions">
              {identity.authenticatedUserId || identity.localUserId ? <Link className="primary-button hero-cta" to="/drives">我的云盘</Link> : <Button
                className="primary-button hero-cta"
                onPress={() => { setStartupDismissed(true); setJoinOpen(true); }}
              >
                进入云盘
              </Button>}
              {previewChoir ? (
                <Link
                  className="hero-preview-link"
                  to={`/choirs/${previewChoir.id}`}
                  onClick={() => startLoadingJourney("enter-drive", "warm")}
                >
                  先看示例
                </Link>
              ) : null}
              <InstallButton />
            </div>
          </div>
          <a className="marketing-more-features" href="#features">
            了解更多功能 <span aria-hidden="true">↓</span>
          </a>
        </section>

        <section id="features" className="marketing-features" aria-label="产品特点">
          {productFeatures.map((feature, index) => (
            <article
              className={`marketing-feature marketing-feature--${
                index % 2 === 0 ? "left" : "right"
              }`}
              key={feature.title}
            >
              <div className="marketing-feature__copy">
                <h2>{feature.title}</h2>
                <p className="marketing-feature__description">
                  {feature.description}
                </p>
              </div>
              {index < 4 ? (
                <FeatureAnimation
                  illustration={feature.illustration}
                  animation={index === 0 ? sharedLayersAnimation : index === 1 ? personalLayerAnimation : index === 2 ? replacePdfAnimation : offlineSyncAnimation}
                  label={feature.title}
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
