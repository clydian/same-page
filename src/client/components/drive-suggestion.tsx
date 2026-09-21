import type { ReactNode } from "react";
import { Button } from "react-aria-components";
import { X } from "lucide-react";
import { useReturnState } from "../navigation/navigation-context";
import "./drive-suggestion.css";

export function DriveSuggestion({ id, label, title, children, action, closeLabel }: {
  id: string; label: string; title: string; children: ReactNode; action: ReactNode; closeLabel: string;
}) {
  const [dismissed, setDismissed] = useReturnState(`suggestion:${id}`, false);
  if (dismissed) return null;
  return <aside className="drive-suggestion" aria-label={label}>
    <div className="drive-suggestion__heading"><strong>{title}</strong>
      <Button className="icon-button" aria-label={closeLabel} onPress={() => setDismissed(true)}><X size={18} aria-hidden="true" /></Button>
    </div>
    <p>{children}</p>
    <div className="drive-suggestion__action">{action}</div>
  </aside>;
}
