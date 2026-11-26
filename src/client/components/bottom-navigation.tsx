import { BookOpen, Grid2X2, UserRound } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useMessages } from "../../i18n";
import "./bottom-navigation.css";

export type WorkspaceTab = "scores" | "tools" | "mine";

export function BottomNavigation({ choirId, active }: { choirId?: string; active?: WorkspaceTab }) {
  const t = useMessages("common");
  const library = useMessages("library");
  const { pathname, search, hash } = useLocation();
  const scope = choirId ? `/choirs/${choirId}` : "";
  const experience = new URLSearchParams(search).get("experience") === "1" ? "?experience=1" : "";
  const tabs = [
    { id: "scores", to: scope || "/drives", label: library("score"), Icon: BookOpen },
    { id: "tools", to: `${scope}/tools`, label: t("tools"), Icon: Grid2X2 },
    { id: "mine", to: `${scope}/mine`, label: t("mine"), Icon: UserRound },
  ];
  return <nav className="bottom-navigation" aria-label={t("mainNavigation")}>
    <div className="bottom-navigation-items">
      {tabs.map(({ id, to, label, Icon }) => <Link key={id} className="bottom-navigation-item"
        to={active === id ? { pathname, search, hash } : to + experience}
        aria-current={active === id ? "page" : undefined}
        onClick={event => {
          // A second tap on the current tab keeps the current history entry.
          if (active === id && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) event.preventDefault();
        }}>
        <Icon size={20} aria-hidden="true" />{label}
      </Link>)}
    </div>
  </nav>;
}
