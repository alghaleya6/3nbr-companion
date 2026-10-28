// AI pose pack: one AI-made picture of the bird per pose (assets/poses/ai/cut, already
// cut out, props included), rigged at the head and body, animated live and packed into a
// .companion file.
import { zipSync, strToU8 } from 'fflate';
import { FPS, neutralPose } from '../shared/actions.js';
import { LOVEBIRD_POSES, LOVEBIRD_REACTIONS, LOVEBIRD_WEIGHTS, LOVEBIRD_ANIM } from '../shared/lovebirdPoses.js';

export const AI_SPRITE_H = 220; // frame pixels per companion "size" unit
const HEAD_PX = 34; // head radius in frame pixels, so the bird is the same size in every pose
const MAX_W = 1.6 * AI_SPRITE_H; // wide props (the bed, the keyboard) are scaled to fit
const PAD = 12;

// Per pose, in cut-out pixels: head [x, y, r], torso [x, y, r] (breathing centre), which
// way the bird faces (1 right, -1 left, 0 toward you), the picture it uses, and taps:
// [x, y, r] spots (each foot on the keys) that lift on their own.
export const AI_RIGS = {
  look: { head: [205, 95, 85], torso: [313, 274, 150], facing: 0 },
  keyboard: { head: [265, 115, 80], torso: [520, 270, 170], facing: -1, taps: [[410, 420, 45], [500, 438, 40]] },
  patrol: { head: [720, 125, 125], torso: [457, 413, 230], facing: 1 },
  snack: { head: [157, 150, 135], torso: [344, 516, 250], facing: 0 },
  nap: { head: [214, 229, 74], torso: [457, 302, 80], facing: -1 },
  stretch: { head: [372, 95, 95], torso: [400, 380, 170], facing: 0 },
  pats: { head: [449, 305, 115], torso: [333, 547, 200], facing: 1 },
  disco: { head: [89, 89, 85], torso: [212, 312, 170], facing: -1 },
  kiss: { head: [142, 110, 105], torso: [294, 389, 210], facing: 0 },
  preen: { head: [603, 147, 125], torso: [400, 437, 220], facing: 1 },
  pecks: { head: [349, 109, 80], torso: [596, 218, 140], facing: -1 },
  tucked: { head: [187, 128, 125], torso: [321, 374, 250], facing: 0 },
  scroll: { head: [290, 120, 95], torso: [543, 193, 130], facing: -1 },
  held: { pic: 'disco', head: [89, 89, 85], torso: [212, 312, 170], facing: -1 },
};

const TAU = Math.PI * 2;
const sin = Math.sin;

// Poses standing on a prop keep the prop still: only the head and body move.
const AI_ANIM = {
  ...LOVEBIRD_ANIM,
  keyboard(t) {
    // Feet take turns pressing keys; the head dips to each keystroke.
    const p = neutralPose();
    const u = (t * 8) % 1, left = Math.floor(t * 8) % 2 === 0;
    const lift = u < 0.45 ? sin(Math.PI * u / 0.45) : 0;
    p.taps = left ? [0.35 * lift, 0] : [0, 0.35 * lift];
    const press = Math.max(0, 1 - Math.abs(u - 0.5) * 5);
    p.head.rot = 0.06 * press * (left ? 1 : 0.7);
    p.head.y = 0.05 * press;
    p.breath = 0.012 * sin(TAU * t);
    return p;
  },
  scroll(t) {
    const p = neutralPose();
    // Little nods while scrolling, with a pause to read.
    const nod = Math.max(0, sin(TAU * t * 3)) * (t < 0.7 ? 1 : 0);
    p.head.rot = 0.05 * nod + 0.02 * sin(TAU * t);
    p.breath = 0.012 * sin(TAU * t * 2);
    return p;
  },
  nap(t) {
    const p = neutralPose();
    p.breath = 0.05 * sin(TAU * t);
    p.head.rot = 0.02 * sin(TAU * t);
    return p;
  },
};

const load = (src) => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => rej(new Error(`Could not load ${src}`));
  img.src = src;
});

// Loads every cut-out once: { id: { canvas, alpha, w, h } }.
export async function loadAiCuts(base = '../../assets/poses/ai/cut/') {
  const ids = [...new Set(Object.entries(AI_RIGS).map(([id, r]) => r.pic || id))];
  const cuts = {};
  await Promise.all(ids.map(async (id) => {
    const img = await load(`${base}${id}.png`);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, canvas.width, canvas.height).data;
    const alpha = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = d[i * 4 + 3];
    cuts[id] = { canvas, alpha, w: canvas.width, h: canvas.height };
  }));
  return cuts;
}

function rigFor(cut, R) {
  const { w, h, alpha } = cut;
  let fMin = w, fMax = 0;
  for (let y = Math.floor(h * 0.94); y < h; y++) for (let x = 0; x < w; x++) {
    if (alpha[y * w + x] >= 128) { fMin = Math.min(fMin, x); fMax = Math.max(fMax, x); }
  }
  return {
    w, h, ground: h - 1, facing: R.facing, style: 'hop', headScale: 1,
    head: { x: R.head[0], y: R.head[1], r: R.head[2] },
    torso: { x: R.torso[0], y: R.torso[1], r: R.torso[2] },
    ears: [], tail: null, feet: { min: fMin, max: Math.max(fMin, fMax) },
    taps: (R.taps || []).map(([x, y, r]) => ({ x, y, r })),
  };
}

// Renders one pose's live animation into a sprite sheet. The frame's anchor sits under
// the bird's body, so it stays in place when it changes pose.
export function renderAiPose(renderer, cuts, id, dur) {
  const R = AI_RIGS[id];
  const cut = cuts[R.pic || id];
  const rig = rigFor(cut, R);
  const sb = Math.min(HEAD_PX / R.head[2], MAX_W / cut.w);
  const bw = cut.w * sb, bh = cut.h * sb;
  const room = Math.round(bh * 0.12); // head-bobs and leaning in need a little headroom
  const fw = Math.ceil(bw + PAD * 2), fh = Math.ceil(bh + PAD * 2 + room);
  const bx = PAD + bw / 2, by = fh - PAD;
  const anchorX = Math.round(bx + (R.torso[0] - cut.w / 2) * sb);
  renderer.setSprite(cut.canvas, rig, cut.alpha);
  const frames = Math.max(10, Math.round(dur * FPS));
  const cols = Math.min(frames, 8);
  const sheet = document.createElement('canvas');
  sheet.width = cols * fw;
  sheet.height = Math.ceil(frames / cols) * fh;
  const g = sheet.getContext('2d');
  const anim = AI_ANIM[id] || AI_ANIM.look;
  for (let i = 0; i < frames; i++) {
    renderer.render(anim(i / frames, rig), { width: fw, height: fh, scale: sb, anchorX: bx, anchorY: by });
    g.drawImage(renderer.canvas, (i % cols) * fw, Math.floor(i / cols) * fh);
  }
  const u = (v) => v / AI_SPRITE_H;
  return {
    sheet, frames, cols, fw, fh, anchorX, anchorY: by,
    fx: u((R.head[0] - R.torso[0]) * sb), fy: u((R.head[1] - R.head[2] - cut.h) * sb),
    hx: u((R.head[0] - R.torso[0]) * sb), hy: u((R.head[1] - cut.h) * sb),
    halfW: u(Math.max(anchorX, fw - anchorX) - PAD),
  };
}

const toBlob = (canvas, type, quality) => new Promise((r) => canvas.toBlob(r, type, quality));
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export async function buildAiPack({ renderer, cuts, enabled, name, uid, personality }, onProgress) {
  const poses = LOVEBIRD_POSES.filter((p) => p.required || !enabled || enabled.has(p.id));
  const list = [...poses, { id: 'held', name: 'Carried', kind: 'stay', dur: 0.6, system: true }];
  const files = {};
  const entries = [];
  const previews = {};
  let totalFrames = 0;
  let thumb = null;
  for (const [k, spec] of list.entries()) {
    onProgress?.(`Rendering “${spec.name}”…`, k / (list.length + 1));
    await nextFrame();
    const r = renderAiPose(renderer, cuts, spec.id, spec.dur);
    if (spec.id === 'look') {
      thumb = document.createElement('canvas');
      thumb.width = thumb.height = 256;
      const side = Math.max(r.fw, r.fh), s = 256 / side;
      thumb.getContext('2d').drawImage(r.sheet, 0, 0, r.fw, r.fh, ((side - r.fw) / 2) * s, ((side - r.fh) / 2) * s, r.fw * s, r.fh * s);
    }
    const blob = await toBlob(r.sheet, 'image/webp', 0.92);
    files[`sheets/${spec.id}.webp`] = [await bytesOf(blob), { level: 0 }];
    previews[spec.id] = URL.createObjectURL(blob);
    totalFrames += r.frames;
    entries.push({
      id: spec.id, name: spec.name, sheet: `sheets/${spec.id}.webp`,
      frames: r.frames, cols: r.cols, dur: r.frames / FPS,
      kind: spec.kind, loops: spec.loops || 1, speed: spec.speed || 0, lift: null,
      effect: spec.effect || null, system: !!spec.system, trigger: spec.trigger || null,
      facing: AI_RIGS[spec.id].facing,
      frame: { w: r.fw, h: r.fh, anchorX: r.anchorX, anchorY: r.anchorY, spriteH: AI_SPRITE_H },
      fx: r.fx, fy: r.fy, hx: r.hx, hy: r.hy, halfW: r.halfW,
    });
  }
  onProgress?.('Packing your companion…', list.length / (list.length + 1));
  await nextFrame();
  files['thumb.png'] = [await bytesOf(await toBlob(thumb, 'image/png')), { level: 0 }];
  const manifest = {
    format: 'companion/1', kind: 'posepack', species: 'lovebird', uid, name, personality,
    createdAt: new Date().toISOString(), generator: 'Companion Studio 1.3',
    facing: 0, coat: { label: 'AI poses', colors: [] },
    fps: FPS, display: { size: 150 }, flutter: true,
    reactions: LOVEBIRD_REACTIONS, weights: LOVEBIRD_WEIGHTS, actions: entries,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  const bytes = zipSync(files);
  return { bytes, manifest, previews, totalFrames, thumbUrl: thumb.toDataURL('image/png') };
}
