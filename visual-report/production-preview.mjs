import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { startViteServer } from '../scripts/vite-server.mjs';

// Production visual suites run concurrently. Own both the build and preview so
// a second suite cannot replace the hashes, asset base or worker underneath us.
export async function startProductionPreview() {
 const root = process.cwd(), temporary = await mkdtemp(path.join(tmpdir(), 'same-page-production-visual-'));
 const run = promisify(execFile);
 try {
  // Checkout and the test container can have different owners. Trust only this
  // invocation's workspace, without changing global Git configuration.
  const { stdout } = await run('git', ['-c', `safe.directory=${root}`, 'rev-parse', 'HEAD'], { cwd: root });
  const env = { ...process.env, SAME_PAGE_BUILD_ID: stdout.trim(), SAME_PAGE_RELEASE_CHANNELS: '1' };
  const files = (await readdir(root)).filter(name => /^(?:package(?:-lock)?\.json|tsconfig(?:\.[\w-]+)?\.json|(?:vite|vitest[\w.-]*|eslint)\.config\.[jt]s|wrangler\.jsonc|index\.html)$/.test(name));
  await Promise.all([...files, 'src', 'worker', 'service-worker', 'scripts', 'public', 'design', 'migrations', 'packages'].map(name => cp(path.join(root, name), path.join(temporary, name), { recursive: true })));
  const modules = path.join(temporary, 'node_modules');
  await mkdir(path.join(modules, '@same-page'), { recursive: true });
  await symlink(path.join(temporary, 'packages/player'), path.join(modules, '@same-page/player'), 'dir');
  await Promise.all((await readdir(path.join(root, 'node_modules'), { withFileTypes: true }))
   .filter(entry => !['@same-page', '.tmp', '.vite', '.vite-temp'].includes(entry.name))
   .map(entry => symlink(path.join(root, 'node_modules', entry.name), path.join(modules, entry.name), entry.isDirectory() ? 'dir' : 'file')));
  await run('npm', ['run', 'build'], { cwd: temporary, env, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  const server = await startViteServer({ script: 'preview', cwd: temporary, env });
  return { ...server, stop: async () => { try { await server.stop(); } finally { await rm(temporary, { recursive: true, force: true }); } } };
 } catch (error) {
  // startViteServer writes UUID-named process/port diagnostics under its cwd.
  // Preserve them in the caller's upload directory before deleting the build.
  await cp(path.join(temporary, 'artifacts/verification/server-startup'), path.join(root, 'artifacts/verification/server-startup'), { recursive: true }).catch(() => undefined);
  await rm(temporary, { recursive: true, force: true });
  throw error;
 }
}
