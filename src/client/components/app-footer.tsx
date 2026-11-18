import { useMessages } from "../../i18n";
import { Link } from "react-router-dom";
import { connectionsEnabled, connectionWebsites } from "../connection/connection";

export function AppFooter() {
  const t = useMessages("common");
  return (
    <footer className="app-footer">
      <nav aria-label={t("productInfo")}>
        <Link to="/help">{t("help")}</Link>
        <Link to="/about">{t("about")}</Link>
        <Link to="/pricing">{t("pricing")}</Link>
        <Link to="/terms">{t("terms")}</Link>
        <Link to="/refunds">{t("refunds")}</Link>
        <Link to="/privacy">{t("privacy")}</Link>
        {connectionsEnabled && <a href={connectionWebsites.backup} target="_blank" rel="noopener noreferrer">{t("backup")}</a>}
      </nav>
    </footer>
  );
}
