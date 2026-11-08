import { freshProject, validateProject, SIZE, MAX_PNG_BYTES } from './project.js';

const $ = id => document.getElementById(id);
const canvas = $('preview'), ctx = canvas.getContext('2d');
const artwork = document.createElement('canvas');
artwork.width = artwork.height = SIZE;
const art = artwork.getContext('2d');
const mask = document.createElement('canvas');
mask.width = mask.height = SIZE;
const maskCtx = mask.getContext('2d', { willReadFrequently: true });
const imageCache = new Map();
let project = freshProject(), projectId = null, selected = -1, dirty = false;
let config, template, ready = false, activeTransfer = null, exportBlob = null;
let history = [], future = [], drag = null;

function status(message, error = false) {
  $('status').textContent = message;
  $('status').className = error ? 'error' : '';
}

function action(id, callback) {
  $(id).addEventListener('click', async () => {
    const button = $(id);
    button.disabled = true;
    try { await callback(); }
    catch (error) { status(error.message, true); }
    finally { button.disabled = false; syncHistory(); }
  });
}

async function api(route, options = {}) {
  const response = await fetch(route, { ...options, headers: { 'X-Studio-Token': config.token, ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Cannot read image. Choose a valid PNG, JPEG or WebP image.'));
    image.src = src;
  });
}

async function prepareImages(next) {
  for (const layer of next.layers) {
    if (layer.type === 'image' && !imageCache.has(layer.src)) imageCache.set(layer.src, await loadImage(layer.src));
  }
}

function remember() {
  history.push(structuredClone(project));
  if (history.length > 20) history.shift();
  future = [];
  dirty = true;
  syncHistory();
}

function syncHistory() {
  $('undo').disabled = !ready || history.length === 0;
  $('redo').disabled = !ready || future.length === 0;
}

function render() {
  if (!ready) return;
  art.globalAlpha = 1;
  art.globalCompositeOperation = 'source-over';
  art.clearRect(0, 0, SIZE, SIZE);
  art.fillStyle = project.base;
  art.fillRect(0, 0, SIZE, SIZE);
  art.fillStyle = project.accent;
  const step = project.spacing;
  if (project.pattern === 'stripes') {
    for (let x = -SIZE; x < SIZE * 2; x += step) {
      art.beginPath(); art.moveTo(x, 0); art.lineTo(x + step / 2, 0);
      art.lineTo(x + step / 2 - SIZE, SIZE); art.lineTo(x - SIZE, SIZE); art.fill();
    }
  } else if (project.pattern === 'dots') {
    for (let y = step / 2; y < SIZE; y += step) {
      for (let x = step / 2; x < SIZE; x += step) {
        art.beginPath(); art.arc(x, y, step / 5, 0, Math.PI * 2); art.fill();
      }
    }
  } else if (project.pattern === 'gradient') {
    const gradient = art.createLinearGradient(0, 0, SIZE, SIZE);
    gradient.addColorStop(0, project.base); gradient.addColorStop(1, project.accent);
    art.fillStyle = gradient; art.fillRect(0, 0, SIZE, SIZE);
  }
  for (const layer of project.layers) {
    art.save();
    art.translate(layer.x, layer.y); art.rotate(layer.rotation * Math.PI / 180);
    art.globalAlpha = layer.opacity;
    if (layer.type === 'image') {
      const image = imageCache.get(layer.src);
      if (image) {
        const height = layer.width * image.height / image.width;
        art.drawImage(image, -layer.width / 2, -height / 2, layer.width, height);
      }
    } else {
      art.fillStyle = layer.color; art.font = `bold ${layer.width}px Arial, sans-serif`;
      art.textAlign = 'center'; art.textBaseline = 'middle'; art.fillText(layer.text, 0, 0);
    }
    art.restore();
  }
  art.globalCompositeOperation = 'destination-in';
  art.drawImage(mask, 0, 0);
  art.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(artwork, 0, 0);
  if ($('guides').checked) {
    ctx.save(); ctx.globalAlpha = 0.15; ctx.drawImage(template, 0, 0, SIZE, SIZE); ctx.restore();
  }
  const layer = project.layers[selected];
  if (layer) {
    ctx.save(); ctx.strokeStyle = '#ffda73'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(layer.x, layer.y, 13, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

function syncLayer() {
  const layer = project.layers[selected];
  $('layer-controls').disabled = !layer;
  $('text-label').hidden = $('color-label').hidden = !layer || layer.type !== 'text';
  if (!layer) return;
  for (const key of ['x', 'y', 'width', 'rotation', 'opacity']) $(`layer-${key}`).value = layer[key];
  if (layer.type === 'text') { $('layer-text').value = layer.text; $('layer-color').value = layer.color; }
}

function syncForm() {
  if (activeTransfer) $('export-stale').hidden = false;
  for (const key of ['name', 'base', 'accent', 'pattern', 'spacing']) $(key).value = project[key];
  $('layers').replaceChildren();
  if (!project.layers.length) $('layers').append(new Option('No layers yet', ''));
  project.layers.forEach((layer, index) => {
    $('layers').append(new Option(`${index + 1}. ${layer.type === 'text' ? layer.text || 'Text' : 'Image'}`, String(index)));
  });
  $('layers').value = selected >= 0 ? String(selected) : '';
  syncLayer(); syncHistory(); render();
}

function changed(message = 'Design changed. Save your project to keep editing it later.') {
  if (activeTransfer) $('export-stale').hidden = false;
  render(); status(message);
}

for (const key of ['name', 'base', 'accent', 'pattern', 'spacing']) {
  $(key).addEventListener('change', () => {
    remember();
    project[key] = key === 'spacing' ? Number($(key).value) : $(key).value;
    changed();
  });
}
$('guides').addEventListener('change', render);
$('layers').addEventListener('change', () => { selected = Number($('layers').value); syncLayer(); render(); });
for (const key of ['x', 'y', 'width', 'rotation', 'opacity', 'text', 'color']) {
  $(`layer-${key}`).addEventListener('change', () => {
    const layer = project.layers[selected];
    if (!layer) return;
    const value = ['text', 'color'].includes(key) ? $(`layer-${key}`).value : Number($(`layer-${key}`).value);
    const candidate = structuredClone(project);
    candidate.layers[selected][key] = value;
    try { validateProject(candidate); }
    catch (error) { status(error.message, true); syncLayer(); return; }
    remember(); project = candidate; syncForm(); changed();
  });
}

function point(event) {
  const bounds = canvas.getBoundingClientRect();
  return { x: (event.clientX - bounds.left) * SIZE / bounds.width, y: (event.clientY - bounds.top) * SIZE / bounds.height };
}
canvas.addEventListener('pointerdown', event => {
  const layer = project.layers[selected];
  if (!ready || !layer) return;
  const p = point(event);
  drag = { x: p.x - layer.x, y: p.y - layer.y, before: structuredClone(project), moved: false };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (!drag) return;
  const p = point(event), layer = project.layers[selected];
  layer.x = Math.round(Math.max(-1024, Math.min(2048, p.x - drag.x)));
  layer.y = Math.round(Math.max(-1024, Math.min(2048, p.y - drag.y)));
  drag.moved = true; syncLayer(); render();
});
function endDrag() {
  if (drag?.moved) {
    history.push(drag.before);
    if (history.length > 20) history.shift();
    future = []; dirty = true; syncHistory(); changed();
  }
  drag = null;
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('lostpointercapture', endDrag);

function addLayer(layer) {
  if (project.layers.length >= 20) throw new Error('Maximum 20 layers per project.');
  validateProject({ ...project, layers: [...project.layers, layer] });
  remember(); project.layers.push(layer); selected = project.layers.length - 1; syncForm(); changed();
}
action('add-text', () => addLayer({ type: 'text', text: 'MODEL Y', color: '#ffffff', x: 512, y: 270, width: 50, rotation: 0, opacity: 1 }));
action('add-image', () => { $('image-file').value = ''; $('image-file').click(); });
$('image-file').addEventListener('change', async () => {
  const file = $('image-file').files[0];
  if (!file) return;
  try {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose PNG, JPEG or WebP artwork.');
    if (file.size > 10_000_000) throw new Error('Artwork must be under 10 MB.');
    const url = URL.createObjectURL(file);
    let image;
    try { image = await loadImage(url); }
    finally { URL.revokeObjectURL(url); }
    const reduced = document.createElement('canvas');
    const scale = Math.min(1, SIZE / Math.max(image.width, image.height));
    reduced.width = Math.max(1, Math.round(image.width * scale));
    reduced.height = Math.max(1, Math.round(image.height * scale));
    reduced.getContext('2d').drawImage(image, 0, 0, reduced.width, reduced.height);
    const src = reduced.toDataURL('image/png');
    if (src.length > 3_000_000) throw new Error('Artwork is too complex. Use a smaller or simpler image.');
    imageCache.set(src, await loadImage(src));
    addLayer({ type: 'image', src, x: 512, y: 270, width: 250, rotation: 0, opacity: 1 });
  } catch (error) { status(error.message, true); }
});
action('duplicate-layer', () => {
  const layer = structuredClone(project.layers[selected]);
  layer.x = Math.min(2048, layer.x + 30); layer.y = Math.min(2048, layer.y + 30); addLayer(layer);
});
action('remove-layer', () => {
  remember(); project.layers.splice(selected, 1); selected = project.layers.length - 1; syncForm(); changed();
});
action('undo', () => {
  future.push(structuredClone(project)); project = history.pop(); selected = -1; dirty = true; syncForm(); changed();
});
action('redo', () => {
  history.push(structuredClone(project)); project = future.pop(); selected = -1; dirty = true; syncForm(); changed();
});

function allowReplace() { return !dirty || confirm('You have unsaved changes. Discard them? Save or back up first to keep them.'); }
action('reset', () => {
  if (!allowReplace()) return;
  project = freshProject(); projectId = null; history = []; future = []; selected = -1; dirty = false;
  syncForm(); status('New design ready.');
});
async function refreshLibrary() {
  const projects = await api('/api/projects');
  $('saved').replaceChildren(new Option('Choose a project', ''));
  for (const item of projects) $('saved').append(new Option(`${item.name} - ${new Date(item.updated).toLocaleDateString()}`, item.id));
  $('saved').value = projectId || '';
  $('load').disabled = !$('saved').value;
}
$('saved').addEventListener('change', () => { $('load').disabled = !$('saved').value; });
action('save', async () => {
  validateProject(project);
  const snapshot = JSON.stringify(project);
  const result = await api('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: projectId, project: JSON.parse(snapshot) }) });
  projectId = result.id; dirty = snapshot !== JSON.stringify(project);
  await refreshLibrary();
  status(dirty ? 'Project snapshot saved. You made more changes while saving; save again to keep them.' : 'Project saved on this computer. Backup JSON for a portable copy.');
});
action('load', async () => {
  if (!allowReplace()) return;
  const id = $('saved').value;
  const next = validateProject(await api(`/api/projects/${id}`));
  await prepareImages(next);
  project = next; projectId = id; selected = -1; dirty = false; history = []; future = [];
  syncForm(); status('Saved project opened.');
});

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
action('backup', () => {
  validateProject(project);
  downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), `${project.name}.json`);
  status('Portable project backup downloaded. Images are included.');
});
action('import', () => { $('project-file').value = ''; $('project-file').click(); });
$('project-file').addEventListener('change', async () => {
  const file = $('project-file').files[0];
  if (!file || !allowReplace()) return;
  try {
    if (file.size > 12_000_000) throw new Error('Project file exceeds 12 MB.');
    const next = validateProject(JSON.parse(await file.text()));
    await prepareImages(next);
    project = next; projectId = null; selected = -1; dirty = true; history = []; future = [];
    syncForm(); status('Project imported. Save to add it to your local library.');
  } catch (error) { status(`Import failed: ${error.message}`, true); }
});

async function createPng() {
  validateProject(project);
  render();
  const output = document.createElement('canvas');
  output.width = output.height = Number($('resolution').value);
  const out = output.getContext('2d');
  out.fillStyle = '#000'; out.fillRect(0, 0, output.width, output.height);
  out.drawImage(artwork, 0, 0, output.width, output.height);
  const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Browser could not encode the PNG.');
  if (blob.size > MAX_PNG_BYTES) throw new Error(`PNG is ${(blob.size / 1_000_000).toFixed(2)} MB. Tesla allows at most 1 MB. Select 512 x 512 or simplify the artwork and export again.`);
  return blob;
}

function showLink() {
  const link = activeTransfer?.links[Number($('network').value)];
  $('qr').hidden = $('phone-link').hidden = !link;
  $('copy-link').disabled = !link;
  if (link) { $('qr').src = link.qr; $('phone-link').href = link.url; $('phone-link').textContent = link.url; }
}
$('network').addEventListener('change', showLink);
action('export', async () => {
  const name = project.name;
  const blob = await createPng();
  const transfer = await api(`/api/transfers?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob });
  activeTransfer = { ...transfer, name }; exportBlob = blob;
  $('transfer').hidden = false;
  $('export-stale').hidden = true;
  $('download').href = `/share/${transfer.id}/download`; $('download').download = `${name}.png`;
  $('export-info').textContent = `${name}.png / ${transfer.width} x ${transfer.height} / ${(transfer.bytes / 1000).toFixed(0)} KB / expires ${new Date(transfer.expires).toLocaleTimeString()}`;
  $('network').replaceChildren();
  transfer.links.forEach((link, index) => $('network').append(new Option(link.address, String(index))));
  showLink();
  status(transfer.links.length ? 'Export ready. Scan the QR with your phone, save the PNG, then upload in Tesla Creations.' : 'PNG ready to download or email. No LAN address found; connect your computer to Wi-Fi to enable QR transfer.');
});
action('copy-link', async () => {
  const link = activeTransfer.links[Number($('network').value)].url;
  if (!navigator.clipboard) throw new Error('Clipboard unavailable. Select and copy the displayed link manually.');
  await navigator.clipboard.writeText(link); status('Local phone link copied. It only works on the same network.');
});
action('email', async () => {
  if (!activeTransfer || !exportBlob) throw new Error('Export a PNG first.');
  const file = new File([exportBlob], `${activeTransfer.name}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'My Model Y wrap' });
      status('PNG shared.');
    } catch (error) {
      if (error.name === 'AbortError') status('Sharing cancelled.');
      else throw error;
    }
  } else {
    downloadBlob(exportBlob, file.name);
    const subject = encodeURIComponent(`Model Y wrap: ${activeTransfer.name}`);
    const body = encodeURIComponent(`Attach the downloaded ${file.name} to this email before sending.\n\nOn your phone: save the attachment, then open Tesla > Creations > Wrap > Upload.`);
    const link = document.createElement('a'); link.href = `mailto:?subject=${subject}&body=${body}`; link.click();
    status('PNG downloaded and email composer requested. Attach the downloaded PNG yourself; browsers cannot auto-attach files to mailto.');
  }
});
action('revoke', async () => {
  if (!activeTransfer) return;
  await api(`/api/transfers/${activeTransfer.id}`, { method: 'DELETE' });
  activeTransfer = null; exportBlob = null; $('transfer').hidden = true; status('Phone link revoked.');
});
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });

async function init() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('Cannot connect to Wrap Studio. Open the editor on localhost.');
    config = await response.json();
    template = await loadImage('/template.png');
    maskCtx.drawImage(template, 0, 0, SIZE, SIZE);
    const pixels = maskCtx.getImageData(0, 0, SIZE, SIZE);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const alpha = Math.round((pixels.data[i] + pixels.data[i + 1] + pixels.data[i + 2]) / 3);
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
      pixels.data[i + 3] = alpha;
    }
    maskCtx.putImageData(pixels, 0, 0);
    await refreshLibrary();
    ready = true;
    for (const id of ['save', 'backup', 'export', 'add-image', 'add-text']) $(id).disabled = false;
    syncForm(); status('Ready. Start with a color and pattern, then add artwork. Save your project before leaving.');
  } catch (error) { status(`Startup failed: ${error.message}. Check the server terminal, then reload.`, true); }
}
init();
