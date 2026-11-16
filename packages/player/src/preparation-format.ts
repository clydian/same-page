import type { PreparedMusicXmlDocument } from './musicxml-direction-timing.ts';

/** Version of the source transformations, independent of native MIDI changes. */
export const CURRENT_IMPORT_INPUT_VERSION = 'direction-timing-ties-repeat-v1';

export function isCompatibleMusicXmlPreparation(prepared: PreparedMusicXmlDocument): boolean {
  if ('kind' in prepared && prepared.kind === 'opus') return prepared.importInputVersion === 'flat-local-opus-v1' && prepared.scores.length > 0 && prepared.scores.every(isCompatibleMusicXmlPreparation);
  return prepared.importInputVersion === undefined || prepared.importInputVersion === CURRENT_IMPORT_INPUT_VERSION;
}
