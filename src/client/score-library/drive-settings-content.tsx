import { useMessages } from "../../i18n";
import type { ReactNode } from "react";
import { Info, UsersRound, Layers, KeyRound, Trash2, ChevronRight } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { TaskHeader } from "../components/task-header";
import { useCompactLayout } from "../platform/use-compact-layout";
import "./drive-settings.css";

const sections = [
  { id: "info", path: "settings/info", titleKey: "driveSettingsContentBasicInformation", descriptionKey: "driveSettingsContentCloudDiskNameStorage", Icon: Info },
  { id: "memberships", path: "memberships", titleKey: "membersAndPermissions", descriptionKey: "driveSettingsContentViewDivisionMembersPermissions", Icon: UsersRound },
  { id: "shared-layers", path: "shared-layers", titleKey: "sharedLayers", descriptionKey: "driveSettingsContentConfigureCommonNoteLayer", Icon: Layers },
  { id: "admission", path: "settings/admission", titleKey: "joinMethod", descriptionKey: "driveSettingsContentInvitationLinkInvitationCode", Icon: KeyRound },
  { id: "trash", path: "settings/trash", titleKey: "trash", descriptionKey: "driveSettingsContentRetrieveRecentlyDeletedSheet", Icon: Trash2 },
] as const;

type Section = typeof sections[number]["id"];
export function DriveSettingsContent({ choirId, name, section, index = false, children, className = "" }: {
  choirId: string; name?: string; section: Section; index?: boolean; children: ReactNode; className?: string;
}) {
  const t = useMessages("library");
  const compact = useCompactLayout();
  const Layout = compact && index ? "main" : "div";
  const current = sections.find(item => item.id === section)!;
  if (index && !compact) return <Navigate to={`/choirs/${choirId}/settings/info`} replace />;
  return <div className={`app-page drive-settings-page${index ? " drive-settings-index" : ""}`}>
    <TaskHeader title={index || !compact ? t("driveSettings") : t(current.titleKey)} subtitle={name} backBehavior="parent"
      backTo={index || !compact ? `/choirs/${choirId}` : `/choirs/${choirId}/settings`} />
    <Layout className="drive-settings-layout page-shell">
      {(!compact || index) && <nav className="drive-settings-nav" aria-label={t("driveSettingsContentCloudDiskSettingClassification")}>
        {sections.map(({ id, path, titleKey, descriptionKey, Icon }) => <Link key={id} to={`/choirs/${choirId}/${path}`} replace={!compact} className={section === id ? "drive-setting-link current" : "drive-setting-link"}
          aria-label={t(titleKey)} aria-description={t(descriptionKey)} aria-current={!index && section === id ? "page" : undefined}>
          <Icon size={19} aria-hidden="true" /><span><strong>{t(titleKey)}</strong><small>{t(descriptionKey)}</small></span><ChevronRight className="drive-setting-chevron" size={17} aria-hidden="true" />
        </Link>)}
      </nav>}
      {(!compact || !index) && <main className={`drive-settings-main settings-page settings-ux ${className}`}>
        {!compact && <h2 className="drive-settings-content-title">{t(current.titleKey)}</h2>}
        {children}
      </main>}
    </Layout>
  </div>;
}
