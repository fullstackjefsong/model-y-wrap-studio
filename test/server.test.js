import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, validatePng, networkAddresses } from '../server.js';
import { freshProject, validateProject } from '../public/project.js';

test('project schema accepts reusable layers and rejects invalid inputs', () => {
  assert.equal(validateProject(freshProject()).model, 'modely');
  for (const change of [
    { name: '../bad' }, { name: 'x'.repeat(27) }, { base: 'red' }, { spacing: Infinity },
    { model: 'modely-2025' }, { layers: [{}] }, { layers: [{ type: 'image', src: 'https://example.com/image.png' }] }
  ]) assert.throws(() => validateProject({ ...freshProject(), ...change }));
  const layer = { type: 'image', src: `data:image/png;base64,${'A'.repeat(2_600_000)}`, x: 512, y: 512, width: 100, rotation: 0, opacity: 1 };
  assert.throws(() => validateProject({ ...freshProject(), layers: [layer, layer, layer, layer] }), /artwork exceeds 10 MB/);
});

test('QR addresses skip loopback and link-local adapters', t => {
  t.mock.method(os, 'networkInterfaces', () => ({
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    apipa: [{ address: '169.254.10.2', family: 'IPv4', internal: false }],
    wifi: [{ address: '192.168.1.20', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }]
  }));
  assert.deepEqual(networkAddresses(), ['192.168.1.20']);
});

test('PNG limits enforce actual sizes and dimensions', async () => {
  const bytes = await fs.readFile(new URL('../public/template.png', import.meta.url));
  assert.deepEqual(validatePng(bytes), { width: 1024, height: 1024 });
  assert.throws(() => validatePng(Buffer.from('not a PNG')), /must be a PNG/);
  assert.throws(() => validatePng(Buffer.alloc(1_000_001)), /1 MB/);
  const small = Buffer.from(bytes); small.writeUInt32BE(511, 16); small.writeUInt32BE(511, 20);
  assert.throws(() => validatePng(small), /between 512/);
  const rectangular = Buffer.from(bytes); rectangular.writeUInt32BE(512, 16);
  assert.throws(() => validatePng(rectangular), /square/);
  const boundary = Buffer.alloc(1_000_000); bytes.copy(boundary);
  assert.equal(validatePng(boundary).width, 1024);
});

test('persistent projects, PNG transfer, revocation and access boundaries', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wrap-studio-test-'));
  let server = await createServer({ dataDir, addresses: () => ['127.0.0.1'] });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(dataDir, { recursive: true }); });
  let base = `http://127.0.0.1:${server.address().port}`;
  let config = await (await fetch(`${base}/api/config`)).json();
  let headers = { 'X-Studio-Token': config.token, 'Content-Type': 'application/json' };
  const request = (route, options) => fetch(`${base}${route}`, options);
  assert.equal((await request('/api/projects')).status, 403);
  assert.equal((await request('/api/projects', { headers: { ...headers, Origin: 'http://evil.example' } })).status, 403);
  assert.equal((await request('/template.png')).status, 200);
  const logo = await request('/songlabslogo.png');
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('Content-Type'), 'image/png');
  assert.deepEqual(Buffer.from(await logo.arrayBuffer()), await fs.readFile(new URL('../public/songlabslogo.png', import.meta.url)));
  assert.equal((await request('/package.json')).status, 404);
  assert.equal((await request('/data/projects/private.json')).status, 404);
  assert.equal((await request('/.env')).status, 404);
  const project = freshProject();
  const saved = await (await request('/api/projects', { method: 'POST', headers, body: JSON.stringify({ project }) })).json();
  assert.match(saved.id, /^[a-f0-9]{32}$/);
  assert.deepEqual(await (await request(`/api/projects/${saved.id}`, { headers })).json(), project);
  project.name = 'Second Version';
  await request('/api/projects', { method: 'POST', headers, body: JSON.stringify({ id: saved.id, project }) });
  const list = await (await request('/api/projects', { headers })).json();
  assert.equal(list.length, 1); assert.equal(list[0].name, 'Second Version');
  assert.equal((await request('/api/projects', { method: 'POST', headers, body: JSON.stringify({ project, id: '../../bad' }) })).status, 400);
  const bytes = await fs.readFile(new URL('../public/template.png', import.meta.url));
  const transferResponse = await request('/api/transfers?name=Test_Wrap', { method: 'POST', headers, body: bytes });
  assert.equal(transferResponse.status, 201);
  const transfer = await transferResponse.json();
  assert.equal(transfer.width, 1024); assert.equal(transfer.bytes, bytes.length);
  assert.match(transfer.links[0].qr, /^data:image\/png;base64,/);
  const download = await request(`/share/${transfer.id}/download`);
  assert.equal(download.headers.get('Content-Disposition'), 'attachment; filename="Test_Wrap.png"');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  const sharePage = await request(`/share/${transfer.id}`);
  assert.equal(sharePage.status, 200);
  const shareHtml = await sharePage.text();
  for (const text of ['Android:', 'Downloads', 'iPhone:', '/songlabslogo.png']) assert.ok(shareHtml.includes(text));
  assert.equal((await request('/api/transfers?name=bad%2Fname', { method: 'POST', headers, body: bytes })).status, 400);
  assert.equal((await request('/api/transfers?name=Test', { method: 'POST', headers, body: 'invalid' })).status, 400);
  await request(`/api/transfers/${transfer.id}`, { method: 'DELETE', headers });
  assert.equal((await request(`/share/${transfer.id}/download`)).status, 410);
  const expiring = await (await request('/api/transfers?name=Expiry', { method: 'POST', headers, body: bytes })).json();
  const realNow = Date.now;
  t.mock.method(Date, 'now', () => realNow() + 3_600_001);
  assert.equal((await request(`/share/${expiring.id}/download`)).status, 410);
  Date.now.mock.restore();
  assert.ok(!(await fs.readdir(path.join(dataDir, 'transfers'))).includes(`${expiring.id}.png`));
  const second = await (await request('/api/transfers?name=Restart', { method: 'POST', headers, body: bytes })).json();
  await new Promise(resolve => server.close(resolve));
  server = await createServer({ dataDir, addresses: () => ['127.0.0.1'] });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  config = await (await request('/api/config')).json();
  headers = { ...headers, 'X-Studio-Token': config.token };
  assert.equal((await request(`/share/${second.id}`)).status, 410);
  assert.equal((await (await request(`/api/projects/${saved.id}`, { headers })).json()).name, 'Second Version');
  assert.deepEqual(await fs.readdir(path.join(dataDir, 'transfers')), []);
});
