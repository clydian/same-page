import { useEffect, useRef, useState } from "react";
import {
  createPlayerSession,
  type PlayerSession,
} from "@same-page/player";
import { MusicXmlPractice } from "../playback/musicxml-practice";
import { adminFetch, AdminRequestError } from "./api";
// A review session has no reader source, local preferences, shared playback store
// entry, cache, annotation workspace or offline directory.
export default function AdminMusicXml({
  path,
  onReady,
  onDenied,
}: {
  path: string;
  onReady(ready: boolean): void;
  onDenied(): void;
}) {
  const [attempt, setAttempt] = useState(0);
  return (
    <AdminMusicXmlSession
      key={`${path}:${attempt}`}
      path={path}
      onReady={onReady}
      onDenied={onDenied}
      retry={() => setAttempt((n) => n + 1)}
    />
  );
}
function AdminMusicXmlSession({
  path,
  onReady,
  onDenied,
  retry,
}: {
  path: string;
  onReady(ready: boolean): void;
  onDenied(): void;
  retry(): void;
}) {
  const container = useRef<HTMLDivElement>(null),
    viewport = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<PlayerSession | null>(null),
    [error, setError] = useState<string | null>(null),
    [rendered, setRendered] = useState(false),
    [playable, setPlayable] = useState(false);
  useEffect(() => {
    onReady(rendered && playable);
  }, [rendered, playable, onReady]);
  useEffect(() => {
    const controller = new AbortController();
    let player: PlayerSession | null = null;
    const element = container.current;
    const finished = () => setRendered(true);
    element?.addEventListener("alphaTab.renderFinished", finished);
    void (async () => {
      const r = await adminFetch(path, { signal: controller.signal });
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (controller.signal.aborted || !container.current) return;
      player = createPlayerSession(container.current, bytes, {
        scrollElement: viewport.current ?? undefined,
      });
      setSession(player);
    })().catch((e) => {
      if (controller.signal.aborted) return;
      if (e instanceof AdminRequestError && [401, 403].includes(e.status)) {
        onDenied();
        return;
      }
      setError(e instanceof Error ? e.message : "无法读取候选结果。");
    });
    const verify = () => {
      void adminFetch(path, {
        method: "HEAD",
        signal: controller.signal,
      }).catch((e) => {
        if (controller.signal.aborted || !(e instanceof AdminRequestError))
          return;
        if ([401, 403].includes(e.status)) {
          onDenied();
          return;
        }
        if ([404, 409].includes(e.status)) {
          player?.dispose();
          player = null;
          setSession(null);
          setError(e.message);
        }
      });
    };
    window.addEventListener("focus", verify);
    return () => {
      window.removeEventListener("focus", verify);
      controller.abort();
      element?.removeEventListener("alphaTab.renderFinished", finished);
      player?.dispose();
    };
  }, [path, onDenied]);
  return (
    <div className="admin-musicxml">
      <MusicXmlPractice
        embedded
        session={session}
        error={error}
        container={container}
        viewport={viewport}
        retry={retry}
        onReady={setPlayable}
      />
    </div>
  );
}
