// The desktop client: a transparent, click-through layer over the work area where
// companions walk along the taskbar. Mouse clicks only reach this window while the
// cursor is over a companion; everywhere else they pass through to your apps.
import { drawEffect } from '../shared/effects.js';
import { BEHAVIOR_WEIGHTS } from '../shared/actions.js';

const api = window.companion;
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d', { willReadFrequently: false });

const GRAVITY = 2600;
const ATTENTIVE = new Set(['rest', 'sit', 'wag', 'ears', 'sniff', 'walk', 'patrol', 'preen', 'snack', 'scroll']);
// Photo-puppet companions keep these; pose packs (e.g. the lovebird) bring their own.
const DEFAULT_REACTIONS = { click: 'happy', doubleClick: 'jump', look: 'look', held: 'held', wake: 'look', sleep: ['sleep'] };
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

let W = 0, H = 0, k = 1;
let selftest = false;
const pets = [];
const mouse = { x: -9999, y: -9999, vx: 0, vy: 0, t: 0, moved: false };
let press = null;
let hoverPet = null;
let ignoring = true;
let dirty = [];

function resize() {
  k = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * k);
  canvas.height = Math.round(H * k);
  dirty = [];
  for (const p of pets) {
    p.x = clampX(p, p.x);
    if (p.mode === 'ground') p.y = H;
  }
}

const reactions = (p) => p.m.reactions || DEFAULT_REACTIONS;
const frameOf = (p, a) => a.frame || p.m.frame;
const facingOf = (p, a) => a.facing ?? p.m.facing;
const halfW = (p) => {
  const a = p.sheets.get(p.action);
  return a?.halfW != null ? a.halfW * p.size : (p.m.rig.w / p.m.rig.h) * p.size * 0.5;
};
// The head, relative to the feet, in px (for pecks and pats).
function headOf(p) {
  const a = p.sheets.get(p.action);
  const flip = facingOf(p, a) !== 0 && p.dir !== facingOf(p, a);
  if (a?.hx != null) return { x: p.x + a.hx * p.size * (flip ? -1 : 1), y: p.y + a.hy * p.size };
  return { x: p.x, y: p.y - p.size * 0.8 };
}
function wantTyping() {
  api.wantTyping(pets.some((p) => reactions(p).typing && p.sheets.has(reactions(p).typing)));
}
const clampX = (p, x) => clamp(x, halfW(p), Math.max(halfW(p), W - halfW(p)));

// ---------- companions ----------
function removeCompanion(id) {
  const i = pets.findIndex((p) => p.id === id);
  if (i >= 0) pets.splice(i, 1);
  wantTyping();
}

async function addCompanion(info) {
  const m = info.manifest;
  const sheets = new Map();
  await Promise.all(m.actions.map(async (a) => {
    const img = new Image();
    img.src = info.baseUrl + a.sheet;
    await img.decode();
    sheets.set(a.id, { ...a, img });
  }));
  removeCompanion(info.id);
  const p = {
    id: info.id,
    m,
    sheets,
    size: selftest ? 220 : info.size,
    follow: info.follow,
    x: 0, y: 0, vx: 0, vy: 0,
    dir: Math.random() < 0.5 ? -1 : 1,
    mode: 'fall',
    action: 'held', t: 0, until: 0,
    effect: null, effectT: 0,
    squash: 0, swing: 0, swingV: 0,
    spawnT: 0, spawnAt: null,
    lookCooldown: 2, lastClick: 0, nearCooldown: 4, petDist: 0,
    grab: null, rect: null,
    cycle: 0,
  };
  p.x = clampX(p, selftest ? W * 0.5 : rand(W * 0.25, W * 0.75));
  p.y = H - p.size * 1.6;
  p.spawnAt = { x: p.x, y: p.y - p.size * 0.5 };
  play(p, reactions(p).held) || play(p, 'held');
  pets.push(p);
  wantTyping();
}

function play(p, id, { duration, dir } = {}) {
  const a = p.sheets.get(id);
  if (!a) return false;
  p.action = id;
  p.t = 0;
  if (a.kind === 'once') p.until = a.dur * a.loops;
  else if (a.kind === 'move') p.until = duration ?? rand(2.5, 7);
  else p.until = duration ?? ([].concat(reactions(p).sleep || []).includes(id) ? rand(14, 30) : rand(3, 8));
  if (dir) p.dir = dir;
  else if (a.kind === 'move' && Math.random() < 0.4) p.dir = -p.dir;
  p.effect = a.effect || null;
  p.effectT = 0;
  return true;
}

function pickNext(p) {
  const all = [...p.sheets.values()].filter((a) => !a.system);
  if (selftest) {
    const a = all[p.cycle++ % all.length];
    return play(p, a.id, { duration: 2.2 });
  }
  const table = p.m.weights || BEHAVIOR_WEIGHTS;
  const weights = table[p.m.personality] || table.playful;
  const options = all.filter((a) => a.id !== p.action && (weights[a.id] ?? 0) > 0);
  if (!options.length) return play(p, all[0].id);
  let r = Math.random() * options.reduce((s, a) => s + weights[a.id], 0);
  for (const a of options) {
    r -= weights[a.id];
    if (r <= 0) return play(p, a.id);
  }
  return play(p, options[0].id);
}

function liftOf(p, a) {
  if (!a.lift) return 0;
  const u = ((p.t % a.dur) / a.dur - a.lift.from) / (a.lift.to - a.lift.from);
  return u > 0 && u < 1 ? Math.sin(Math.PI * u) * a.lift.height * p.size : 0;
}

function land(p) {
  p.mode = 'ground';
  p.vx = p.vy = 0;
  p.swing = p.swingV = 0;
  if (p.m.reactions) {
    play(p, p.m.reactions.land || p.m.reactions.look, { duration: 2.5 });
    return;
  }
  const next = p.sheets.has('shake') && Math.random() < 0.35 ? 'shake' : p.sheets.has('look') ? 'look' : 'rest';
  play(p, next, { duration: 2.5 });
}

// ---------- simulation ----------
function update(dt) {
  for (const p of pets) {
    p.t += dt;
    p.effectT += dt;
    p.spawnT += dt;
    p.lookCooldown -= dt;
    p.nearCooldown -= dt;
    p.petDist *= Math.exp(-dt * 1.2);
    if (p.squash > 0) p.squash = Math.max(0, p.squash - dt * 3.5);
    const a = p.sheets.get(p.action);

    if (p.mode === 'held') {
      // Dangles from the cursor and swings against the direction you move it.
      const target = clamp(mouse.vx * 0.0007, -0.7, 0.7);
      p.swingV += ((target - p.swing) * 40 - p.swingV * 6) * dt;
      p.swing += p.swingV * dt;
      continue;
    }

    if (p.mode === 'fall') {
      p.vy += (p.m.flutter ? 700 : GRAVITY) * dt;
      if (p.m.flutter) p.vy = Math.min(p.vy, 320);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.exp(-dt * 0.8);
      p.swing *= Math.exp(-dt * 4);
      const h = halfW(p);
      if (p.x < h) { p.x = h; p.vx = Math.abs(p.vx) * 0.5; }
      if (p.x > W - h) { p.x = W - h; p.vx = -Math.abs(p.vx) * 0.5; }
      if (p.y >= H) {
        p.y = H;
        p.squash = 1;
        if (p.vy > 900 && !p.m.flutter) { p.vy = -p.vy * 0.28; p.vx *= 0.6; } else land(p);
      }
      continue;
    }

    if (p.follow) {
      const dx = mouse.x - p.x;
      if (Math.abs(dx) > p.size * 0.6) {
        const want = Math.abs(dx) > 420 && p.sheets.has('run') ? 'run' : 'walk';
        if (p.action !== want) play(p, want, { duration: 999, dir: Math.sign(dx) });
        p.dir = Math.sign(dx);
      } else if (a.kind === 'move') {
        play(p, p.sheets.has('look') ? 'look' : 'rest', { duration: 1.5, dir: Math.sign(dx) || p.dir });
      }
    }

    const cur = p.sheets.get(p.action);
    if (cur.kind === 'move') {
      p.x += p.dir * cur.speed * p.size * dt;
      const h = halfW(p);
      if (p.x < h) { p.x = h; p.dir = 1; } else if (p.x > W - h) { p.x = W - h; p.dir = -1; }
    } else if (cur.lift && liftOf(p, cur) > 0) {
      p.x = clampX(p, p.x + p.dir * p.size * 0.6 * dt);
    }

    const R = reactions(p);
    const face = Math.sign(mouse.x - p.x) || p.dir;
    // Stroking the bird with the cursor: head pats.
    if (R.pet && p.sheets.has(R.pet)) {
      if (p.petDist > 260 && p.action !== R.pet) { play(p, R.pet, { duration: 2.5 }); p.petDist = 0; }
      else if (p.action === R.pet && p.petDist > 80) p.until = Math.max(p.until, 1.5);
    }
    // A cursor hovering just in front of the beak gets nibbled.
    if (R.near && p.sheets.has(R.near) && !selftest && p.nearCooldown <= 0 && p.action !== R.near && p.action !== R.pet && hoverPet !== p) {
      const hd = headOf(p);
      if (Math.hypot(mouse.x - hd.x, mouse.y - hd.y) < p.size * 0.6) {
        play(p, R.near, { dir: face });
        p.nearCooldown = 10;
      }
    }
    const near = Math.hypot(mouse.x - p.x, mouse.y - (p.y - p.size * 0.5)) < p.size * 1.5;
    if (near && !p.follow && !selftest && ATTENTIVE.has(p.action) && p.lookCooldown <= 0 && p.sheets.has(R.look)) {
      play(p, R.look, { duration: 3, dir: face });
      p.lookCooldown = 7;
    }

    p.until -= dt;
    if (p.until <= 0) {
      if (p.action === R.look && near && !selftest) p.until = 1.5;
      else pickNext(p);
    }
  }
}

// ---------- drawing ----------
function draw() {
  ctx.setTransform(k, 0, 0, k, 0, 0);
  for (const r of dirty) ctx.clearRect(r.x, r.y, r.w, r.h);
  dirty = [];
  for (const p of pets) drawPet(p);
}

function drawPet(p) {
  const a = p.sheets.get(p.action);
  const F = frameOf(p, a);
  let fi = Math.floor(p.t * p.m.fps);
  fi = a.kind === 'once' ? Math.min(fi, a.frames * a.loops - 1) % a.frames : fi % a.frames;
  const s = p.size / F.spriteH;
  const lift = p.mode === 'ground' ? liftOf(p, a) : 0;
  const facing = facingOf(p, a);
  const flip = facing !== 0 && p.dir !== facing;
  const held = p.mode === 'held';
  const cx = held ? mouse.x - p.grab.dx : p.x;
  const cy = held ? mouse.y - p.grab.dy : p.y - lift;

  ctx.save();
  if (held) {
    ctx.translate(mouse.x, mouse.y);
    ctx.rotate(p.swing);
    ctx.translate(-p.grab.dx, -p.grab.dy);
  } else {
    ctx.translate(cx, cy);
    if (p.mode === 'fall') ctx.rotate(p.swing);
    if (p.squash > 0) {
      const q = Math.sin((p.squash * Math.PI) / 2) * 0.16;
      ctx.scale(1 + q, 1 - q);
    }
  }
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(a.img, (fi % a.cols) * F.w, Math.floor(fi / a.cols) * F.h, F.w, F.h, -F.anchorX * s, -F.anchorY * s, F.w * s, F.h * s);
  ctx.restore();

  p.rect = { x: cx - F.anchorX * s, y: cy - F.anchorY * s, w: F.w * s, h: F.h * s };
  // Area to wipe next frame: the sprite plus room for rotation and floating effects.
  const swinging = p.mode !== 'ground';
  const padX = swinging ? F.h * s : p.size * 0.6;
  const padY = swinging ? F.h * s : 12;
  dirty.push({ x: p.rect.x - padX, y: p.rect.y - p.size * 0.8 - padY, w: p.rect.w + padX * 2, h: p.rect.h + p.size * 0.8 + padY * 2 });

  if (p.effect && p.mode === 'ground') {
    const r = p.m.rig;
    const fx = a.fx != null ? a.fx : (r.head.x - r.w / 2) / r.h;
    const fy = a.fy != null ? a.fy : (r.head.y - r.head.r - r.ground) / r.h;
    drawEffect(ctx, p.effect, p.effectT, cx + fx * p.size * (flip ? -1 : 1), cy + fy * p.size, p.size);
  }
  if (p.spawnT < 0.9) {
    drawEffect(ctx, 'poof', p.spawnT, p.spawnAt.x, p.spawnAt.y, p.size);
    dirty.push({ x: p.spawnAt.x - p.size, y: p.spawnAt.y - p.size, w: p.size * 2, h: p.size * 2 });
  }
}

// ---------- mouse ----------
function petAt(x, y) {
  for (let i = pets.length - 1; i >= 0; i--) {
    const p = pets[i];
    const r = p.rect;
    if (!r || x < r.x || y < r.y || x > r.x + r.w || y > r.y + r.h) continue;
    const d = ctx.getImageData(Math.round(x * k) - 2, Math.round(y * k) - 2, 5, 5).data;
    for (let j = 3; j < d.length; j += 4) if (d[j] > 30) return p;
  }
  return null;
}

function setIgnore(ignore) {
  if (ignore === ignoring) return;
  ignoring = ignore;
  api.setIgnoreMouse(ignore);
}

function updateHover() {
  if (!mouse.moved && !press) return;
  mouse.moved = false;
  hoverPet = press ? null : petAt(mouse.x, mouse.y);
  const over = press ? true : !!hoverPet;
  setIgnore(!over);
  canvas.style.cursor = press?.dragging ? 'grabbing' : over ? 'grab' : '';
}

function startDrag() {
  const p = press.pet;
  press.dragging = true;
  pets.splice(pets.indexOf(p), 1);
  pets.push(p);
  const a = p.sheets.get(p.action);
  const y = p.mode === 'ground' ? p.y - liftOf(p, a) : p.y;
  p.grab = { dx: press.x - p.x, dy: press.y - y };
  p.mode = 'held';
  p.swing = 0;
  p.swingV = 0;
  play(p, reactions(p).held) || play(p, 'held');
}

function release(p) {
  p.x = clampX(p, mouse.x - p.grab.dx);
  p.y = Math.min(H, mouse.y - p.grab.dy);
  p.vx = clamp(mouse.vx * 0.5, -1400, 1400);
  p.vy = clamp(mouse.vy * 0.5, -1400, 900);
  p.mode = 'fall';
}

function click(p) {
  const now = performance.now();
  if (p.mode !== 'ground') return;
  const R = reactions(p);
  if (now - p.lastClick < 380 && p.sheets.has(R.doubleClick)) {
    play(p, R.doubleClick, { duration: 4 });
    p.lastClick = 0;
    return;
  }
  p.lastClick = now;
  const face = Math.sign(mouse.x - p.x) || p.dir;
  const fallback = p.sheets.has(R.look) ? R.look : [...p.sheets.keys()][0];
  if ([].concat(R.sleep || []).includes(p.action)) play(p, p.sheets.has(R.wake) ? R.wake : fallback, { duration: 3, dir: face });
  else play(p, p.sheets.has(R.click) ? R.click : fallback, { duration: 3, dir: face });
}

window.addEventListener('mousemove', (e) => {
  const now = performance.now();
  if (mouse.t) {
    const dt = Math.max(8, now - mouse.t) / 1000;
    mouse.vx = mouse.vx * 0.5 + ((e.clientX - mouse.x) / dt) * 0.5;
    mouse.vy = mouse.vy * 0.5 + ((e.clientY - mouse.y) / dt) * 0.5;
  }
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.t = now;
  mouse.moved = true;
  if (hoverPet && !press) hoverPet.petDist += Math.hypot(mouse.vx, mouse.vy) * 0.016;
  if (press && !press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) startDrag();
});

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const p = petAt(e.clientX, e.clientY);
  if (p) press = { pet: p, x: e.clientX, y: e.clientY, dragging: false };
});

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !press) return;
  if (press.dragging) release(press.pet);
  else click(press.pet);
  press = null;
  mouse.moved = true;
});

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const p = petAt(e.clientX, e.clientY);
  if (!p) return;
  api.showMenu({
    id: p.id,
    actions: [...p.sheets.values()].filter((a) => !a.system).map((a) => ({ id: a.id, name: a.name })),
    size: p.size,
    follow: p.follow,
  });
});

window.addEventListener('resize', () => {
  resize();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

// ---------- wiring ----------
api.onAdd((info) => addCompanion(info).catch((err) => console.error('Could not load companion', err)));
api.onRemove((id) => removeCompanion(id));
// Keyboard Buddy: hop onto the keyboard while you type, and stay while you keep going.
api.onTyping(() => {
  for (const p of pets) {
    const id = reactions(p).typing;
    if (!id || !p.sheets.has(id) || p.mode !== 'ground') continue;
    if (p.action !== id) play(p, id, { duration: 3 });
    else p.until = Math.max(p.until, 2.5);
  }
});
api.onCommand(({ id, cmd, arg }) => {
  const p = pets.find((x) => x.id === id);
  if (!p) return;
  if (cmd === 'play' && p.mode === 'ground') {
    play(p, arg, { duration: p.sheets.get(arg)?.kind === 'move' ? 5 : undefined });
  } else if (cmd === 'size') {
    p.size = arg;
    p.x = clampX(p, p.x);
  } else if (cmd === 'follow') {
    p.follow = arg;
  }
});

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  mouse.vx *= Math.exp(-dt * 6);
  mouse.vy *= Math.exp(-dt * 6);
  update(dt);
  draw();
  updateHover();
  requestAnimationFrame(frame);
}

resize();
(async () => {
  selftest = (await api.selftestInfo()).on;
  for (const info of await api.getActive()) {
    await addCompanion(info).catch((err) => console.error('Could not load companion', err));
  }
})();
requestAnimationFrame(frame);
