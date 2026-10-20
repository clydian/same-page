import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useAppNavigation } from "../navigation/navigation-context";
import "../settings/settings-ux.css";

export function TaskHeader({ title, subtitle, backTo, actions }: { title: ReactNode; subtitle?: string; backTo: string; actions?: ReactNode }) {
  const navigation = useAppNavigation();
  return <header className="task-header">
    <button className="icon-button" aria-label="返回" onClick={() => navigation.back(backTo)}><ArrowLeft size={22} aria-hidden="true" /></button>
    <div className="task-header-heading"><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
    {actions && <nav aria-label="本页操作">{actions}</nav>}
  </header>;
}
