// Dev tool: cuts 3nbr out of each AI pose image (assets/poses/ai/src) and saves the
// cutouts to assets/poses/ai/cut, plus cuts.json with where each crop sits in its source.
import { analyzePhoto, composeSprite } from '../studio/analyze.js';
import { openAlpha, dropScraps } from '../shared/mask.js';
import { LOVEBIRD_POSES } from '../shared/lovebirdPoses.js';

// In source pixels. extra: boxes cut out on their own and added (props the model drops
// when it sees the whole picture; 'solid' fills the shape so a patchy prop is opaque);
// key: [x0, y0, x1, y1, from, to, 'solid'?] boxes where anything unlike the plain
// background is kept, from/to being the colour-distance ramp (default 35-60); erase: boxes
// cleared (stray AI artefacts); fade: [from, to] ramps that soften props running off the
// picture (x0/y0 fade in, x1/y1 fade out); scraps: detached pieces smaller than this share
// of the largest are dropped.
const CUT = {
  look: { extra: [[0, 560, 1200, 840]], key: [[880, 580, 1200, 800]], fade: { x0: [250, 380], x1: [990, 1110] }, scraps: 0.02 },
  disco: { erase: [[712, 734, 905, 785]] },
  stretch: { key: [[150, 270, 470, 580, 14, 34, 'solid'], [650, 270, 1150, 640, 14, 34, 'solid']] },
  keyboard: { extra: [[0, 400, 1200, 896, 'solid']] },
  pats: { fade: { y0: [0, 90] } },
  pecks: { fade: { x0: [0, 110] } },
};

const ramp = (v, a, b) => Math.min(1, Math.max(0, (v - a) / (b - a)));

// Everything the background cannot reach from the border becomes fully opaque.
function fillSolid(a, w, h) {
  const out = new Uint8Array(w * h);
  const stack = [];
  const visit = (i) => { if (!out[i] && a[i] < 16) { out[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { visit(x); visit((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { visit(y * w); visit(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i < w * (h - 1)) visit(i + w);
  }
  for (let i = 0; i < a.length; i++) if (!out[i] && a[i] >= 16) a[i] = Math.max(a[i], Math.min(255, a[i] * 6));
  for (let i = 0; i < a.length; i++) if (!out[i] && a[i] < 16) a[i] = 255;
}

async function refine(raw, photo, cut, conf) {
  const W = photo.width;
  for (const [x0, y0, x1, y1, solid] of conf.extra || []) {
    const c = document.createElement('canvas');
    c.width = x1 - x0;
    c.height = y1 - y0;
    c.getContext('2d').drawImage(photo, -x0, -y0);
    const a = await cut(c);
    if (solid) fillSolid(a, c.width, c.height);
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y + y0) * W + x + x0;
      raw[i] = Math.max(raw[i], a[y * c.width + x]);
    }
  }
  for (const [x0, y0, x1, y1, lo = 35, hi = 60, solid] of conf.key || []) {
    const w = x1 - x0, h = y1 - y0;
    const d = photo.getContext('2d', { willReadFrequently: true }).getImageData(x0, y0, w, h).data;
    const border = [];
    for (let x = 0; x < w; x += 3) border.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y += 3) border.push(y * w, y * w + w - 1);
    const med = (arr) => arr.slice().sort((p, q) => p - q)[arr.length >> 1];
    const bg = [0, 1, 2].map((ch) => med(border.map((i) => d[i * 4 + ch])));
    const a = new Uint8Array(w * h);
    for (let i = 0; i < a.length; i++) {
      const dist = Math.hypot(d[i * 4] - bg[0], d[i * 4 + 1] - bg[1], d[i * 4 + 2] - bg[2]);
      a[i] = Math.round(255 * ramp(dist, lo, hi));
    }
    if (solid) fillSolid(a, w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const j = (y + y0) * W + x + x0;
      raw[j] = Math.max(raw[j], a[y * w + x]);
    }
  }
  for (const [x0, y0, x1, y1] of conf.erase || []) {
    for (let y = y0; y < y1; y++) raw.fill(0, y * W + x0, y * W + x1);
  }
  return raw;
}

// Fades props off softly, then trims the cutout to what is still visible.
function fadeAndTrim(canvas, crop, f) {
  const { x0: ox, y0: oy, s } = crop;
  const w = canvas.width, h = canvas.height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const im = g.getImageData(0, 0, w, h);
  const d = im.data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = ox + x / s, sy = oy + y / s;
    let k = 1;
    if (f.x0) k *= ramp(sx, f.x0[0], f.x0[1]);
    if (f.x1) k *= 1 - ramp(sx, f.x1[0], f.x1[1]);
    if (f.y0) k *= ramp(sy, f.y0[0], f.y0[1]);
    if (f.y1) k *= 1 - ramp(sy, f.y1[0], f.y1[1]);
    const i = (y * w + x) * 4;
    d[i + 3] = Math.round(d[i + 3] * k * k * (3 - 2 * k));
    if (d[i + 3] > 8) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  }
  g.putImageData(im, 0, 0);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 3;
  out.height = maxY - minY + 3;
  out.getContext('2d').drawImage(canvas, 1 - minX, 1 - minY);
  return { canvas: out, crop: { x0: ox + (minX - 1) / s, y0: oy + (minY - 1) / s, s } };
}

async function main() {
  const params = new URLSearchParams(location.search);
  let ids = LOVEBIRD_POSES.map((p) => p.id);
  if (params.get('only')) ids = params.get('only').split('|');
  let info = {};
  try { info = await (await fetch('../../assets/poses/ai/cut/cuts.json')).json(); } catch { /* first run */ }
  for (const id of ids) {
    const blob = await (await fetch(`../../assets/poses/ai/src/${id}.png`)).blob();
    const conf = CUT[id];
    const res = await analyzePhoto(blob, () => {}, conf ? { refine: (raw, photo, cut) => refine(raw, photo, cut, conf) } : {});
    openAlpha(res.alpha, res.w, res.h);
    let canvas = dropScraps(composeSprite(res.rgbData, res.alpha, res.w, res.h), conf?.scraps ?? 0.08);
    let crop = res.crop;
    if (conf?.fade) ({ canvas, crop } = fadeAndTrim(canvas, crop, conf.fade));
    console.log(`[aicut] ${id} ${res.method} ${canvas.width}x${canvas.height}`);
    info[id] = { w: canvas.width, h: canvas.height, ...crop };
    const out = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    await window.companion.devSave(`assets/poses/ai/cut/${id}.png`, new Uint8Array(await out.arrayBuffer()));
  }
  await window.companion.devSave('assets/poses/ai/cut/cuts.json', new TextEncoder().encode(JSON.stringify(info, null, 1)));
  document.title = 'ready';
}

main().catch((e) => { console.error(e?.stack || e); document.title = 'ready'; });
