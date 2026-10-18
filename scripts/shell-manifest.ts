import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function shellManifest(entries: Array<{ url: string; revision?: string | null; size?: number }>, root = path.resolve('dist/client'), buildId?: string) {
  if (buildId) {
    const url = `playback/${encodeURIComponent(buildId)}/manifest.json`;
    const shellUrls = new Set(entries.map(entry => '/' + entry.url.replace(/^\//, '')));
    const player = JSON.parse(await readFile(path.join(root, url), 'utf8')) as { entries: Array<{ url: string }> };
    // Shared dependencies are already verified by the required shell audit.
    // Avoid downloading/storing a second copy in the optional bundle.
    player.entries = player.entries.filter(entry => !shellUrls.has(entry.url));
    await writeFile(path.join(root, url), JSON.stringify(player));
    entries = [...entries, { url, revision: null }];
  }
  const manifest = await Promise.all(entries.map(async entry => {
    const bytes = await readFile(path.join(root, entry.url));
    return { ...entry, url: entry.url === 'index.html' ? '/' : entry.url, revision: entry.revision ?? null,
      integrity: `sha256-${createHash('sha256').update(bytes).digest('base64')}`, bytes: bytes.byteLength, size: bytes.byteLength };
  }));
  await writeFile(path.join(root, 'shell-manifest.json'), JSON.stringify(manifest));
  return { manifest, warnings: [] };
}
