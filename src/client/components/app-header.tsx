import { useAppLocale, useMessages } from "../../i18n";
import { assetUrl } from "../../shared/asset-url";
import type { MouseEventHandler, ReactNode } from "react";
import { Link } from "react-router-dom";
import "../settings/settings-ux.css";

export function AppHeader({ actions, onHome }: { actions?: ReactNode; onHome?: MouseEventHandler<HTMLAnchorElement> }) {
  const t = useMessages("common");
  const { locale } = useAppLocale();
  const chineseBrand = locale === "zh-Hans" || locale === "zh-Hant-TW";
  return (
    <header className="app-header">
      <Link className="brand-link" to="/" state={{ home: true }} aria-label={t("brandHome")} onClick={onHome}>
        <img src={assetUrl("icon-192.png")} alt="" width="44" height="44" />
        {chineseBrand && <span className="brand-name-zh" lang={locale}>{t("brandChinese")}</span>}
        <span className={chineseBrand ? "brand-name-en" : undefined} lang="en">Same Page</span>
      </Link>
      <nav className="app-header__actions">
        {actions}
      </nav>
    </header>
  );
}
