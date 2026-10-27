import { Plus } from "lucide-react";
import { useFloatingVisibility } from "../connection/use-floating-visibility";
import { Button } from "react-aria-components";

export function UploadFab({ onPress, disabled = false }: { onPress: () => void; disabled?: boolean }) {
  const { button, visible } = useFloatingVisibility();
  return <Button ref={button} className="upload-fab" isDisabled={disabled} aria-label={disabled ? "上传 PDF（需联网）" : "上传 PDF"} data-visible={visible} inert={!visible} onPress={onPress}><Plus size={28} aria-hidden="true" /></Button>;
}
