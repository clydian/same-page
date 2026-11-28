import { FeedbackMessage } from "../components/feedback-message";
import { useFeedbackMessage } from "../components/use-feedback-message";
import { useMessages } from "../../i18n";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { Camera, ImagePlus } from "lucide-react";
import { readScannedInvite } from "../components/invite-link";
import { decodeInviteImage, decodeInviteQr } from "./invite-qr";
import "./invite-scanner.css";

export function InviteScanner({ onRead, disabled }: { onRead(code: string): void; disabled: boolean }) {
  const t = useMessages("entry");
  const [scanning, setScanning] = useState(false);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<"scan.unrecognized" | "scan.cameraFeedError" | "scan.cameraError" | "">("");
  const feedback = useFeedbackMessage();
  const video = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const imageJob = useRef(0);
  const currentHandler = useRef(onRead);
  const blocked = useRef(disabled);
  useLayoutEffect(() => {
    currentHandler.current = onRead;
    blocked.current = disabled;
    if (disabled) generation.current++;
  }, [onRead, disabled]);
  useEffect(() => () => { generation.current++; imageJob.current++; }, []);
  const accept = useEffectEvent((text: string | null) => {
    if (disabled) return false;
    const code = text && readScannedInvite(text, window.location.origin);
    if (!code) { setMessage("scan.unrecognized"); return false; }
    setScanning(false); setMessage(""); onRead(code); return true;
  });
  useEffect(() => {
    if (!scanning || disabled) return;
    let active = true, stream: MediaStream | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const release = () => { stream?.getTracks().forEach(track => track.stop()); };
    async function scan() {
      if (!active || !video.current) return;
      try {
        const value = await decodeInviteQr(video.current, video.current.videoWidth, video.current.videoHeight);
        if (!active) return;
        if (value && accept(value)) { release(); return; }
        timer = setTimeout(() => void scan(), 300);
      } catch {
        if (active) { setScanning(false); setMessage("scan.cameraFeedError"); }
        release();
      }
    }
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("camera_unavailable");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (!active || !video.current) { release(); return; }
        video.current.srcObject = stream;
        await video.current.play();
        if (active) void scan(); else release();
      } catch {
        release();
        if (active) { setScanning(false); setMessage("scan.cameraError"); }
      }
    })();
    return () => { active = false; clearTimeout(timer); release(); };
  }, [scanning, disabled]);
  async function readImage(file: File) {
    const current = ++generation.current;
    imageJob.current = current;
    setReading(true); setScanning(false); setMessage(""); feedback.dismiss();
    try {
      const value = await decodeInviteImage(file);
      if (generation.current !== current || blocked.current) return;
      const code = value && readScannedInvite(value, window.location.origin);
      if (code) currentHandler.current(code);
      else feedback.setMessage(t("scan.imageUnrecognized"), { duration: 8000 });
    } catch {
      if (generation.current === current) feedback.setMessage(t("scan.imageError"), { duration: 8000 });
    } finally { if (imageJob.current === current) setReading(false); }
  }
  const status = reading ? "scan.reading" : message;
  return <div className="invite-scanner">
    <div className="invite-scanner-actions">
      <Button className="secondary-button" isDisabled={disabled || reading} onPress={() => { feedback.dismiss(); setMessage(""); setScanning(value => !value); }}><Camera size={18} aria-hidden="true" />{scanning ? t("scan.stop") : t("scan.start")}</Button>
      <Button className="secondary-button" isDisabled={disabled || reading} onPress={() => fileInput.current?.click()}><ImagePlus size={18} aria-hidden="true" />{t("scan.fromPhoto")}</Button>
    </div>
    <input ref={fileInput} type="file" accept="image/*" aria-label={t("scan.chooseImage")} hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void readImage(file); }} />
    {scanning && !disabled && <video className="invite-scanner-video" ref={video} muted playsInline aria-label={t("scan.camera")} />}
    {status && <p role="status">{t(status)}</p>}
    <FeedbackMessage feedback={feedback} />
  </div>;
}
