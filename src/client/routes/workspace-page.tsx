import { useState } from "react";
import { AudioLines, Drum, Mic } from "lucide-react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useMessages } from "../../i18n";
import { presentationSessionId, useApplicationIdentity, type ApplicationIdentity } from "../auth/application-identity";
import { IdentityNotice } from "../auth/local-entry";
import { AppHeader } from "../components/app-header";
import { BottomNavigation } from "../components/bottom-navigation";
import { PersonalSettingsLinks } from "../components/personal-settings-links";
import type { DriveLibrarySnapshot } from "../score-library/drive-library";
import { driveCacheOwnerKey } from "../score-library/drive-library-cache";
import { useDriveLibraryResource } from "../score-library/use-drive-library";
import "./workspace-page.css";

type Page = "tools" | "mine";

export default function WorkspacePage({ page }: { page: Page }) {
  const { choirId } = useParams();
  return page === "tools" ? <ToolsWorkspace choirId={choirId} /> : <PersonalWorkspaceRoute choirId={choirId} />;
}

function ToolsWorkspace({ choirId }: { choirId?: string }) {
  const t = useMessages("common");
  const practice = useMessages("practice");
  const { search } = useLocation();
  const experience = new URLSearchParams(search).get("experience") === "1";
  const drive = choirId ? `/choirs/${choirId}` : "";
  return <div className="app-page workspace-page" data-no-native-selection>
    <main className="page-shell workspace-main">
      <h1 className="visually-hidden">{t("tools")}</h1>
      <ul className="workspace-tools" role="list">
        {choirId && !experience && <>
          <li><Link className="workspace-tool" to={`${drive}/sight-singing`}>
            <Mic size={40} strokeWidth={1.6} aria-hidden="true" />
            <strong>{practice("sightPractice")}</strong>
          </Link></li>
          <li><Link className="workspace-tool" to={`${drive}/rhythm`}>
            <Drum size={40} strokeWidth={1.6} aria-hidden="true" />
            <strong>{practice("rhythmPractice")}</strong>
          </Link></li>
        </>}
        <li><Link className="workspace-tool" to={`${drive}/tools/pitch-monitor${experience ? "?experience=1" : ""}`}>
          <AudioLines size={40} strokeWidth={1.6} aria-hidden="true" />
          <strong>{practice("pitchMonitor.title")}</strong>
        </Link></li>
      </ul>
    </main>
    <BottomNavigation choirId={choirId} active="tools" />
  </div>;
}

function PersonalWorkspaceRoute({ choirId }: { choirId?: string }) {
  const identity = useApplicationIdentity();
  return choirId ? <DrivePersonalWorkspace key={JSON.stringify([identity.localUserId, choirId])} choirId={choirId} identity={identity} />
    : <PersonalWorkspace identity={identity} />;
}

function DrivePersonalWorkspace({ choirId, identity }: { choirId: string; identity: ApplicationIdentity }) {
  const { localUserId, authenticatedUserId, onlineState, restoring } = identity;
  const [previousSession, setPreviousSession] = useState(identity.authenticatedSessionId);
  const sessionId = presentationSessionId(identity, previousSession);
  if (previousSession !== sessionId) setPreviousSession(sessionId);
  const { snapshot: { access } } = useDriveLibraryResource(
    driveCacheOwnerKey(localUserId, choirId), choirId, Boolean(authenticatedUserId),
    !restoring && (Boolean(localUserId) || onlineState !== "checking"), sessionId,
  );
  return <PersonalWorkspace identity={identity} choirId={choirId} access={access} />;
}

function PersonalWorkspace({ identity, choirId, access }: {
  identity: ApplicationIdentity; choirId?: string; access?: DriveLibrarySnapshot["access"];
}) {
  const t = useMessages("common");
  const { search } = useLocation();
  const opened = access?.kind === "opened" ? access : undefined;
  const experience = opened?.choir.isPreviewEntry === true || new URLSearchParams(search).get("experience") === "1";
  return <div className="app-page workspace-page" data-no-native-selection>
    {!choirId && <AppHeader />}
    <main className="page-shell workspace-main">
      <h1 className="visually-hidden">{t("mine")}</h1>
      <IdentityNotice identity={identity} />
      <PersonalSettingsLinks identity={identity} choirId={choirId} experience={experience}
        drive={choirId && opened ? { choirId, canManageIdentity: Boolean(opened.isMember || opened.rememberedMembership) } : undefined} />
    </main>
    <BottomNavigation choirId={choirId} active="mine" />
  </div>;
}
