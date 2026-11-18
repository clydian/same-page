import { useMessages } from "../../i18n";
import { formatBytes } from "./library-format";
import type { UploadProgress } from "./upload-transport";

export function UploadProgressView({ name, progress }: { name: string; progress?: UploadProgress }) {
  const t = useMessages("library");
  return <div className="upload-progress">
    <progress aria-label={t("uploadProgressViewTransferProgress", { name: String(name) })} max={100} value={progress?.percent ?? undefined} />
    {progress && !progress.processing ? <small>
      {progress.percent === null ? t("uploadProgressViewTransmitting") : `${Math.floor(progress.percent)}%`} {t("uploadTransferRate", { rate: formatBytes(progress.bytesPerSecond) })}
    </small> : null}
  </div>;
}
