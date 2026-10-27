import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { startStorageFixture } from './storage-fixture.mjs';

// Real HTTPS sibling hosts: no browser cookie jars or CORS responses are mocked.
// nip.io resolves these names to loopback; business data stays in local workerd.
export async function startConnectionFixture({ invite = false } = {}) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'same-page-connections-'));
  let fixture;
  const servers = [];
  const network = { directBroken: false, backupBroken: false, loseUploadResponse: false, uploads: 0, traffic: [], admissionFaults: { direct: null, backup: null } };
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(temporary, 'key.pem'), '-out', path.join(temporary, 'cert.pem'), '-days', '1', '-subj', '/CN=*.127.0.0.1.nip.io'], { stdio: 'ignore' });
    const tls = { key: await readFile(path.join(temporary, 'key.pem')), cert: await readFile(path.join(temporary, 'cert.pem')) };
    const origins = {};
    for (const entry of ['direct', 'backup']) {
      const server = createServer(tls, async (request, response) => {
        if (!fixture || (entry === 'direct' ? network.directBroken : network.backupBroken) && request.url.startsWith('/api/')) { response.destroy(); return; }
        const pathname = new URL(request.url, 'https://fixture.invalid').pathname;
        const admission = pathname.endsWith('/guest/session') && request.method === 'POST';
        const fault = admission ? network.admissionFaults[entry] : null;
        if (fault === 'headers') { network.traffic.push({ path: request.url, method: request.method }); request.resume(); return; }
        const upload = pathname.endsWith('/scores') && request.method === 'POST';
        if (upload) network.uploads++;
        if (request.url.startsWith('/api/')) network.traffic.push({ path: request.url, method: request.method });
        try {
          const headers = { ...request.headers }; delete headers.host;
          const upstream = await fetch(fixture.origin + request.url, {
            method: request.method, headers, redirect: 'manual',
            ...(['GET', 'HEAD'].includes(request.method) ? {} : { body: Readable.toWeb(request), duplex: 'half' }),
          });
          if (upload && network.loseUploadResponse) {
            network.loseUploadResponse = false;
            if (upstream.status !== 201) throw new Error('fixture_upload_failed');
            await upstream.arrayBuffer();
            // Send a partial acknowledged response: Chromium may transparently
            // retry a POST when the TCP connection dies before any headers.
            response.writeHead(201, { 'content-type': 'application/json', 'content-length': '1000' });
            response.write('{"score":', () => response.destroy()); return;
          }
          const resultHeaders = Object.fromEntries(upstream.headers);
          delete resultHeaders['set-cookie']; delete resultHeaders['transfer-encoding'];
          if (resultHeaders['content-encoding']) { delete resultHeaders['content-encoding']; delete resultHeaders['content-length']; }
          const cookies = upstream.headers.getSetCookie();
          if (cookies.length) resultHeaders['set-cookie'] = cookies;
          if (fault === 'body') {
            await upstream.arrayBuffer();
            resultHeaders['content-length'] = '1000';
            response.writeHead(upstream.status, resultHeaders); response.write('{"choir":'); return;
          }
          response.writeHead(upstream.status, resultHeaders);
          if (upstream.body) Readable.fromWeb(upstream.body).on('error', () => response.destroy()).pipe(response);
          else response.end();
        } catch { if (!response.headersSent) response.writeHead(502); response.end(); }
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      servers.push(server);
      const host = entry === 'direct' ? 'app' : 'alt';
      origins[entry] = `https://${host}.127.0.0.1.nip.io:${server.address().port}`;
    }
    fixture = await startStorageFixture({ authenticated: true, previewEntry: false, invite, script: 'dev', connectionOrigins: origins });
    return { ...fixture, origins, network, stop: async () => {
      for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
      await fixture.stop(); await rm(temporary, { recursive: true, force: true });
    } };
  } catch (error) {
    for (const server of servers) { server.closeAllConnections(); server.close(); }
    await fixture?.stop(); await rm(temporary, { recursive: true, force: true }); throw error;
  }
}
