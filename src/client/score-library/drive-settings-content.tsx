import type { ReactNode } from "react";
import { Info, UsersRound, Layers, KeyRound, Trash2, ChevronRight } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { TaskHeader } from "../components/task-header";
import { useCompactLayout } from "../platform/use-compact-layout";
import "./drive-settings.css";

const sections = [
  { id: "info", path: "settings/info", title: "基本信息", description: "云盘名称与存储用量", Icon: Info },
  { id: "memberships", path: "memberships", title: "成员与权限", description: "查看成员与权限分工", Icon: UsersRound },
  { id: "shared-layers", path: "shared-layers", title: "共享层", description: "配置共同使用的笔记层", Icon: Layers },
  { id: "admission", path: "settings/admission", title: "加入方式", description: "邀请链接与邀请码", Icon: KeyRound },
  { id: "trash", path: "settings/trash", title: "回收站", description: "找回最近删除的乐谱", Icon: Trash2 },
] as const;

type Section = typeof sections[number]["id"];
export function DriveSettingsContent({ choirId, name, section, index = false, children, className = "" }: {
  choirId: string; name?: string; section: Section; index?: boolean; children: ReactNode; className?: string;
}) {
  const compact = useCompactLayout();
  const Layout = compact && index ? "main" : "div";
  const current = sections.find(item => item.id === section)!;
  if (index && !compact) return <Navigate to={`/choirs/${choirId}/settings/info`} replace />;
  return <div className={`app-page drive-settings-page${index ? " drive-settings-index" : ""}`}>
    <TaskHeader title={index || !compact ? "云盘设置" : current.title} subtitle={name} backBehavior="parent"
      backTo={index || !compact ? `/choirs/${choirId}` : `/choirs/${choirId}/settings`} />
    <Layout className="drive-settings-layout page-shell">
      {(!compact || index) && <nav className="drive-settings-nav" aria-label="云盘设置分类">
        {sections.map(({ id, path, title, description, Icon }) => <Link key={id} to={`/choirs/${choirId}/${path}`} replace={!compact} className={section === id ? "drive-setting-link current" : "drive-setting-link"}
          aria-label={title} aria-description={description} aria-current={!index && section === id ? "page" : undefined}>
          <Icon size={19} aria-hidden="true" /><span><strong>{title}</strong><small>{description}</small></span><ChevronRight className="drive-setting-chevron" size={17} aria-hidden="true" />
        </Link>)}
      </nav>}
      {(!compact || !index) && <main className={`drive-settings-main settings-page settings-ux ${className}`}>
        {!compact && <h2 className="drive-settings-content-title">{current.title}</h2>}
        {children}
      </main>}
    </Layout>
  </div>;
}
