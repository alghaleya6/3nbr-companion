// Renders the final animation (one sprite sheet per action) and zips it, with a
// manifest, into a .companion package the Windows client can import.
import { zipSync, strToU8 } from 'fflate';
import { SYSTEM_ACTIONS, POSES, FPS } from '../shared/actions.js';

const RENDER_H = 300;
const MAX_FRAME_W = 760;

const toBlob = (canvas, type, quality) => new Promise((r) => canvas.toBlob(r, type, quality));
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export async function buildPackage({ renderer, rig, sprite, actions, name, uid, personality, coat }, onProgress) {
  // Frame layout: the pet's ground point sits near the bottom centre, with headroom
  // above for hops, perked ears and stretches.
  let scale = RENDER_H / rig.h;
  let fw = Math.ceil(rig.w * scale * 1.3 + rig.h * scale * 0.4);
  if (fw > MAX_FRAME_W) {
    scale *= MAX_FRAME_W / fw;
    fw = MAX_FRAME_W;
  }
  const spriteH = rig.h * scale;
  const fh = Math.ceil(spriteH * 1.46);
  const anchorX = Math.round(fw / 2);
  const anchorY = Math.round(fh - spriteH * 0.06);

  const list = [...actions, ...SYSTEM_ACTIONS];
  const files = {};
  const entries = [];
  const previews = {};
  let totalFrames = 0;

  for (let ai = 0; ai < list.length; ai++) {
    const a = list[ai];
    onProgress?.(`Rendering “${a.name}”…`, ai / (list.length + 1));
    await nextFrame();
    const frames = Math.max(8, Math.round(a.dur * FPS));
    const cols = Math.min(frames, 8);
    const rows = Math.ceil(frames / cols);
    const sheet = document.createElement('canvas');
    sheet.width = cols * fw;
    sheet.height = rows * fh;
    const sctx = sheet.getContext('2d');
    for (let i = 0; i < frames; i++) {
      renderer.render(POSES[a.id](i / frames, rig), { width: fw, height: fh, scale, anchorX, anchorY });
      sctx.drawImage(renderer.canvas, (i % cols) * fw, Math.floor(i / cols) * fh);
    }
    const blob = await toBlob(sheet, 'image/webp', 0.9);
    files[`sheets/${a.id}.webp`] = [await bytesOf(blob), { level: 0 }];
    previews[a.id] = URL.createObjectURL(blob);
    totalFrames += frames;
    entries.push({
      id: a.id,
      name: a.name,
      sheet: `sheets/${a.id}.webp`,
      frames,
      cols,
      dur: frames / FPS,
      kind: a.kind,
      loops: a.loops || 1,
      speed: a.speed || 0,
      lift: a.lift || null,
      effect: a.effect || null,
      system: !!a.system,
    });
  }

  onProgress?.('Packing your companion…', list.length / (list.length + 1));
  await nextFrame();

  // Thumbnail: the resting pose, cropped square.
  renderer.render(POSES.rest(0, rig), { width: fw, height: fh, scale, anchorX, anchorY });
  const side = Math.max(rig.w, rig.h) * scale * 1.08;
  const thumb = document.createElement('canvas');
  thumb.width = thumb.height = 256;
  thumb.getContext('2d').drawImage(
    renderer.canvas,
    anchorX - side / 2, anchorY - spriteH / 2 - side / 2, side, side,
    0, 0, 256, 256,
  );
  files['thumb.png'] = [await bytesOf(await toBlob(thumb, 'image/png')), { level: 0 }];
  files['sprite.png'] = [await bytesOf(await toBlob(sprite, 'image/png')), { level: 0 }];

  const manifest = {
    format: 'companion/1',
    uid,
    name,
    personality,
    createdAt: new Date().toISOString(),
    generator: 'Companion Studio 1.0',
    facing: rig.facing,
    style: rig.style,
    coat,
    fps: FPS,
    frame: { w: fw, h: fh, anchorX, anchorY, spriteH },
    display: { size: 150 },
    actions: entries,
    rig,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));

  const bytes = zipSync(files);
  return { bytes, manifest, previews, totalFrames, thumbUrl: thumb.toDataURL('image/png') };
}
