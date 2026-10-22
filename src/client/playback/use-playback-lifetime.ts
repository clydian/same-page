import { revokeOfflineMusicXml } from './offline-musicxml';
import { useEffect } from 'react';
import { clearPlaybackPreparation } from './playback-preparation';
import { attachmentFetch } from '../score-library/attachments/request';
import { attachmentPath, readAttachment } from '../score-library/attachments/api';
import { readPlaybackAttachment } from './musicxml-source';
import { SettingsRequestError } from '../settings/settings-request';
import { holdUpdate } from '../updates/update-safety';
import { onDriveChange } from '../settings/navigation-events';
import { playbackStore, stopPlayback, type PlaybackSource } from './playback-store';

/** Authority and update protection belong to the practice lifetime, regardless of engine. */
export function usePlaybackLifetime(source: PlaybackSource) {
  useEffect(() => {
    const abort = new AbortController();
    const releaseUpdate = holdUpdate();
    const releaseDrive = onDriveChange(impact => {
      if (impact.driveId === source.choirId && impact.dropAuthority) stopPlayback();
    });
    const revoke = () => {
      if (abort.signal.aborted || playbackStore.getSnapshot() !== source) return;
      clearPlaybackPreparation(source); void revokeOfflineMusicXml(source).catch(() => undefined); stopPlayback();
    };
    const verify = async (initial = false) => {
      try {
        if (source.attachment.kind === 'musicxml') {
          // Only the mount check joins source selection. Focus is a new authority check.
          if (initial) await readPlaybackAttachment(source, abort.signal);
          else await readAttachment(source.choirId, source.score.id, source.attachment.id, abort.signal);
        } else {
          const response = await attachmentFetch(attachmentPath(source.choirId, source.score.id, source.attachment.id), { signal: abort.signal });
          if ([401, 403, 404].includes(response.status)) revoke();
        }
      } catch (reason) {
        if (reason instanceof SettingsRequestError && [401, 403, 404].includes(reason.status)) revoke();
        // Temporary failure does not revoke an already loaded source.
      }
    };
    const focus = () => { void verify(); };
    window.addEventListener('focus', focus);
    void verify(true);
    return () => { abort.abort(); releaseUpdate(); releaseDrive(); window.removeEventListener('focus', focus); };
  }, [source]);
}
