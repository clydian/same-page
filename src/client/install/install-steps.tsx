import { useMessages } from "../../i18n";
import { Download, Ellipsis, EllipsisVertical, Share, SquarePlus, Compass, Check } from "lucide-react";
import type { InstallGuide } from "./install-context";

// Real control symbols with short labels, rather than screenshots tied to one OS release.
export function InstallSteps({ guide }: { guide: InstallGuide }) {
  const t = useMessages("system");
  const external = guide.endsWith("external");
  const ios = guide === "safari" || guide.startsWith("ios");
  const steps = external ? [
    { icon: Ellipsis, title: t("installSteps.openAppMenu"), detail: t("installSteps.appMenuHelp") },
    { icon: Compass, title: ios ? t("installSteps.useSafari") : t("installSteps.useBrowser"), detail: t("installSteps.openBrowserHelp") },
  ] : ios ? [
    { icon: Share, title: t("installSteps.share"), detail: t("installSteps.shareHelp") },
    { icon: SquarePlus, title: t("installSteps.homeScreen"), detail: t("installSteps.homeScreenHelp") },
    { icon: Check, title: t("installSteps.confirm"), detail: t("installSteps.confirmHelp") },
  ] : guide === "android" ? [
    { icon: EllipsisVertical, title: t("installSteps.browserMenu"), detail: t("installSteps.browserMenuHelp") },
    { icon: Download, title: t("installSteps.installAndroid"), detail: t("installSteps.installAndroidHelp") },
  ] : [
    { icon: Download, title: t("installSteps.installDesktop"), detail: t("installSteps.installDesktopHelp") },
    { icon: SquarePlus, title: t("installSteps.safariDock"), detail: t("installSteps.launch") },
  ];
  return <ol className="install-steps">{steps.map(({ icon: Icon, title, detail }, index) => <li key={title}><span aria-hidden="true"><Icon size={23} /></span><div><strong>{index + 1}. {title}</strong><p>{detail}</p></div></li>)}</ol>;
}
