import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function shellManifest(entries: Array<{ url: string; revision?: string | null; size?: number }>, root = path.resolve('dist/client'), buildId?: string, assetBase = "/") {
  if (assetBase !== "/") {
    const file = path.join(root, "index.html");
    const html = await readFile(file, "utf8");
    await writeFile(file, html.replace('href="/manifest.webmanifest"', `href="${assetBase}manifest.webmanifest"`));
  }
  if (buildId) {
    const url = `playback/${encodeURIComponent(buildId)}/manifest.json`;
    const shellUrls = new Set(entries.map(entry => assetBase + entry.url.replace(/^\//, '')));
    const player = JSON.parse(await readFile(path.join(root, url), 'utf8')) as { entries: Array<{ url: string }> };
    // Keep the legacy player manifest readable by already-deployed clients,
    // but install its entire closure as part of this release's required shell.
    player.entries = player.entries.filter(entry => !shellUrls.has(entry.url));
    await writeFile(path.join(root, url), JSON.stringify(player));
    entries = [...entries, ...player.entries.map(entry => {
      if (!entry.url.startsWith(assetBase)) throw new Error('invalid_player_asset_base');
      return { url: entry.url.slice(assetBase.length), revision: null };
    }), { url, revision: null }];
  }
  entries = [...new Map(entries.map(entry => [entry.url, entry])).values()];
  const manifest = await Promise.all(entries.map(async entry => {
    const bytes = await readFile(path.join(root, entry.url));
    return { ...entry, url: entry.url === 'index.html' ? '/' : assetBase + entry.url.replace(/^\//, ''),
      ...(entry.url === 'index.html' && assetBase !== '/' ? { networkUrl: assetBase + 'index.html' } : {}), revision: entry.revision ?? null,
      integrity: `sha256-${createHash('sha256').update(bytes).digest('base64')}`, bytes: bytes.byteLength, size: bytes.byteLength };
  }));
  await writeFile(path.join(root, 'shell-manifest.json'), JSON.stringify(manifest));
  return { manifest, warnings: [] };
}
