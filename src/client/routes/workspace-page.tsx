import { useState } from "react";
import { AudioLines, Drum, Mic } from "lucide-react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useMessages } from "../../i18n";
import { presentationSessionId, useApplicationIdentity, type ApplicationIdentity } from "../auth/application-identity";
import { IdentityNotice } from "../auth/local-entry";
import { AppHeader } from "../components/app-header";
import { BottomNavigation } from "../components/bottom-navigation";
import { LoadingStatus } from "../components/loading-status";
import { PersonalSettingsLinks } from "../components/personal-settings-links";
import { useNetworkStatus } from "../platform/use-network-status";
import type { DriveLibrarySnapshot } from "../score-library/drive-library";
import { driveCacheOwnerKey } from "../score-library/drive-library-cache";
import { useDriveLibraryResource } from "../score-library/use-drive-library";
import { sightSingingAccess } from "../sight-singing/access";
import "./workspace-page.css";

type Page = "tools" | "mine";

export default function WorkspacePage({ page }: { page: Page }) {
  const { choirId } = useParams();
  const identity = useApplicationIdentity();
  return choirId ? <DriveWorkspacePage key={JSON.stringify([identity.localUserId, choirId])} page={page} choirId={choirId} identity={identity} />
    : <Workspace page={page} identity={identity} />;
}

function DriveWorkspacePage({ page, choirId, identity }: { page: Page; choirId: string; identity: ApplicationIdentity }) {
  const { localUserId, authenticatedUserId, onlineState, restoring } = identity;
  const [previousSession, setPreviousSession] = useState(identity.authenticatedSessionId);
  const sessionId = presentationSessionId(identity, previousSession);
  if (previousSession !== sessionId) setPreviousSession(sessionId);
  const { snapshot: { access, reading } } = useDriveLibraryResource(
    driveCacheOwnerKey(localUserId, choirId), choirId, Boolean(authenticatedUserId),
    !restoring && (Boolean(localUserId) || onlineState !== "checking"), sessionId,
  );
  return <Workspace page={page} identity={identity} choirId={choirId} access={access} authority={reading.authority} />;
}

function Workspace({ page, identity, choirId, access, authority }: {
  page: Page; identity: ApplicationIdentity; choirId?: string;
  access?: DriveLibrarySnapshot["access"]; authority?: DriveLibrarySnapshot["reading"]["authority"];
}) {
  const t = useMessages("common");
  const entry = useMessages("entry");
  const practice = useMessages("practice");
  const online = useNetworkStatus();
  const { search } = useLocation();
  const opened = access?.kind === "opened" ? access : undefined;
  const experience = opened?.choir.isPreviewEntry === true || new URLSearchParams(search).get("experience") === "1";
  const loading = access?.kind === "loading" || identity.restoring || identity.onlineState === "checking";
  const { member, signedOut, driveDenied } = sightSingingAccess(access, authority, identity);
  const showChallenge = online && !experience && member && !signedOut && !driveDenied;
  const unavailable = !online || identity.onlineState === "unreachable";
  return <div className="app-page workspace-page" data-no-native-selection>
    {page === "mine" && !choirId && <AppHeader />}
    <main className="page-shell workspace-main">
      <h1 className="visually-hidden">{t(page)}</h1>
      {page === "mine" ? <>
        <IdentityNotice identity={identity} />
        <PersonalSettingsLinks identity={identity} choirId={choirId} experience={experience}
          drive={choirId && opened ? { choirId, canManageIdentity: Boolean(opened.isMember || opened.rememberedMembership) } : undefined} />
      </> : <>
        <ul className="workspace-tools" role="list">
          {showChallenge && choirId && <>
            <li><Link className="workspace-tool" to={`/choirs/${choirId}/sight-singing`}>
              <Mic size={40} strokeWidth={1.6} aria-hidden="true" />
              <strong>{practice("sightPractice")}</strong>
            </Link></li>
            <li><article className="workspace-tool workspace-tool-upcoming">
              <Drum size={40} strokeWidth={1.6} aria-hidden="true" />
              <div><strong>{practice("rhythmPractice")}</strong><small>{practice("rhythmComingSoon")}</small></div>
            </article></li>
          </>}
          <li><Link className="workspace-tool" to={`${choirId ? `/choirs/${choirId}` : ""}/tools/pitch-monitor${experience ? "?experience=1" : ""}`}>
            <AudioLines size={40} strokeWidth={1.6} aria-hidden="true" />
            <strong>{practice("pitchMonitor.title")}</strong>
          </Link></li>
        </ul>
        {!showChallenge && choirId && (online && loading ? <LoadingStatus>{practice("sight.loading")}</LoadingStatus>
          : <p className="workspace-empty" role="status">{unavailable ? entry("identity.unreachable") : practice("sight.needMember")}</p>)}
      </>}
    </main>
    <BottomNavigation choirId={choirId} active={page} />
  </div>;
}
