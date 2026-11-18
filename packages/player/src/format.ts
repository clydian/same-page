import { Unzip, UnzipInflate } from 'fflate';
import { SaxesParser } from 'saxes';

export const MAX_MUSICXML_BYTES = 20 * 1024 * 1024;
export const MUSICXML_ACCEPT = '.musicxml,.xml,.mxl';
const CONTAINER_LIMIT = 256 * 1024;
const MAX_ENTRIES = 256;
const validationMessages = {
  validationEncoding: '无法读取文件编码，请导出 UTF-8 或 UTF-16 MusicXML。',
  validationEncodingMismatch: 'MusicXML 编码声明与内容不一致。',
  validationXmlStructure: 'XML 结构无效，请从制谱软件重新导出。',
  validationCustomEntities: '不支持包含自定义实体的 MusicXML。',
  validationComplexity: 'MusicXML 结构过于复杂。',
  validationTooManyNotes: '乐谱音符过多，最多支持 100000 个音符。',
  validationTooManyParts: '最多支持 15 个独立声部。',
  validationMxlEntryMissing: 'MXL 缺少有效的乐谱入口。',
  validationRoot: '当前支持 score-partwise 乐谱及 MXL 内的平铺 Opus 合集。',
  validationEmptyScore: '这份 MusicXML 没有可播放的声部或音符。',
  validationMxlPath: 'MXL 包含无效路径。',
  validationMxlArchiveIncomplete: 'MXL 压缩包不完整。',
  validationMxlArchiveUnsupported: '不支持分卷或条目过多的 MXL。',
  validationMxlDirectory: 'MXL 目录损坏。',
  validationMxlMethod: 'MXL 加密或压缩方式不受支持。',
  validationMxlDuplicateEntries: 'MXL 条目重复。',
  validationMxlEntryCorrupt: 'MXL 文件条目损坏。',
  validationMxlNameMismatch: 'MXL 文件名不一致。',
  validationMxlDirectoryIncomplete: 'MXL 目录不完整。',
  validationMxlScoreMissing: 'MXL 缺少乐谱入口。',
  validationMxlTotalSize: '解压后的乐谱总大小超过限制。',
  validationMxlEntries: 'MXL 条目重复或数量超过限制。',
  validationMxlUncompressedSize: '解压后的乐谱超过大小限制。',
  validationMxlCompression: 'MXL 压缩内容损坏或不受支持。',
  validationMxlScoreIncomplete: 'MXL 缺少声明的乐谱文件或内容不完整。',
  validationMxlChecksum: 'MXL 内容校验失败。',
  validationOpusXml: 'Opus XML 结构无效。',
  validationOpusBase: '合集不支持 xml:base。',
  validationOpusFlat: '合集仅支持平铺的 score 引用，不支持嵌套或 opus-link。',
  validationOpusTitle: 'Opus 标题结构无效。',
  validationOpusPath: '合集仅支持包内完整乐谱路径，不支持外部或片段引用。',
  validationOpusTooMany: '合集曲目过多。',
  validationOpusChildren: 'Opus 仅支持标题与空 score 引用。',
  validationOpusMissing: 'Opus 缺少标题或曲目。',
  validationFileSize: '乐谱文件必须为 1 字节至 20 MiB。',
  validationDecodedSize: '解码后的乐谱超过 20 MiB。',
  validationOpusTotalSize: '解码后的合集总大小超过 20 MiB。',
  validationOpusRequiresCollection: 'Opus 包含多份独立乐谱，请使用合集准备入口。',
};

export type MusicXmlErrorCode = keyof typeof validationMessages;
export class MusicXmlError extends Error {
  constructor(message: string, readonly code?: MusicXmlErrorCode) { super(message); this.name = 'MusicXmlError'; }
}
function fail(code: MusicXmlErrorCode): never { throw new MusicXmlError(validationMessages[code], code); }

function decode(bytes: Uint8Array): string {
  let encoding = 'utf-8';
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0)) encoding = 'utf-16le';
  if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c)) encoding = 'utf-16be';
  let text: string;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { return fail('validationEncoding'); }
  const declared = text.match(/^\s*<\?xml\s[^?]*encoding\s*=\s*['"]([^'"]+)['"]/i)?.[1]?.toLowerCase();
  if (declared && declared !== encoding && !(declared === 'utf-16' && encoding.startsWith('utf-16'))) fail('validationEncodingMismatch');
  return text.replace(/^(\s*<\?xml\s[^?]*encoding\s*=\s*['"])[^'"]+(['"])/i, '$1UTF-8$2');
}

type XmlBudget = { nodes: number; notes: number; bytes: number };
function inspectXml(text: string, container = false, budget: XmlBudget = { nodes: 0, notes: 0, bytes: 0 }, allowOpus = false): { root: string; entry: string | null } {
  let root = '', depth = 0, notes = 0, parts = 0, nodes = 0;
  let entry: string | null = null;
  const parser = new SaxesParser({ xmlns: false });
  parser.on('error', () => fail('validationXmlStructure'));
  parser.on('doctype', value => {
    // Standard external MusicXML doctypes are declarations only: never fetched.
    if (value.includes('[')) fail('validationCustomEntities');
  });
  parser.on('opentag', tag => {
    depth++; nodes++; budget.nodes++;
    if (depth > 64 || nodes > 1000000 || budget.nodes > 1000000) fail('validationComplexity');
    if (!root) root = tag.name;
    if (tag.name === 'note') { notes++; if (++budget.notes > 100000) fail('validationTooManyNotes'); }
    if (tag.name === 'score-part' && ++parts > 15) fail('validationTooManyParts');
    if (container && depth === 3 && tag.name === 'rootfile' && entry === null) entry = String(tag.attributes['full-path'] ?? '');
  });
  parser.on('closetag', () => depth--);
  // Bounded slices avoid handing a huge unfinished token to a single call.
  for (let i = 0; i < text.length; i += 8192) parser.write(text.slice(i, i + 8192));
  parser.close();
  if (container) {
    if (root !== 'container' || !entry) fail('validationMxlEntryMissing');
  } else {
    if (root !== 'score-partwise' && !(allowOpus && root === 'opus')) fail('validationRoot');
    if (root === 'score-partwise' && (!parts || !notes)) fail('validationEmptyScore');
  }
  return { root, entry };
}

function safePath(path: string) {
  if (!path || path.length > 1024 || path.startsWith('/') || path.includes('\\') || path.includes(':') || path.includes('\0') || path.split('/').some(p => p === '..' || p === '.')) fail('validationMxlPath');
}
// Check the ZIP directory before streaming: fflate intentionally does not verify CRCs.
function zipDirectory(bytes: Uint8Array): Map<string, { size: number; crc: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0 || end < bytes.length - 65557 || end + 22 + view.getUint16(end + 20, true) !== bytes.length) fail('validationMxlArchiveIncomplete');
  const count = view.getUint16(end + 10, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count !== view.getUint16(end + 8, true) || count > MAX_ENTRIES) fail('validationMxlArchiveUnsupported');
  let offset = view.getUint32(end + 16, true);
  if (offset + view.getUint32(end + 12, true) !== end) fail('validationMxlDirectory');
  const directory = new Map<string, { size: number; crc: number }>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) fail('validationMxlDirectory');
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true);
    const length = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    if (flags & 1 || ![0,8].includes(method) || offset + 46 + length + extra + comment > end || local + 30 > offset) fail('validationMxlMethod');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + length));
    safePath(name);
    if (directory.has(name)) fail('validationMxlDuplicateEntries');
    const localLength = view.getUint16(local + 26, true), localExtra = view.getUint16(local + 28, true);
    if (view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method || local + 30 + localLength + localExtra + compressed > view.getUint32(end + 16, true)) fail('validationMxlEntryCorrupt');
    const localName = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(local + 30, local + 30 + localLength));
    if (localName !== name) fail('validationMxlNameMismatch');
    directory.set(name, { size, crc: view.getUint32(offset + 16, true) });
    offset += 46 + length + extra + comment;
  }
  if (offset !== end) fail('validationMxlDirectoryIncomplete');
  return directory;
}
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function unzipEntries(bytes: Uint8Array, wanted: string[], limit: number, directory: Map<string, { size: number; crc: number }>): Map<string, Uint8Array> {
  const selected = new Set(wanted);
  let expectedSize = 0;
  for (const name of selected) { const entry = directory.get(name); if (!entry) fail('validationMxlScoreMissing'); expectedSize += entry!.size; }
  if (expectedSize > limit) fail('validationMxlTotalSize');
  const names = new Set<string>();
  const chunks = new Map<string, Uint8Array[]>(), complete = new Set<string>();
  let total = 0;
  const unzip = new Unzip(file => {
    safePath(file.name);
    if (names.has(file.name) || names.size >= MAX_ENTRIES) fail('validationMxlEntries');
    names.add(file.name);
    if (!selected.has(file.name)) return;
    const parts: Uint8Array[] = []; chunks.set(file.name, parts);
    if (file.originalSize !== undefined && file.originalSize > limit) fail('validationMxlUncompressedSize');
    file.ondata = (error, data, final) => {
      if (error) fail('validationMxlCompression');
      total += data.length;
      if (total > limit) { file.terminate(); fail('validationMxlUncompressedSize'); }
      parts.push(data);
      if (final) complete.add(file.name);
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    // Feed small compressed chunks; never inflate every attachment in a ZIP.
    for (let i = 0; i < bytes.length; i += 1024) unzip.push(bytes.subarray(i, i + 1024), i + 1024 >= bytes.length);
  } catch (error) {
    if (error instanceof MusicXmlError) throw error;
    fail('validationMxlCompression');
  }
  const results = new Map<string, Uint8Array>();
  for (const name of selected) {
    if (!complete.has(name)) fail('validationMxlScoreIncomplete');
    const parts = chunks.get(name)!, expected = directory.get(name)!;
    const result = new Uint8Array(parts.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of parts) { result.set(chunk, offset); offset += chunk.length; }
    if (result.length !== expected.size || crc32(result) !== expected.crc) fail('validationMxlChecksum');
    results.set(name, result);
  }
  return results;
}
const unzipEntry = (bytes: Uint8Array, wanted: string, limit: number, directory: Map<string, { size: number; crc: number }>) => unzipEntries(bytes, [wanted], limit, directory).get(wanted)!;

/** Deliberately supports only complete, package-local score links in one flat opus. */
function opusLinks(text: string): string[] {
  const links: string[] = [];
  let depth = 0, root = '', titles = 0, child = '';
  const parser = new SaxesParser({ xmlns: true });
  parser.on('error', () => fail('validationOpusXml'));
  parser.on('opentag', tag => {
    depth++;
    if (!root) root = tag.local;
    if (Object.values(tag.attributes).some(attribute => attribute.uri === 'http://www.w3.org/XML/1998/namespace' && attribute.local === 'base')) fail('validationOpusBase');
    if (depth === 1) return;
    child = tag.local;
    if (depth !== 2 || !['title', 'score'].includes(tag.local)) fail('validationOpusFlat');
    if (tag.local === 'title') { if (links.length || ++titles > 1) fail('validationOpusTitle'); return; }
    const href = Object.values(tag.attributes).find(attribute => attribute.uri === 'http://www.w3.org/1999/xlink' && attribute.local === 'href')?.value;
    if (!href || /[?#%]/.test(href)) fail('validationOpusPath');
    safePath(href);
    links.push(href);
    if (links.length > MAX_ENTRIES) fail('validationOpusTooMany');
  });
  parser.on('text', value => { if (value.trim() && !(depth === 2 && child === 'title')) fail('validationOpusChildren'); });
  parser.on('closetag', () => depth--);
  parser.write(text).close();
  if (root !== 'opus' || titles !== 1 || !links.length) fail('validationOpusMissing');
  return links;
}

/** Preserve source bytes; return only disposable normalized XML. No network or storage. */
export interface MusicXmlDocumentSource { sources: string[]; opus: boolean }
export function readMusicXmlDocument(bytes: Uint8Array): MusicXmlDocumentSource {
  if (!bytes.length || bytes.length > MAX_MUSICXML_BYTES) fail('validationFileSize');
  let xml = bytes;
  let archive: Map<string, { size: number; crc: number }> | undefined, entry = '';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const directory = zipDirectory(bytes);
    const container = decode(unzipEntry(bytes, 'META-INF/container.xml', CONTAINER_LIMIT, directory));
    entry = inspectXml(container, true).entry!;
    safePath(entry);
    xml = unzipEntry(bytes, entry, MAX_MUSICXML_BYTES, directory);
    archive = directory;
  }
  const text = decode(xml);
  const budget: XmlBudget = { nodes: 0, notes: 0, bytes: 0 };
  const { root } = inspectXml(text, false, budget, Boolean(archive));
  const countBytes = (source: string) => {
    // UTF-16 input can grow when normalized to UTF-8. Apply the same admission
    // limit on the server without allocating another complete output buffer.
    let utf8Bytes = 0;
    for (let i = 0; i < source.length; i++) {
      const code = source.charCodeAt(i);
      if (code < 0x80) utf8Bytes++;
      else if (code < 0x800) utf8Bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff) { utf8Bytes += 4; i++; }
      else utf8Bytes += 3;
      if (utf8Bytes > MAX_MUSICXML_BYTES) fail('validationDecodedSize');
    }
    budget.bytes += utf8Bytes;
    if (budget.bytes > MAX_MUSICXML_BYTES) fail('validationOpusTotalSize');
  };
  countBytes(text);
  if (root !== 'opus') return { sources: [text], opus: false };
  const base = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/') + 1) : '';
  const links = opusLinks(text).map(link => base + link);
  for (const path of links) safePath(path);
  const contents = unzipEntries(bytes, links, MAX_MUSICXML_BYTES - xml.length, archive!);
  const sources = links.map(path => {
    const source = decode(contents.get(path)!);
    inspectXml(source, false, budget); countBytes(source);
    return source;
  });
  return { sources, opus: true };
}

/** Server admission avoids allocating a second normalized output buffer. */
export function validateMusicXmlSource(bytes: Uint8Array): void {
  readMusicXmlDocument(bytes);
}
export function prepareMusicXmlSource(bytes: Uint8Array): Uint8Array {
  const document = readMusicXmlDocument(bytes);
  if (document.opus) fail('validationOpusRequiresCollection');
  const result = new TextEncoder().encode(document.sources[0]);
  if (result.length > MAX_MUSICXML_BYTES) fail('validationDecodedSize');
  return result;
}
