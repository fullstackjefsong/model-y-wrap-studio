export const SIZE = 1024;
export const MAX_PNG_BYTES = 1_000_000;

export function freshProject() {
  return {
    version: 1, model: 'modely', name: 'My Wrap',
    base: '#192a45', accent: '#56d6cf', pattern: 'solid', spacing: 100,
    layers: []
  };
}

export function validateProject(project) {
  const fail = () => { throw new Error('Invalid project. Use an original Model Y Wrap Studio project file.'); };
  if (!project || project.version !== 1 || project.model !== 'modely') fail();
  if (typeof project.name !== 'string' || !/^[A-Za-z0-9 _-]{1,26}$/.test(project.name)) {
    throw new Error('Name must be 1-26 letters, numbers, spaces, underscores or dashes.');
  }
  if (![project.base, project.accent].every(color => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))) fail();
  if (!['solid', 'stripes', 'dots', 'gradient'].includes(project.pattern)) fail();
  if (!Number.isFinite(project.spacing) || project.spacing < 20 || project.spacing > 300) fail();
  if (!Array.isArray(project.layers) || project.layers.length > 20) fail();
  let artworkBytes = 0;
  for (const layer of project.layers) {
    if (!layer || !['image', 'text'].includes(layer.type)) fail();
    for (const key of ['x', 'y', 'width', 'rotation', 'opacity']) {
      if (!Number.isFinite(layer[key])) fail();
    }
    if (layer.x < -1024 || layer.x > 2048 || layer.y < -1024 || layer.y > 2048 ||
        layer.width < 10 || layer.width > 2048 || Math.abs(layer.rotation) > 360 ||
        layer.opacity < 0 || layer.opacity > 1) fail();
    if (layer.type === 'image') {
      if (typeof layer.src !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(layer.src) ||
          layer.src.length > 3_000_000) fail();
      artworkBytes += layer.src.length;
    } else if (typeof layer.text !== 'string' || layer.text.length > 100 ||
               !/^#[0-9a-f]{6}$/i.test(layer.color)) fail();
  }
  if (artworkBytes > 10_000_000) throw new Error('Project artwork exceeds 10 MB. Remove a layer or use smaller source images.');
  return project;
}
