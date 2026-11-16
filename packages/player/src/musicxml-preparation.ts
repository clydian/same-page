import { prepareMusicXmlSource, readMusicXmlDocument } from './format.ts';
import { prepareMusicXmlForAlphaTabBytes } from './musicxml-direction-timing.ts';
import { CURRENT_IMPORT_INPUT_VERSION, isCompatibleMusicXmlPreparation } from './preparation-format.ts';
import type { PreparedMusicXml, PreparedMusicXmlDocument } from './musicxml-direction-timing.ts';
import { normalizeMusicXmlTransposedTies } from './musicxml-transposed-ties.ts';
import { normalizeMusicXmlRepeatEndings } from './musicxml-repeat-endings.ts';

export class IncompatibleMusicXmlPreparationError extends Error {
  readonly code = 'INCOMPATIBLE_MUSICXML_PREPARATION';
  constructor() {
    super('乐谱准备版本不兼容，请从原始文件重新准备。');
    this.name = 'IncompatibleMusicXmlPreparationError';
  }
}

/** Complete disposable import input. Keep source metadata from before normalization. */
function prepareScore(bytes: Uint8Array): PreparedMusicXml {
  const prepared = prepareMusicXmlForAlphaTabBytes(bytes);
  return {
    ...prepared,
    bytes: normalizeMusicXmlRepeatEndings(normalizeMusicXmlTransposedTies(prepared.bytes)),
    importInputVersion: CURRENT_IMPORT_INPUT_VERSION,
  };
}

export function prepareMusicXmlForPlaybackBytes(bytes: Uint8Array): PreparedMusicXml {
  return prepareScore(prepareMusicXmlSource(bytes));
}

export function prepareMusicXmlDocumentForPlaybackBytes(bytes: Uint8Array): PreparedMusicXmlDocument {
  const document = readMusicXmlDocument(bytes);
  const scores = document.sources.map(source => prepareScore(new TextEncoder().encode(source)));
  return document.opus ? { kind: 'opus', importInputVersion: 'flat-local-opus-v1', bytes: new Uint8Array(), scores } : scores[0];
}

/** Unknown formats must be recompiled from original bytes, never normalized blindly. */
export function musicXmlImportBytes(prepared: PreparedMusicXml): Uint8Array {
  if (!isCompatibleMusicXmlPreparation(prepared)) throw new IncompatibleMusicXmlPreparationError();
  return prepared.importInputVersion === CURRENT_IMPORT_INPUT_VERSION
    ? prepared.bytes
    : normalizeMusicXmlRepeatEndings(normalizeMusicXmlTransposedTies(prepared.bytes));
}
