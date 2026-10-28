// Photo -> cut-out sprite + rig + coat palette + photo checks.
import { removeBackground } from '@imgly/background-removal';
import { detectParts } from './detect.js';

const MAX_SIDE = 1280;
const SPRITE_MAX = 900;

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export async function loadPhoto(blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = canvasOf(Math.round(bmp.width * s), Math.round(bmp.height * s));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

async function aiAlpha(photo, onStatus) {
  const blob = await new Promise((r) => photo.toBlob(r, 'image/png'));
  const out = await removeBackground(blob, {
    publicPath: 'companion-res://imgly/',
    model: 'isnet_fp16',
    output: { format: 'image/png' },
    progress: (key, cur, total) => {
      if (key.startsWith('fetch:/models')) {
        onStatus(`Downloading the cutout model (first time only) — ${Math.round(cur / 1e6)} of ${Math.round(total / 1e6)} MB`, total ? cur / total : null);
      } else if (key.startsWith('compute')) {
        onStatus('Cutting your pet out of the background…', null);
      }
    },
  });
  const bmp = await createImageBitmap(out);
  const c = canvasOf(photo.width, photo.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const a = new Uint8Array(c.width * c.height);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  return a;
}

// Offline fallback: flood-fill the background from the photo border by colour.
function colorKeyAlpha(photo) {
  const W = photo.width, H = photo.height;
  const d = photo.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const border = [];
  const step = Math.max(1, Math.floor((W + H) / 400));
  for (let x = 0; x < W; x += step) border.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y += step) border.push(y * W, y * W + W - 1);
  const med = (arr) => arr.slice().sort((a, b) => a - b)[arr.length >> 1];
  const bg = [0, 1, 2].map((c) => med(border.map((i) => d[i * 4 + c])));
  const dist = (i) => Math.hypot(d[i * 4] - bg[0], d[i * 4 + 1] - bg[1], d[i * 4 + 2] - bg[2]);
  const tol = Math.min(90, Math.max(30, 30 + 2.5 * med(border.map(dist))));

  const isBg = new Uint8Array(W * H);
  const stack = [];
  for (const i of border) if (dist(i) < tol) { isBg[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % W, y = (i / W) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
      if (j >= 0 && !isBg[j] && dist(j) < tol) { isBg[j] = 1; stack.push(j); }
    }
  }
  const a = new Uint8Array(W * H);
  for (let i = 0; i < a.length; i++) a[i] = isBg[i] ? 0 : 255;
  return a;
}

// 4-connected components of pixels where mask[i] === value.
function components(mask, W, H, value) {
  const labels = new Int32Array(W * H).fill(-1);
  const comps = [];
  const stack = [];
  for (let s = 0; s < mask.length; s++) {
    if (mask[s] !== value || labels[s] >= 0) continue;
    const c = { id: comps.length, size: 0, minX: W, maxX: 0, minY: H, maxY: 0, border: false };
    labels[s] = c.id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop();
      const x = i % W, y = (i / W) | 0;
      c.size++;
      if (x < c.minX) c.minX = x; if (x > c.maxX) c.maxX = x;
      if (y < c.minY) c.minY = y; if (y > c.maxY) c.maxY = y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) c.border = true;
      if (x > 0 && mask[i - 1] === value && labels[i - 1] < 0) { labels[i - 1] = c.id; stack.push(i - 1); }
      if (x < W - 1 && mask[i + 1] === value && labels[i + 1] < 0) { labels[i + 1] = c.id; stack.push(i + 1); }
      if (y > 0 && mask[i - W] === value && labels[i - W] < 0) { labels[i - W] = c.id; stack.push(i - W); }
      if (y < H - 1 && mask[i + W] === value && labels[i + W] < 0) { labels[i + W] = c.id; stack.push(i + W); }
    }
    comps.push(c);
  }
  return { labels, comps };
}

// Keeps the main subject (plus nearby detached bits like a tail tip), fills small holes.
function cleanAlpha(raw, W, H) {
  const bin = new Uint8Array(W * H);
  for (let i = 0; i < bin.length; i++) bin[i] = raw[i] > 127 ? 1 : 0;
  const { labels, comps } = components(bin, W, H, 1);
  if (!comps.length) throw new Error("We couldn't find a pet in this photo. Try one with a plainer background.");
  const main = comps.reduce((a, b) => (b.size > a.size ? b : a));
  const padX = (main.maxX - main.minX) * 0.05, padY = (main.maxY - main.minY) * 0.05;
  const near = (c) => c.maxX >= main.minX - padX && c.minX <= main.maxX + padX && c.maxY >= main.minY - padY && c.minY <= main.maxY + padY;
  const keepIds = new Set(comps.filter((c) => c === main || (c.size > main.size * 0.02 && near(c))).map((c) => c.id));
  const extraSubjects = comps.some((c) => !keepIds.has(c.id) && c.size > main.size * 0.25);

  const keep = new Uint8Array(W * H);
  for (let i = 0; i < keep.length; i++) keep[i] = labels[i] >= 0 && keepIds.has(labels[i]) ? 1 : 0;

  const holes = components(keep, W, H, 0);
  const fill = new Uint8Array(W * H);
  const holeIds = new Set(holes.comps.filter((c) => !c.border && c.size < main.size * 0.015).map((c) => c.id));
  for (let i = 0; i < fill.length; i++) if (holes.labels[i] >= 0 && holeIds.has(holes.labels[i])) fill[i] = 1;

  // Let soft fur edges through within 2px of the kept shape.
  const near2 = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!keep[y * W + x]) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H) near2[yy * W + xx] = 1;
      }
    }
  }
  const alpha = new Uint8Array(W * H);
  let minX = W, maxX = -1, minY = H, maxY = -1, area = 0;
  for (let i = 0; i < alpha.length; i++) {
    const v = fill[i] ? 255 : near2[i] && raw[i] >= 12 ? raw[i] : 0;
    alpha[i] = v;
    if (v > 127) area++;
    // The crop takes in faint edges too, so softly faded props are not clipped.
    if (v > 10) {
      const x = i % W, y = (i / W) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return { alpha, extraSubjects, area, bbox: { minX, maxX, minY, maxY } };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function furName([r, g, b]) {
  const [h, s, l] = rgbToHsl(r, g, b);
  if (l < 0.16) return 'black';
  if (l > 0.9 || (l > 0.82 && s < 0.3)) return 'white';
  if (s < 0.14 || (l < 0.3 && s < 0.25)) return l < 0.42 ? 'charcoal' : l < 0.7 ? 'grey' : 'silver';
  if (h >= 10 && h <= 50) {
    if (l > 0.78) return 'cream';
    if (s > 0.5 && l > 0.35 && l < 0.7) return h < 32 ? 'ginger' : 'golden';
    if (l < 0.3) return 'chocolate';
    return l > 0.55 ? 'tan' : 'brown';
  }
  if (h > 50 && h < 70) return l > 0.7 ? 'cream' : 'tan';
  if (h >= 180 && h <= 260) return 'blue-grey';
  return 'brown';
}

const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

export function coatPalette(rgbData, alpha) {
  const idx = [];
  for (let i = 0; i < alpha.length; i++) if (alpha[i] > 220) idx.push(i);
  const step = Math.max(1, Math.floor(idx.length / 6000));
  const px = [];
  for (let i = 0; i < idx.length; i += step) {
    const j = idx[i] * 4;
    px.push([rgbData[j], rgbData[j + 1], rgbData[j + 2]]);
  }
  if (!px.length) return { colors: [], pattern: 'Solid', label: 'Unknown' };
  const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const sorted = px.slice().sort((a, b) => lum(a) - lum(b));
  let centers = [0.1, 0.4, 0.7, 0.95].map((q) => sorted[Math.floor(q * (sorted.length - 1))].slice());
  let assign = new Int32Array(px.length);
  for (let it = 0; it < 10; it++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    px.forEach((p, i) => {
      let best = 0, bd = Infinity;
      centers.forEach((c, k) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bd) { bd = d; best = k; }
      });
      assign[i] = best;
      const s = sum[best];
      s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    });
    centers = centers.map((c, k) => (sum[k][3] ? [sum[k][0] / sum[k][3], sum[k][1] / sum[k][3], sum[k][2] / sum[k][3]] : c));
  }
  let clusters = centers.map((c, k) => ({ c, n: 0 }));
  for (const a of assign) clusters[a].n++;
  clusters = clusters.filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  const merged = [];
  for (const cl of clusters) {
    const m = merged.find((x) => Math.hypot(x.c[0] - cl.c[0], x.c[1] - cl.c[1], x.c[2] - cl.c[2]) < 30);
    if (m) {
      const t = m.n + cl.n;
      m.c = m.c.map((v, i) => (v * m.n + cl.c[i] * cl.n) / t);
      m.n = t;
    } else merged.push({ ...cl });
  }
  const total = px.length;
  const colors = merged
    .map((x) => ({ hex: hex(x.c), share: x.n / total, name: furName(x.c), l: rgbToHsl(...x.c)[2] }))
    .filter((x) => x.share >= 0.05)
    .sort((a, b) => b.share - a.share)
    .slice(0, 3);
  // Two shades of the same colour become "dark ginger" / "light ginger".
  for (const c of colors) {
    const twin = colors.find((o) => o !== c && o.name === c.name);
    if (twin) c.label = `${c.l < twin.l ? 'dark' : 'light'} ${c.name}`;
  }
  for (const c of colors) if (c.label) c.name = c.label;
  let pattern = 'Patterned';
  if (colors[0].share > 0.72) pattern = 'Solid';
  else if (colors.length > 1 && colors[0].share + colors[1].share >= 0.8 && Math.abs(colors[0].l - colors[1].l) > 0.28) pattern = 'Two-tone';
  const names = [...new Set(colors.filter((c) => c.share >= 0.15).map((c) => c.name))].slice(0, 2);
  const label = names.join(' & ').replace(/^./, (s) => s.toUpperCase());
  return { colors: colors.map(({ hex, share, name }) => ({ hex, share, name })), pattern, label };
}

// Copies the photo's colour into the alpha mask. Semi-transparent edge pixels take
// the colour of nearby solid fur, which removes the old background's halo.
export function composeSprite(rgbData, alpha, w, h) {
  const c = canvasOf(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const out = img.data;
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i];
    let r = rgbData[i * 4], g = rgbData[i * 4 + 1], b = rgbData[i * 4 + 2];
    if (a > 0 && a < 230) {
      const x = i % w, y = (i / w) | 0;
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (alpha[j] >= 235) { sr += rgbData[j * 4]; sg += rgbData[j * 4 + 1]; sb += rgbData[j * 4 + 2]; n++; }
      }
      if (n) { r = sr / n; g = sg / n; b = sb / n; }
    }
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// opts.refine(raw, photo, cut) may adjust the raw mask, e.g. add props the model left out.
export async function analyzePhoto(blob, onStatus, opts = {}) {
  onStatus('Reading your photo…', null);
  const photo = await loadPhoto(blob);
  const W = photo.width, H = photo.height;

  let raw, method = 'ai';
  try {
    raw = await aiAlpha(photo, onStatus);
  } catch (err) {
    console.warn('Cutout model unavailable, using the simple background cut:', err);
    method = 'simple';
    onStatus('Using the simple background cut…', null);
    raw = colorKeyAlpha(photo);
  }
  if (opts.refine) raw = await opts.refine(raw, photo, (c) => aiAlpha(c, onStatus));

  onStatus('Finding the face, ears and tail…', null);
  await new Promise((r) => setTimeout(r, 30));
  const { alpha: full, extraSubjects, area, bbox } = cleanAlpha(raw, W, H);
  if (area < W * H * 0.01) {
    throw new Error("We couldn't find a pet in this photo. Try one where your pet is bigger in the frame and the background is plainer.");
  }

  const m = 3;
  const x0 = Math.max(0, bbox.minX - m), y0 = Math.max(0, bbox.minY - m);
  const x1 = Math.min(W, bbox.maxX + 1 + m), y1 = Math.min(H, bbox.maxY + 1 + m);
  const cw = x1 - x0, ch = y1 - y0;
  const s = Math.min(1, SPRITE_MAX / Math.max(cw, ch));
  const w = Math.round(cw * s), h = Math.round(ch * s);

  const rgb = canvasOf(w, h);
  const rctx = rgb.getContext('2d', { willReadFrequently: true });
  rctx.imageSmoothingQuality = 'high';
  rctx.drawImage(photo, x0, y0, cw, ch, 0, 0, w, h);
  const rgbData = rctx.getImageData(0, 0, w, h).data;

  // Scale the alpha crop through a canvas (alpha channel of a white image).
  const ac = canvasOf(cw, ch);
  const actx = ac.getContext('2d', { willReadFrequently: true });
  const aimg = actx.createImageData(cw, ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const o = (y * cw + x) * 4;
      aimg.data[o] = aimg.data[o + 1] = aimg.data[o + 2] = 255;
      aimg.data[o + 3] = full[(y + y0) * W + x + x0];
    }
  }
  actx.putImageData(aimg, 0, 0);
  const as = canvasOf(w, h);
  const asctx = as.getContext('2d', { willReadFrequently: true });
  asctx.imageSmoothingQuality = 'high';
  asctx.drawImage(ac, 0, 0, w, h);
  const ad = asctx.getImageData(0, 0, w, h).data;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = ad[i * 4 + 3];

  const rig = detectParts(alpha, w, h);
  const coat = coatPalette(rgbData, alpha);

  const warnings = [];
  if (method === 'simple') {
    warnings.push({ level: 'warn', text: 'The cutout model could not load, so a simple background cut was used. A plain background works best.' });
  }
  if (bbox.minX <= 1 || bbox.minY <= 1 || bbox.maxX >= W - 2 || bbox.maxY >= H - 2) {
    warnings.push({ level: 'warn', text: 'Your pet touches the edge of the photo, so part of it may look cut off.' });
  }
  if (extraSubjects) warnings.push({ level: 'info', text: 'We found more than one subject and kept the largest one.' });
  if (ch < 260) warnings.push({ level: 'warn', text: 'Your pet is small in this photo, so animations may look soft. A closer photo will look sharper.' });

  return { photo, method, rgb, rgbData, alpha, w, h, rig, coat, warnings, crop: { x0, y0, s } };
}
