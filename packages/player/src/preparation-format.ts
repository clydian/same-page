import type { PreparedMusicXml } from './musicxml-direction-timing.ts';

/** Version of the source transformations, independent of native MIDI changes. */
export const CURRENT_IMPORT_INPUT_VERSION = 'direction-timing-ties-repeat-v1';

export function isCompatibleMusicXmlPreparation(prepared: PreparedMusicXml): boolean {
  return prepared.importInputVersion === undefined || prepared.importInputVersion === CURRENT_IMPORT_INPUT_VERSION;
}
