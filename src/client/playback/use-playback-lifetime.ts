import { useEffect } from 'react';
import { attachmentFetch } from '../score-library/attachments/request';
import { attachmentPath } from '../score-library/attachments/api';
import { holdUpdate } from '../updates/update-safety';
import { onDriveChange } from '../settings/navigation-events';
import { stopPlayback, type PlaybackSource } from './playback-store';

/** Authority and update protection belong to the practice lifetime, regardless of engine. */
export function usePlaybackLifetime(source: PlaybackSource) {
  useEffect(() => {
    const abort = new AbortController();
    const releaseUpdate = holdUpdate();
    const releaseDrive = onDriveChange(impact => {
      if (impact.driveId === source.choirId && impact.dropAuthority) stopPlayback();
    });
    const verify = async () => {
      try {
        const response = await attachmentFetch(attachmentPath(source.choirId, source.score.id, source.attachment.id), { signal: abort.signal });
        if (!abort.signal.aborted && [401, 403, 404].includes(response.status)) stopPlayback();
      } catch { /* Temporary failure does not revoke an already loaded source. */ }
    };
    window.addEventListener('focus', verify);
    void verify();
    return () => { abort.abort(); releaseUpdate(); releaseDrive(); window.removeEventListener('focus', verify); };
  }, [source]);
}
