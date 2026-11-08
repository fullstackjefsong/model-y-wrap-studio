import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { validateProject, MAX_PNG_BYTES } from './public/project.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 12_000_000;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

function reply(res, status, body, type = 'application/json', extra = {}) {
  res.writeHead(status, {
    'Content-Type': `${type}${type.startsWith('text/') ? '; charset=utf-8' : ''}`,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', ...extra
  });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

async function readBody(req) {
  const parts = [];
  let length = 0;
  for await (const part of req) {
    length += part.length;
    if (length > MAX_BODY) throw Object.assign(new Error('Upload is too large (12 MB maximum).'), { status: 413 });
    parts.push(part);
  }
  return Buffer.concat(parts);
}

function inputError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function parseJson(bytes) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw inputError('Invalid JSON.'); }
}

export function validatePng(bytes) {
  if (bytes.length > MAX_PNG_BYTES) throw inputError('PNG exceeds Tesla\'s 1 MB limit. Simplify the design or export at 512 pixels.');
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.toString('ascii', 12, 16) !== 'IHDR') throw inputError('Upload must be a PNG.');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (width !== height || width < 512 || width > 1024) throw inputError('PNG must be square, between 512 and 1024 pixels.');
  return { width, height };
}

export function networkAddresses() {
  return [...new Set(Object.values(os.networkInterfaces()).flat()
    .filter(item => item && !item.internal && (item.family === 'IPv4' || item.family === 4) && !item.address.startsWith('169.254.'))
    .map(item => item.address))];
}

export async function createServer({ dataDir = path.join(ROOT, 'data'), addresses = networkAddresses } = {}) {
  const projectsDir = path.join(dataDir, 'projects');
  const transfersDir = path.join(dataDir, 'transfers');
  await fs.mkdir(projectsDir, { recursive: true });
  await fs.mkdir(transfersDir, { recursive: true });
  // Transfer links are session-scoped; stale files are removed when the app restarts.
  for (const name of await fs.readdir(transfersDir)) {
    if (/^[a-f0-9]{32}\.png$/.test(name)) await fs.unlink(path.join(transfersDir, name));
  }
  const sessionToken = randomBytes(24).toString('hex');
  const transfers = new Map();
  const expiryMs = 60 * 60 * 1000;
  let port;

  async function removeExpired() {
    for (const [id, transfer] of transfers) {
      if (transfer.expires <= Date.now()) {
        await fs.unlink(path.join(transfersDir, `${id}.png`));
        transfers.delete(id);
      }
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
      const allowedHosts = ['localhost', '127.0.0.1', '[::1]', ...addresses()];
      if (!allowedHosts.includes((req.headers.host || '').replace(/:\d+$/, ''))) {
        return reply(res, 403, { error: 'Unrecognized host.' });
      }
      if (url.pathname.startsWith('/api/')) {
        if (!local) return reply(res, 403, { error: 'Editing is available only on the host computer.' });
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
          return reply(res, 403, { error: 'Cross-origin requests are not allowed.' });
        }
        if (url.pathname !== '/api/config' && req.headers['x-studio-token'] !== sessionToken) {
          return reply(res, 403, { error: 'Reload the editor to reconnect to the server.' });
        }
        if (req.method === 'GET' && url.pathname === '/api/config') {
          return reply(res, 200, { token: sessionToken, addresses: addresses(), port });
        }
        if (req.method === 'GET' && url.pathname === '/api/projects') {
          const projects = [];
          for (const file of await fs.readdir(projectsDir)) {
            if (!/^[a-f0-9]{32}\.json$/.test(file)) continue;
            const project = JSON.parse(await fs.readFile(path.join(projectsDir, file), 'utf8'));
            validateProject(project);
            const stat = await fs.stat(path.join(projectsDir, file));
            projects.push({ id: file.slice(0, -5), name: project.name, updated: stat.mtime.toISOString() });
          }
          return reply(res, 200, projects.sort((a, b) => b.updated.localeCompare(a.updated)));
        }
        const projectMatch = url.pathname.match(/^\/api\/projects\/([a-f0-9]{32})$/);
        if (req.method === 'GET' && projectMatch) {
          const project = JSON.parse(await fs.readFile(path.join(projectsDir, `${projectMatch[1]}.json`), 'utf8'));
          validateProject(project);
          return reply(res, 200, project);
        }
        if (req.method === 'POST' && url.pathname === '/api/projects') {
          const { id, project } = parseJson(await readBody(req));
          try { validateProject(project); }
          catch (error) { throw inputError(error.message); }
          if (id !== null && id !== undefined && !/^[a-f0-9]{32}$/.test(id)) throw inputError('Invalid project ID.');
          const savedId = id || randomBytes(16).toString('hex');
          const filename = path.join(projectsDir, `${savedId}.json`);
          const temp = `${filename}.${randomBytes(6).toString('hex')}.tmp`;
          await fs.writeFile(temp, JSON.stringify(project, null, 2));
          await fs.rename(temp, filename);
          return reply(res, 200, { id: savedId });
        }
        if (req.method === 'POST' && url.pathname === '/api/transfers') {
          await removeExpired();
          if (transfers.size >= 30) throw inputError('30 active exports reached. Revoke an old link or wait for expiry.');
          const name = url.searchParams.get('name') || '';
          if (!/^[A-Za-z0-9 _-]{1,26}$/.test(name)) throw inputError('Invalid export name.');
          const bytes = await readBody(req);
          const dimensions = validatePng(bytes);
          const id = randomBytes(16).toString('hex');
          const expires = Date.now() + expiryMs;
          const links = await Promise.all(addresses().map(async address => {
            const link = `http://${address}:${port}/share/${id}`;
            return { address, url: link, qr: await QRCode.toDataURL(link, { width: 240, margin: 2 }) };
          }));
          await fs.writeFile(path.join(transfersDir, `${id}.png`), bytes);
          transfers.set(id, { name, expires });
          return reply(res, 201, { id, expires, bytes: bytes.length, ...dimensions, links });
        }
        const transferMatch = url.pathname.match(/^\/api\/transfers\/([a-f0-9]{32})$/);
        if (req.method === 'DELETE' && transferMatch) {
          const id = transferMatch[1];
          if (transfers.has(id)) {
            await fs.unlink(path.join(transfersDir, `${id}.png`));
            transfers.delete(id);
          }
          return reply(res, 200, { revoked: true });
        }
        return reply(res, 404, { error: 'Unknown endpoint.' });
      }

      const shareMatch = url.pathname.match(/^\/share\/([a-f0-9]{32})(\/download)?$/);
      if (req.method === 'GET' && shareMatch) {
        await removeExpired();
        const [ , id, download ] = shareMatch;
        const transfer = transfers.get(id);
        if (!transfer) return reply(res, 410, 'This wrap link has expired or was revoked. Create a new export on your computer.', 'text/plain');
        if (download) {
          return reply(res, 200, await fs.readFile(path.join(transfersDir, `${id}.png`)), 'image/png',
            { 'Content-Disposition': `attachment; filename="${transfer.name}.png"` });
        }
        return reply(res, 200, await fs.readFile(path.join(ROOT, 'public', 'share.html')), 'text/html',
          { 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'" });
      }
      if (!local && !['/style.css', '/share.js', '/songlabslogo.png'].includes(url.pathname)) {
        return reply(res, 403, 'Only exported wrap links are available over the network.', 'text/plain');
      }
      const publicFiles = new Set(['/index.html', '/style.css', '/app.js', '/project.js', '/share.js', '/template.png', '/songlabslogo.png']);
      const route = url.pathname === '/' ? '/index.html' : url.pathname;
      if (req.method !== 'GET' || !publicFiles.has(route)) return reply(res, 404, 'Not found.', 'text/plain');
      return reply(res, 200, await fs.readFile(path.join(ROOT, 'public', route.slice(1))), MIME[path.extname(route)],
        { 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'" });
    } catch (error) {
      const status = error.status || (error.code === 'ENOENT' ? 404 : 500);
      if (status === 500) console.error('Wrap Studio request failed:', error);
      if (!res.headersSent) reply(res, status, { error: status === 500 ? 'Server error. Check the terminal for details.' : error.message });
      else res.destroy();
    }
  });
  server.on('listening', () => { port = server.address().port; });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const server = await createServer();
  server.on('error', error => { console.error('Cannot start Wrap Studio:', error.message); process.exitCode = 1; });
  server.listen(port, '0.0.0.0', () => {
    console.log(`Wrap Studio: http://localhost:${port}`);
    console.log('Phone downloads use your local network. Editing is restricted to this computer.');
  });
}
