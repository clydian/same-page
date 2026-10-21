import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { Camera, ImagePlus } from "lucide-react";
import { readScannedInvite } from "../components/invite-link";
import { decodeInviteImage, decodeInviteQr } from "./invite-qr";
import "./invite-scanner.css";

export function InviteScanner({ onRead, disabled }: { onRead(code: string): void; disabled: boolean }) {
  const [scanning, setScanning] = useState(false);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState("");
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
    if (!code) { setMessage("未识别到合谱邀请卡，请对准本站邀请卡二维码，或输入邀请码。"); return false; }
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
        if (active) { setScanning(false); setMessage("无法读取相机画面，请从相册识别或输入邀请码。"); }
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
        if (active) { setScanning(false); setMessage("无法开启相机，请允许相机权限，或从相册识别、输入邀请码。"); }
      }
    })();
    return () => { active = false; clearTimeout(timer); release(); };
  }, [scanning, disabled]);
  async function readImage(file: File) {
    const current = ++generation.current;
    imageJob.current = current;
    setReading(true); setScanning(false); setMessage("正在识别邀请卡…");
    try {
      const value = await decodeInviteImage(file);
      if (generation.current !== current || blocked.current) return;
      const code = value && readScannedInvite(value, window.location.origin);
      if (code) { setMessage(""); currentHandler.current(code); }
      else setMessage("图片中未识别到本站邀请卡，请重新选择或输入邀请码。");
    } catch {
      if (generation.current === current) setMessage("无法识别图片，请选择不超过 10 MB 的邀请卡图片，或输入邀请码。");
    } finally { if (imageJob.current === current) setReading(false); }
  }
  return <div className="invite-scanner">
    <div className="invite-scanner-actions">
      <Button className="secondary-button" isDisabled={disabled || reading} onPress={() => { setMessage(""); setScanning(value => !value); }}><Camera size={18} aria-hidden="true" />{scanning ? "停止扫描" : "扫一扫"}</Button>
      <Button className="secondary-button" isDisabled={disabled || reading} onPress={() => fileInput.current?.click()}><ImagePlus size={18} aria-hidden="true" />从相册识别</Button>
    </div>
    <input ref={fileInput} type="file" accept="image/*" aria-label="选择邀请卡图片" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void readImage(file); }} />
    {scanning && !disabled && <video className="invite-scanner-video" ref={video} muted playsInline aria-label="邀请卡扫描画面" />}
    <p className="invite-scanner-hint">扫描合谱邀请卡，或选择保存在这台设备上的图片。图片仅在本机识别。</p>
    {message && <p role="status">{message}</p>}
  </div>;
}
