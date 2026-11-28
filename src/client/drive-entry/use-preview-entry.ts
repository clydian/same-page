import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMessages } from "../../i18n";
import { previewChoirResponseSchema, type ChoirSummary } from "../../shared/choirs";
import { useFeedbackMessage } from "../components/use-feedback-message";
import { diagnosticFetch } from "../diagnostics/diagnostics";
import { startLoadingJourney } from "../performance/loading-performance";
import { driveCacheOwnerKey, rememberDriveSummary } from "../score-library/drive-library-cache";

export function usePreviewEntry(userId: string | undefined, preload = false) {
  const t = useMessages("entry");
  const navigate = useNavigate();
  const [choir, setChoir] = useState<ChoirSummary | null>();
  const [attempt, setAttempt] = useState(0);
  const feedback = useFeedbackMessage();
  const { dismiss, setMessage } = feedback;
  const openAfterLookup = useRef(false);
  const preloadUser = preload ? userId : undefined;

  const finishLookup = useEffectEvent((choir: ChoirSummary | null) => {
    setChoir(choir);
    if (choir) rememberDriveSummary(driveCacheOwnerKey(userId ?? null, choir.id), choir);
    if (!openAfterLookup.current) return;
    openAfterLookup.current = false;
    if (!choir) {
      setMessage(t("home.previewUnavailable"), { duration: 5000 });
      return;
    }
    startLoadingJourney("enter-drive", "warm");
    void navigate(previewHref(choir));
  });

  useEffect(() => {
    if (!preload && attempt === 0) return;
    let active = true;
    void loadPreviewChoir().then(choir => {
      if (active) finishLookup(choir);
    });
    return () => { active = false; };
  }, [attempt, preload, preloadUser]);

  return {
    href: choir ? previewHref(choir) : undefined,
    pending: choir === undefined && (preload || attempt > 0),
    feedback,
    open() {
      if (openAfterLookup.current) return;
      dismiss();
      openAfterLookup.current = true;
      setChoir(undefined);
      setAttempt(attempt => attempt + 1);
    },
    cancel() {
      openAfterLookup.current = false;
      dismiss();
    },
  };
}

function previewHref(choir: ChoirSummary) {
  return `/choirs/${choir.id}`;
}

async function loadPreviewChoir(): Promise<ChoirSummary | null> {
  try {
    const response = await diagnosticFetch("/api/guest/preview-choir");
    if (!response.ok) return null;
    return previewChoirResponseSchema.parse(await response.json()).choir;
  } catch {
    return null;
  }
}
