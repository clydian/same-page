import { Unzip, UnzipInflate } from 'fflate';
import { SaxesParser } from 'saxes';

export const MAX_MUSICXML_BYTES = 20 * 1024 * 1024;
export const MUSICXML_ACCEPT = '.musicxml,.xml,.mxl';
const CONTAINER_LIMIT = 256 * 1024;
const MAX_ENTRIES = 256;
export class MusicXmlError extends Error {
  constructor(message: string) { super(message); this.name = 'MusicXmlError'; }
}
const fail = (message: string): never => { throw new MusicXmlError(message); };

function decode(bytes: Uint8Array): string {
  let encoding = 'utf-8';
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0)) encoding = 'utf-16le';
  if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c)) encoding = 'utf-16be';
  let text: string;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { return fail('无法读取文件编码，请导出 UTF-8 或 UTF-16 MusicXML。'); }
  const declared = text.match(/^\s*<\?xml\s[^?]*encoding\s*=\s*['"]([^'"]+)['"]/i)?.[1]?.toLowerCase();
  if (declared && declared !== encoding && !(declared === 'utf-16' && encoding.startsWith('utf-16'))) fail('MusicXML 编码声明与内容不一致。');
  return text.replace(/^(\s*<\?xml\s[^?]*encoding\s*=\s*['"])[^'"]+(['"])/i, '$1UTF-8$2');
}

function inspectXml(text: string, container = false): string | null {
  let root = '', depth = 0, notes = 0, parts = 0, nodes = 0;
  let entry: string | null = null;
  const parser = new SaxesParser({ xmlns: false });
  parser.on('error', () => fail('XML 结构无效，请从制谱软件重新导出。'));
  parser.on('doctype', value => {
    // Standard external MusicXML doctypes are declarations only: never fetched.
    if (value.includes('[')) fail('不支持包含自定义实体的 MusicXML。');
  });
  parser.on('opentag', tag => {
    depth++; nodes++;
    if (depth > 64 || nodes > 1000000) fail('MusicXML 结构过于复杂。');
    if (!root) root = tag.name;
    if (tag.name === 'note' && ++notes > 100000) fail('乐谱音符过多，最多支持 100000 个音符。');
    if (tag.name === 'score-part' && ++parts > 15) fail('最多支持 15 个独立声部。');
    if (container && depth === 3 && tag.name === 'rootfile' && entry === null) entry = String(tag.attributes['full-path'] ?? '');
  });
  parser.on('closetag', () => depth--);
  // Bounded slices avoid handing a huge unfinished token to a single call.
  for (let i = 0; i < text.length; i += 8192) parser.write(text.slice(i, i + 8192));
  parser.close();
  if (container) {
    if (root !== 'container' || !entry) fail('MXL 缺少有效的乐谱入口。');
  } else {
    if (root !== 'score-partwise') fail('当前支持单份 score-partwise 乐谱，请重新导出此格式。');
    if (!parts || !notes) fail('这份 MusicXML 没有可播放的声部或音符。');
  }
  return entry;
}

function safePath(path: string) {
  if (!path || path.length > 1024 || path.startsWith('/') || path.includes('\\') || path.includes(':') || path.includes('\0') || path.split('/').some(p => p === '..' || p === '.')) fail('MXL 包含无效路径。');
}
// Check the ZIP directory before streaming: fflate intentionally does not verify CRCs.
function zipDirectory(bytes: Uint8Array): Map<string, { size: number; crc: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0 || end < bytes.length - 65557 || end + 22 + view.getUint16(end + 20, true) !== bytes.length) fail('MXL 压缩包不完整。');
  const count = view.getUint16(end + 10, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count !== view.getUint16(end + 8, true) || count > MAX_ENTRIES) fail('不支持分卷或条目过多的 MXL。');
  let offset = view.getUint32(end + 16, true);
  if (offset + view.getUint32(end + 12, true) !== end) fail('MXL 目录损坏。');
  const directory = new Map<string, { size: number; crc: number }>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) fail('MXL 目录损坏。');
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true);
    const length = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    if (flags & 1 || ![0,8].includes(method) || offset + 46 + length + extra + comment > end || local + 30 > offset) fail('MXL 加密或压缩方式不受支持。');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + length));
    safePath(name);
    if (directory.has(name)) fail('MXL 条目重复。');
    const localLength = view.getUint16(local + 26, true), localExtra = view.getUint16(local + 28, true);
    if (view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method || local + 30 + localLength + localExtra + compressed > view.getUint32(end + 16, true)) fail('MXL 文件条目损坏。');
    const localName = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(local + 30, local + 30 + localLength));
    if (localName !== name) fail('MXL 文件名不一致。');
    directory.set(name, { size, crc: view.getUint32(offset + 16, true) });
    offset += 46 + length + extra + comment;
  }
  if (offset !== end) fail('MXL 目录不完整。');
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

function unzipEntry(bytes: Uint8Array, wanted: string, limit: number, directory: Map<string, { size: number; crc: number }>): Uint8Array {
  const expected = directory.get(wanted);
  if (!expected || expected.size > limit) fail("MXL 缺少乐谱入口或解压大小超过限制。");
  const names = new Set<string>();
  const chunks: Uint8Array[] = [];
  let total = 0, complete = false;
  const unzip = new Unzip(file => {
    safePath(file.name);
    if (names.has(file.name) || names.size >= MAX_ENTRIES) fail('MXL 条目重复或数量超过限制。');
    names.add(file.name);
    if (file.name !== wanted) return;
    if (file.originalSize !== undefined && file.originalSize > limit) fail('解压后的乐谱超过大小限制。');
    file.ondata = (error, data, final) => {
      if (error) fail('MXL 压缩内容损坏或不受支持。');
      total += data.length;
      if (total > limit) { file.terminate(); fail('解压后的乐谱超过大小限制。'); }
      chunks.push(data);
      complete = final;
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    // Feed small compressed chunks; never inflate every attachment in a ZIP.
    for (let i = 0; i < bytes.length; i += 1024) unzip.push(bytes.subarray(i, i + 1024), i + 1024 >= bytes.length);
  } catch (error) {
    if (error instanceof MusicXmlError) throw error;
    fail('MXL 压缩内容损坏或不受支持。');
  }
  if (!complete) fail('MXL 缺少声明的乐谱文件或内容不完整。');
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  if (result.length !== expected!.size || crc32(result) !== expected!.crc) fail("MXL 内容校验失败。");
  return result;
}

/** Preserve source bytes; return only disposable normalized XML. No network or storage. */
function readMusicXmlSource(bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > MAX_MUSICXML_BYTES) fail('乐谱文件必须为 1 字节至 20 MiB。');
  let xml = bytes;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const directory = zipDirectory(bytes);
    const container = decode(unzipEntry(bytes, 'META-INF/container.xml', CONTAINER_LIMIT, directory));
    const entry = inspectXml(container, true)!;
    safePath(entry);
    xml = unzipEntry(bytes, entry, MAX_MUSICXML_BYTES, directory);
  }
  const text = decode(xml);
  inspectXml(text);
  // UTF-16 input can grow when normalized to UTF-8. Apply the same admission
  // limit on the server without allocating another complete output buffer.
  let utf8Bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) utf8Bytes++;
    else if (code < 0x800) utf8Bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) { utf8Bytes += 4; i++; }
    else utf8Bytes += 3;
    if (utf8Bytes > MAX_MUSICXML_BYTES) fail('解码后的乐谱超过 20 MiB。');
  }
  return text;
}

/** Server admission avoids allocating a second normalized output buffer. */
export function validateMusicXmlSource(bytes: Uint8Array): void {
  readMusicXmlSource(bytes);
}
export function prepareMusicXmlSource(bytes: Uint8Array): Uint8Array {
  const result = new TextEncoder().encode(readMusicXmlSource(bytes));
  if (result.length > MAX_MUSICXML_BYTES) fail('解码后的乐谱超过 20 MiB。');
  return result;
}
