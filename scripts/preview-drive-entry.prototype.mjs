// THROWAWAY local UI review. Synthetic users/drives; no production requests.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { createVisualFixtureSession } from '../visual-report/fixtures.mjs';
const fixture = createVisualFixtureSession();
const aliases = { 'prototype-weekend': '周末合唱团', 'prototype-spring': '春季音乐会' };
const server = await createServer({
  configFile: false,
  define: { __SAME_PAGE_BUILD_ID__: JSON.stringify('a'.repeat(40)), __SAME_PAGE_BUILD_VERSION__: JSON.stringify('设计预览'), __SAME_PAGE_RELEASE_CHANNELS__: 'false' },
  server: { host: '127.0.0.1', port: 4189, strictPort: true },
  plugins: [react(), VitePWA({ registerType: 'prompt' }), {
    name: 'drive-entry-prototype-fixtures',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        let pathname = new URL(req.url, 'http://localhost').pathname;
        if (!pathname.startsWith('/api/')) return next();
        const alias = /^\/api\/choirs\/(prototype-weekend|prototype-spring)(?=\/|$)/.exec(pathname)?.[1];
        if (alias) pathname = pathname.replace(alias, 'visual-choir');
        const result = fixture.resolve({ pathname, method: req.method, identity: 'admin', cookie: req.headers.cookie ?? '' });
        let body = result.body;
        if (String(result.contentType).includes('json')) {
          let value = JSON.parse(body);
          if (pathname === '/api/choirs' && req.method === 'GET') {
            const first = value.memberships.find(row => row.choir.id === 'visual-choir');
            const rows = [first, ...Object.entries(aliases).map(([id, name]) => ({ ...first, id: `membership-${id}`, isOwner: false, choir: { ...first.choir, id, name } }))];
            const state = new URL(req.headers.referer ?? 'http://localhost').searchParams.get('case');
            value = { memberships: state === 'empty' ? [] : state === 'single' ? rows.slice(0, 1) : state === 'missing' ? rows.slice(1) : rows };
          }
          body = JSON.stringify(value).replaceAll('示例云盘', alias ? aliases[alias] : '小红花云盘');
          if (alias) body = body.replaceAll('visual-choir', alias);
        }
        res.writeHead(result.status, { 'content-type': result.contentType, ...result.headers });
        res.end(body);
      });
    },
  }],
});
await server.listen();
console.log('Design preview: http://127.0.0.1:4189/drives?variant=C&case=multiple');
