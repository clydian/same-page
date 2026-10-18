import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function shellManifest(entries: Array<{ url: string; revision?: string | null; size?: number }>, root = path.resolve('dist/client')) {
  const manifest = await Promise.all(entries.map(async entry => {
    const bytes = await readFile(path.join(root, entry.url));
    return { ...entry, url: entry.url === 'index.html' ? '/' : entry.url, revision: entry.revision ?? null,
      integrity: `sha256-${createHash('sha256').update(bytes).digest('base64')}`, bytes: bytes.byteLength, size: bytes.byteLength };
  }));
  await writeFile(path.join(root, 'shell-manifest.json'), JSON.stringify(manifest));
  return { manifest, warnings: [] };
}
