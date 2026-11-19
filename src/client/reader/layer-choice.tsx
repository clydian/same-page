import { Layers, Lock } from "lucide-react";
import { useMessages } from "../../i18n";
import type { AnnotationLayerSummary } from "../../shared/annotations";

// Shared presentation only; the callers retain their button/menu semantics.
export function LayerChoiceContent({ layer }: { layer: AnnotationLayerSummary }) {
  const t = useMessages("reader");
  return <>
    <span className="layer-choice-icon" aria-hidden="true">{layer.kind === "shared"
      ? <i style={{ background: layer.displayColor }} /> : <Layers size={14} />}</span>
    <span className="layer-choice-text"><span>{layer.name}</span>{!layer.canEdit && <small>{t("viewOnly")}</small>}</span>
    <span className="layer-choice-lock" aria-hidden="true">{!layer.canEdit && <Lock size={14} />}</span>
  </>;
}
