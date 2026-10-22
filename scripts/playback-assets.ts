import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';

// Give each build immutable resource URLs for offline playback. Match Vite's
// real workspace path as well as the installed package path.
export function playbackAssets(buildId: string, assetBase = "/"): Plugin {
  const base = `playback/${encodeURIComponent(buildId)}/`;
  return {
    name: 'same-page-playback-assets', enforce: 'pre',
    transform(code, id) {
      if (!/\/(?:packages\/player|node_modules\/@same-page\/player)\/dist\/session\.js$/.test(id.replaceAll('\\', '/'))) return;
      if (!code.includes("'/font/'") || !code.includes("'/soundfont/sonivox.sf2'")) throw new Error('player_resource_contract_changed');
      return code.replace("'/font/'", JSON.stringify(`${assetBase}${base}font/`)).replace("'/soundfont/sonivox.sf2'", JSON.stringify(`${assetBase}${base}soundfont/sonivox.sf2`));
    },
    async writeBundle(options, bundle) {
      const root = options.dir!;
      if (!Object.keys(bundle).some(name => /musicxml-player-.*\.js$/.test(name))) return;
      const files = new Set<string>();
      const add = (name: string) => {
        if (files.has(name)) return;
        files.add(name);
        const entry = bundle[name];
        if (entry?.type === 'chunk') {
          for (const dependency of entry.imports) add(dependency);
          for (const css of (entry as typeof entry & { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata?.importedCss ?? []) add(css);
        }
      };
      for (const name of Object.keys(bundle)) if (/musicxml-player-|musicxml-engine-|prepare\.worker-|alphaTab\./.test(name)) add(name);
      for (const directory of ['font', 'soundfont']) {
        const dest = path.join(root, base, directory);
        await mkdir(dest, { recursive: true });
        await cp(path.join(root, directory), dest, { recursive: true });
        for (const file of await readdir(dest)) if (!file.endsWith('.txt') && !file.endsWith('.sf3')) files.add(`${base}${directory}/${file}`);
      }
      const entries = await Promise.all([...files].sort().map(async url => {
        const bytes = await readFile(path.join(root, url));
        return { url: `${assetBase}${url}`, bytes: bytes.length, integrity: `sha256-${createHash('sha256').update(bytes).digest('base64')}` };
      }));
      await writeFile(path.join(root, base, 'manifest.json'), JSON.stringify({ buildId, entries }));
    },
  };
}
