import { useMessages } from "../../i18n";
import { FloatingAddButton } from "../components/floating-add-button";

export function UploadFab({ onPress, disabled = false }: { onPress: () => void; disabled?: boolean }) {
  const t = useMessages("library");
  return <FloatingAddButton className="upload-fab" disabled={disabled}
    label={disabled ? t("uploadFabUploadPdfRequiresInternet") : t("uploadUploadPdf")} onPress={onPress} />;
}
