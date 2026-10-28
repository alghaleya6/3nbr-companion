// Companion Studio: upload -> review the look -> review poses -> bring to desktop.
import { CATALOG, GROUPS, POSES, PERSONALITIES, actionAvailable } from '../shared/actions.js';
import { RigRenderer } from '../shared/rig.js';
import { drawEffect } from '../shared/effects.js';
import { analyzePhoto, composeSprite } from './analyze.js';
import { detectParts, retraceTail } from './detect.js';
import { makeSamplePhoto } from './sample.js';
import { buildPackage } from './package.js';
import { createLovebird } from './lovebird.js';

const api = window.companion;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const dpr = () => Math.min(2, window.devicePixelRatio || 1);
const TILE_W = 320;
const TILE_H = 240;
const COLORS = { face: '#e2672f', ear: '#d6457a', tail: '#3d67c4' };
const NEXT_LABEL = { 1: 'Analyze photo', 2: 'Review poses', 3: 'Render final animation', 4: 'Start a new companion' };

const S = {
  mode: 'bird',
  step: 1,
  file: null,
  photoUrl: null,
  name: '',
  personality: 'playful',
  selected: new Set(CATALOG.filter((a) => a.required || a.default).map((a) => a.id)),
  enabled: new Set(),
  analysis: null,
  analyzedFile: null,
  rig: null,
  sprite: null,
  uid: null,
  tool: 'markers',
  tiles: [],
  pkg: null,
  dirty: true,
  imported: false,
};

let renderer = null;
const getRenderer = () => (renderer ??= new RigRenderer());
const bird = createLovebird({ getRenderer, $, el, dpr, onChange: () => { S.dirty = true; updateFooter(); } });

function setMode(mode) {
  S.mode = mode;
  document.body.classList.toggle('mode-bird', mode === 'bird');
  S.dirty = true;
  updateFooter();
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function cleanError(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

// ---------- busy modal + toast ----------
function showBusy(title, text, frac = null) {
  $('#busyTitle').textContent = title;
  updateBusy(text, frac);
  $('#busy').hidden = false;
}
function updateBusy(text, frac) {
  $('#busyText').textContent = text;
  const bar = $('#busy .bar');
  if (frac == null) {
    bar.classList.add('indeterminate');
    $('#busyBar').style.width = '';
  } else {
    bar.classList.remove('indeterminate');
    $('#busyBar').style.width = `${Math.round(frac * 100)}%`;
  }
}
const hideBusy = () => { $('#busy').hidden = true; };

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}

// ---------- navigation ----------
function updateFooter() {
  $('#btnBack').hidden = S.step === 1;
  const next = $('#btnNext');
  next.textContent = NEXT_LABEL[S.step];
  next.className = 'btn ' + (S.step === 4 ? 'ghost' : 'primary');
  next.disabled = false;
  let hint = '';
  if (S.mode === 'bird') {
    if (S.step === 1) {
      if (!bird.B.name) hint = 'Give your companion a name';
      next.disabled = !bird.B.name;
      next.textContent = 'Review the look';
    } else if (S.step === 2) {
      hint = `Looks like ${bird.B.name}? Next, check every pose.`;
    } else if (S.step === 3) {
      hint = `${bird.enabledPoses().length} poses will be rendered, plus one for when you carry ${bird.B.name}`;
    }
    $('#footHint').textContent = hint;
    return;
  }
  if (S.step === 1) {
    if (!S.file) hint = 'Add a photo to continue';
    else if (!S.name) hint = 'Give your companion a name';
    next.disabled = !S.file || !S.name;
  } else if (S.step === 2) {
    hint = 'Happy with the look? Next, check how it moves.';
  } else if (S.step === 3) {
    hint = `${enabledActions().length} actions will be rendered, plus a pose for when you carry it`;
  }
  $('#footHint').textContent = hint;
}

function goTo(step) {
  S.step = step;
  const sectionId = (i) => (S.mode === 'bird' && (i === 2 || i === 3) ? `step${i}b` : `step${i}`);
  for (const id of ['step1', 'step2', 'step3', 'step4', 'step2b', 'step3b']) $(`#${id}`).hidden = id !== sectionId(step);
  $$('#stepper li').forEach((li) => {
    const n = +li.dataset.step;
    li.classList.toggle('current', n === step);
    li.classList.toggle('done', n < step);
    li.style.cursor = n < step ? 'pointer' : '';
  });
  $('#main').scrollTop = 0;
  if (step === 2) (S.mode === 'bird' ? bird.enterLook() : enterLook());
  if (step === 3) (S.mode === 'bird' ? bird.enterPoses() : enterPoses());
  if (step === 4) enterDesktop();
  updateFooter();
}

async function advance() {
  if (S.mode === 'bird') {
    if (S.step === 1) {
      showBusy('Getting your bird ready', 'Loading the poses…');
      await bird.ready();
      hideBusy();
      if (!S.uid || S.uidFor !== bird.B.name) { S.uid = makeUid(bird.B.name); S.uidFor = bird.B.name; }
      goTo(2);
    } else if (S.step === 2) {
      goTo(3);
    } else if (S.step === 3) {
      if (!S.pkg || S.dirty) {
        showBusy('Rendering the final animation', 'Preparing…', 0);
        await finishPackage(await bird.build(S.uid, (msg, frac) => updateBusy(msg, frac)));
      }
      goTo(4);
    } else {
      location.reload();
    }
    return;
  }
  if (S.step === 1) {
    if (S.analyzedFile !== S.file) await runAnalysis();
    goTo(2);
  } else if (S.step === 2) {
    goTo(3);
  } else if (S.step === 3) {
    await runRender();
    goTo(4);
  } else {
    location.reload();
  }
}

async function onNext() {
  try {
    await advance();
  } catch (err) {
    console.error(err);
    hideBusy();
    toast(cleanError(err), true);
  }
}

// ---------- step 1: photo, name, actions ----------
function setPhoto(blob) {
  S.file = blob;
  if (S.photoUrl) URL.revokeObjectURL(S.photoUrl);
  S.photoUrl = URL.createObjectURL(blob);
  const img = $('#photoPreview');
  img.src = S.photoUrl;
  img.hidden = false;
  $('#dzEmpty').hidden = true;
  $('#dzChange').hidden = false;
  $('#dropzone').classList.add('has-photo');
  updateFooter();
}

function setName(name) {
  S.name = name.trim();
  $('#petName').value = name;
  S.dirty = true;
  updateFooter();
}

function renderPersonality() {
  $$('#personality .chip').forEach((b) => b.classList.toggle('on', b.dataset.id === S.personality));
  $('#personaHint').textContent = PERSONALITIES.find((p) => p.id === S.personality).hint;
}

function updateActionCount() {
  $('#actionCount').textContent = `${S.selected.size} of ${CATALOG.length} selected`;
}

function renderCatalog() {
  const root = $('#catalog');
  root.innerHTML = '';
  for (const g of GROUPS) {
    const sec = el('div', 'cat-group');
    sec.append(el('h4', null, g.title));
    const grid = el('div', 'cat-items');
    for (const a of CATALOG.filter((x) => x.group === g.id)) {
      const on = S.selected.has(a.id);
      const item = el('label', `cat-item${on ? ' on' : ''}${a.required ? ' locked' : ''}`);
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = on;
      cb.disabled = !!a.required;
      cb.onchange = () => {
        if (cb.checked) S.selected.add(a.id);
        else S.selected.delete(a.id);
        item.classList.toggle('on', cb.checked);
        S.enabled = new Set(S.selected);
        S.dirty = true;
        updateActionCount();
      };
      const txt = el('div');
      txt.append(el('strong', null, a.name), el('span', null, a.desc));
      if (a.required) txt.append(el('em', null, 'Always included'));
      else if (a.needs) txt.append(el('em', null, a.needs === 'tail' ? 'Needs a visible tail' : 'Needs visible ears'));
      item.append(cb, txt);
      grid.append(item);
    }
    sec.append(grid);
    root.append(sec);
  }
  updateActionCount();
}

async function handleFiles(files) {
  const f = files?.[0];
  if (!f) return;
  if (/\.companion$/i.test(f.name)) {
    await importBytes(new Uint8Array(await f.arrayBuffer()), false);
  } else if (f.type.startsWith('image/') && S.mode === 'photo') {
    if (S.step !== 1) goTo(1);
    setPhoto(f);
  } else if (S.mode === 'photo') {
    toast('That file type isn’t supported. Use a JPG, PNG or WebP photo.', true);
  } else {
    toast('Drop a .companion file here to import it.', true);
  }
}

function initStep1() {
  for (const p of PERSONALITIES) {
    const b = el('button', 'chip', p.name);
    b.dataset.id = p.id;
    b.onclick = () => { S.personality = p.id; S.dirty = true; renderPersonality(); };
    $('#personality').append(b);
  }
  renderPersonality();
  renderCatalog();

  $('#petName').addEventListener('input', (e) => setName(e.target.value));
  $('#fileInput').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) setPhoto(f);
    e.target.value = '';
  });
  const dz = $('#dropzone');
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dz.classList.remove('drag');
    handleFiles(e.dataTransfer.files);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); });

  $('#btnSample').onclick = async () => {
    setPhoto(await makeSamplePhoto());
    if (!S.name) setName('Mochi');
  };
}

function makeUid(name) {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'companion';
  return `${slug}-${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;
}

async function runAnalysis() {
  showBusy('Analyzing your photo', 'Reading your photo…');
  const res = await analyzePhoto(S.file, (msg, frac) => updateBusy(msg, frac));
  updateBusy('Building the puppet rig…', null);
  await sleep(20);
  S.analysis = res;
  S.analyzedFile = S.file;
  S.rig = res.rig;
  S.uid = makeUid(S.name);
  S.enabled = new Set(S.selected);
  S.dirty = true;
  S.sprite = composeSprite(res.rgbData, res.alpha, res.w, res.h);
  getRenderer().setSprite(S.sprite, S.rig, res.alpha);
  const c = $('#stageCanvas');
  c.width = res.w;
  c.height = res.h;
  hideBusy();
  console.log('[analysis]', JSON.stringify({ method: res.method, w: res.w, h: res.h, rig: res.rig, coat: res.coat, warnings: res.warnings }));
}

// ---------- step 2: review the look ----------
function enterLook() {
  fitStage();
  drawStage();
  drawMarkers();
  updateLookPanel();
}

function fitStage() {
  const box = $('#stage').getBoundingClientRect();
  const { w, h } = S.analysis;
  const s = Math.min((box.width - 48) / w, (box.height - 48) / h);
  $('#stageInner').style.width = `${Math.max(10, w * s)}px`;
  $('#stageInner').style.height = `${Math.max(10, h * s)}px`;
}

function drawStage() {
  const { w, h, rgb } = S.analysis;
  const ctx = $('#stageCanvas').getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if ($('#showPhoto').checked) {
    ctx.globalAlpha = 0.35;
    ctx.drawImage(rgb, 0, 0);
    ctx.globalAlpha = 1;
  }
  ctx.drawImage(S.sprite, 0, 0);
}

const unitsPerPx = () => S.analysis.w / ($('#stageInner').getBoundingClientRect().width || 1);

function handleSvg(id, p, r, color, u, label) {
  let s = `<g class="handle" data-h="${id}"><circle cx="${p.x}" cy="${p.y}" r="${r + 7 * u}" fill="transparent"/>` +
    `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${color}" stroke="#fff" stroke-width="${2.5 * u}"/></g>`;
  if (label) {
    s += `<text x="${p.x + r + 5 * u}" y="${p.y - r - 3 * u}" font-size="${12 * u}" font-weight="700" fill="${color}" ` +
      `stroke="#fff" stroke-width="${3 * u}" paint-order="stroke" style="pointer-events:none">${label}</text>`;
  }
  return s;
}

function drawMarkers() {
  const svg = $('#markers');
  const { w, h } = S.analysis;
  const R = S.rig;
  const u = unitsPerPx();
  const hr = 7 * u;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  let s = `<line x1="0" x2="${w}" y1="${R.ground}" y2="${R.ground}" stroke="#7a7166" stroke-width="${1.5 * u}" stroke-dasharray="${6 * u} ${5 * u}" opacity="0.7"/>`;
  if (R.tail) {
    const { base: b, tip: t } = R.tail;
    const line = (R.tail.path || [b, t]).map((p) => `${p.x},${p.y}`).join(' ');
    s += `<polyline points="${line}" fill="none" stroke="${COLORS.tail}" stroke-width="${3 * u}" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`;
    s += handleSvg('tailBase', b, hr * 0.75, COLORS.tail, u) + handleSvg('tailTip', t, hr, COLORS.tail, u, 'Tail');
  }
  s += `<circle cx="${R.head.x}" cy="${R.head.y}" r="${R.head.r}" fill="rgba(226,103,47,0.08)" stroke="${COLORS.face}" stroke-width="${2.5 * u}" stroke-dasharray="${7 * u} ${5 * u}"/>`;
  R.ears.forEach((e) => {
    s += `<line x1="${R.head.x}" y1="${R.head.y}" x2="${e.x}" y2="${e.y}" stroke="${COLORS.ear}" stroke-width="${1.5 * u}" stroke-dasharray="${3 * u} ${3 * u}" opacity="0.8"/>`;
  });
  s += handleSvg('faceR', { x: R.head.x + R.head.r, y: R.head.y }, hr * 0.7, COLORS.face, u);
  s += handleSvg('face', R.head, hr, COLORS.face, u, 'Face');
  R.ears.forEach((e, i) => { s += handleSvg(`ear${i}`, e, hr, COLORS.ear, u, i === 0 ? 'Ears' : null); });
  svg.innerHTML = s;
}

function toSprite(e) {
  const r = $('#stageInner').getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * S.analysis.w,
    y: ((e.clientY - r.top) / r.height) * S.analysis.h,
  };
}

function moveHandle(h, p) {
  const R = S.rig;
  const q = { x: clamp(p.x, 0, R.w), y: clamp(p.y, 0, R.h) };
  if (h === 'face') {
    const dx = q.x - R.head.x, dy = q.y - R.head.y;
    R.head.x = q.x;
    R.head.y = q.y;
    R.ears.forEach((e) => { e.x += dx; e.y += dy; });
  } else if (h === 'faceR') {
    R.head.r = clamp(Math.hypot(q.x - R.head.x, q.y - R.head.y), 8, Math.max(R.w, R.h) * 0.6);
  } else if (h.startsWith('ear')) {
    Object.assign(R.ears[+h.slice(3)], q);
  } else if (h === 'tailBase' || h === 'tailTip') {
    // Straight while dragging; the curve is re-traced when you let go.
    R.tail[h === 'tailBase' ? 'base' : 'tip'] = q;
    R.tail.path = null;
  }
}

function retraceTailPath() {
  const R = S.rig;
  if (!R.tail) return;
  R.tail.path = retraceTail(S.analysis.alpha, S.analysis.w, S.analysis.h, R.tail.base, R.tail.tip);
}

function onRigChanged() {
  getRenderer().setRig(S.rig);
  drawMarkers();
  updateLookPanel();
  S.dirty = true;
}

function setSeg(sel, value) {
  $$(`${sel} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === value));
}

function updateLookPanel() {
  const R = S.rig;
  const A = S.analysis;
  setSeg('#facingSeg', String(R.facing));
  setSeg('#styleSeg', R.style);
  const badge = $('#faceBadge');
  badge.textContent = 'Face found';
  badge.className = 'badge good';
  $('#earStatus').textContent = R.ears.length ? (R.ears.length === 1 ? '1 ear marked' : '2 ears marked') : 'None marked';
  $('#btnEars').textContent = R.ears.length ? 'Remove' : 'Add ears';
  $('#tailStatus').textContent = R.tail ? 'Marked' : 'None marked';
  $('#btnTail').textContent = R.tail ? 'Remove' : 'Add tail';

  const sw = $('#swatches');
  sw.innerHTML = '';
  for (const c of A.coat.colors) {
    const d = el('div', 'swatch');
    const i = el('i');
    i.style.background = c.hex;
    d.append(i, el('span', null, `${c.name} ${Math.round(c.share * 100)}%`));
    sw.append(d);
  }
  $('#coatPattern').textContent = A.coat.pattern;
  $('#coatLabel').textContent = `${A.coat.label} coat`;

  const aspect = R.w / R.h;
  const shape = aspect > 1.35 ? 'Long and low' : aspect < 0.85 ? 'Tall and upright' : 'Compact';
  $('#propSummary').textContent = `${shape} · head ${Math.round(((R.head.r * 2) / R.h) * 100)}% of height`;
  $('#headScale').value = R.headScale;
  const hs = Math.round((R.headScale - 1) * 100);
  $('#headScaleVal').textContent = hs === 0 ? '(natural)' : `(${hs > 0 ? '+' : ''}${hs}%)`;

  const ready = enabledActions();
  const skipped = CATALOG.filter((a) => S.selected.has(a.id) && !actionAvailable(a, R));
  const facts = $('#facts');
  facts.innerHTML = '';
  const add = (k, v) => facts.append(el('dt', null, k), el('dd', null, v));
  add('Name', S.name);
  add('Personality', PERSONALITIES.find((p) => p.id === S.personality).name);
  add('Coat', A.coat.label);
  add('Facing', R.facing === 0 ? 'The camera' : R.facing > 0 ? 'Right' : 'Left');
  add('Actions', `${ready.length} ready${skipped.length ? `, ${skipped.length} skipped` : ''}`);

  const items = [...A.warnings];
  if (!items.some((w) => w.level === 'warn')) {
    items.unshift({ level: 'ok', text: 'Clear photo and a clean cutout.' });
  }
  for (const a of skipped) {
    items.push({ level: 'info', text: `${a.name} needs ${a.needs === 'tail' ? 'a tail' : 'ears'}. Add ${a.needs === 'tail' ? 'one' : 'them'} above, or it will be skipped.` });
  }
  const ul = $('#warnings');
  ul.innerHTML = '';
  for (const w of items) ul.append(el('li', w.level, w.text));
}

let markerDrag = null;
let brushing = false;
let recomposeQueued = false;

function paintAt(e) {
  const p = toSprite(e);
  const r = (+$('#brushSize').value * unitsPerPx()) / 2;
  const { w, h, alpha } = S.analysis;
  const erase = S.tool === 'erase';
  const x0 = Math.max(0, Math.floor(p.x - r)), x1 = Math.min(w - 1, Math.ceil(p.x + r));
  const y0 = Math.max(0, Math.floor(p.y - r)), y1 = Math.min(h - 1, Math.ceil(p.y + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = clamp(r - Math.hypot(x - p.x, y - p.y), 0, 1);
      if (!t) continue;
      const i = y * w + x;
      alpha[i] = erase ? Math.round(alpha[i] * (1 - t)) : Math.max(alpha[i], Math.round(255 * t));
    }
  }
  if (!recomposeQueued) {
    recomposeQueued = true;
    requestAnimationFrame(() => {
      recomposeQueued = false;
      S.sprite = composeSprite(S.analysis.rgbData, S.analysis.alpha, w, h);
      drawStage();
    });
  }
}

function initStep2() {
  const svg = $('#markers');
  svg.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('[data-h]');
    if (!g || S.tool !== 'markers') return;
    markerDrag = g.dataset.h;
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!markerDrag) return;
    moveHandle(markerDrag, toSprite(e));
    onRigChanged();
  });
  const endDrag = () => {
    if (markerDrag?.startsWith('tail')) {
      retraceTailPath();
      onRigChanged();
    }
    markerDrag = null;
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  const inner = $('#stageInner');
  inner.addEventListener('pointerdown', (e) => {
    if (S.tool === 'markers') return;
    brushing = true;
    inner.setPointerCapture(e.pointerId);
    paintAt(e);
  });
  inner.addEventListener('pointermove', (e) => { if (brushing) paintAt(e); });
  const endBrush = () => {
    if (!brushing) return;
    brushing = false;
    S.sprite = composeSprite(S.analysis.rgbData, S.analysis.alpha, S.analysis.w, S.analysis.h);
    drawStage();
    getRenderer().setSprite(S.sprite, S.rig, S.analysis.alpha);
    S.dirty = true;
  };
  inner.addEventListener('pointerup', endBrush);
  inner.addEventListener('pointercancel', endBrush);

  $$('#toolSeg button').forEach((b) => {
    b.onclick = () => {
      S.tool = b.dataset.tool;
      $$('#toolSeg button').forEach((x) => x.classList.toggle('on', x === b));
      $('#stage').classList.toggle('brush', S.tool !== 'markers');
      $('#brushCtl').hidden = S.tool === 'markers';
      $('#stageHint').textContent = S.tool === 'markers'
        ? 'Drag markers to adjust · the dashed line is the ground'
        : S.tool === 'erase'
          ? 'Paint over leftover background to remove it'
          : 'Paint over parts of your pet that were cut away';
    };
  });
  $('#showPhoto').onchange = drawStage;
  $('#btnRedetect').onclick = () => {
    const keep = { headScale: S.rig.headScale };
    S.rig = { ...detectParts(S.analysis.alpha, S.analysis.w, S.analysis.h), ...keep };
    onRigChanged();
    toast('Markers re-detected from the current cutout');
  };
  $$('#facingSeg button').forEach((b) => {
    b.onclick = () => { S.rig.facing = +b.dataset.v; onRigChanged(); };
  });
  $$('#styleSeg button').forEach((b) => {
    b.onclick = () => { S.rig.style = b.dataset.v; onRigChanged(); };
  });
  $('#headScale').oninput = (e) => { S.rig.headScale = +e.target.value; onRigChanged(); };

  $('#btnEars').onclick = () => {
    const R = S.rig;
    if (R.ears.length) R.ears = [];
    else {
      R.ears = [
        { x: clamp(R.head.x - R.head.r * 0.5, 0, R.w), y: clamp(R.head.y - R.head.r * 1.3, 0, R.h) },
        { x: clamp(R.head.x + R.head.r * 0.5, 0, R.w), y: clamp(R.head.y - R.head.r * 1.35, 0, R.h) },
      ];
    }
    onRigChanged();
  };
  $('#btnTail').onclick = () => {
    const R = S.rig;
    if (R.tail) R.tail = null;
    else {
      const f = R.facing || 1;
      const base = { x: clamp(R.torso.x - f * R.torso.r * 0.9, 0, R.w), y: clamp(R.torso.y - R.torso.r * 0.3, 0, R.h) };
      const tip = { x: clamp(base.x - f * R.torso.r * 1.3, 0, R.w), y: clamp(base.y - R.torso.r * 1.1, 0, R.h) };
      R.tail = { base, tip, width: R.torso.r * 0.25 };
      retraceTailPath();
    }
    onRigChanged();
  };

  window.addEventListener('resize', () => {
    if (S.step === 2 && S.analysis) { fitStage(); drawMarkers(); }
  });
}

// ---------- shared pose preview ----------
function drawPoseTile(canvas, action, t) {
  const k = dpr();
  const cw = Math.round(TILE_W * k), ch = Math.round(TILE_H * k);
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  const ctx = canvas.getContext('2d');
  const R = S.rig;
  const groundY = ch - 34 * k;
  const fit = Math.min((cw * 0.6) / R.w, (ch * 0.56) / R.h);
  const loopT = (t % action.dur) / action.dur;
  const r = getRenderer();
  r.render(POSES[action.id](loopT, R), { width: cw, height: ch, scale: fit, anchorX: cw / 2, anchorY: groundY });

  let lift = 0;
  if (action.lift) {
    const u = (loopT - action.lift.from) / (action.lift.to - action.lift.from);
    if (u > 0 && u < 1) lift = Math.sin(Math.PI * u) * action.lift.height * R.h * fit;
  }
  ctx.clearRect(0, 0, cw, ch);

  ctx.strokeStyle = 'rgba(90, 70, 50, 0.25)';
  ctx.lineWidth = 2 * k;
  if (action.kind === 'move') {
    const dash = 16 * k;
    const off = (t * action.speed * R.h * fit) % (dash * 2);
    ctx.setLineDash([dash, dash]);
    ctx.lineDashOffset = R.facing === -1 ? -off : off;
  }
  ctx.beginPath();
  ctx.moveTo(14 * k, groundY + k);
  ctx.lineTo(cw - 14 * k, groundY + k);
  ctx.stroke();
  ctx.setLineDash([]);

  const h = R.h * fit;
  const air = Math.min(0.7, lift / h);
  ctx.fillStyle = `rgba(60, 40, 20, ${0.14 * (1 - air)})`;
  ctx.beginPath();
  ctx.ellipse(cw / 2, groundY, R.w * fit * 0.42 * (1 - 0.3 * air), 5 * k, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.drawImage(r.canvas, 0, -lift);
  if (action.effect) {
    const ex = cw / 2 + (R.head.x - R.w / 2) * fit;
    const ey = groundY - lift + (R.head.y - R.head.r - R.ground) * fit;
    drawEffect(ctx, action.effect, t, ex, ey, h);
  }
}

function liveActions() {
  return CATALOG.filter((a) => ['rest', 'look', 'walk', 'wag', 'happy'].includes(a.id) && actionAvailable(a, S.rig));
}

function drawLive(t) {
  const list = liveActions();
  const slot = 2.6;
  const a = list[Math.floor(t / slot) % list.length];
  $('#liveLabel').textContent = `Live check · ${a.name}`;
  drawPoseTile($('#liveCanvas'), a, t);
}

// ---------- step 3: movement poses ----------
function enabledActions() {
  if (!S.rig) return [];
  return CATALOG.filter((a) => S.selected.has(a.id) && (a.required || S.enabled.has(a.id)) && actionAvailable(a, S.rig));
}

function enterPoses() {
  $('#posesLede').textContent = `See how ${S.name} rests, looks at you and moves before the final animation is rendered.`;
  const root = $('#poseGroups');
  root.innerHTML = '';
  S.tiles = [];
  for (const g of GROUPS) {
    const acts = CATALOG.filter((a) => a.group === g.id && S.selected.has(a.id));
    if (!acts.length) continue;
    const sec = el('section', 'pose-group');
    const head = el('div', 'pose-group-head');
    head.append(el('h3', null, g.title), el('span', null, g.blurb));
    sec.append(head);
    const grid = el('div', 'tiles');
    for (const a of acts) {
      const avail = actionAvailable(a, S.rig);
      const tile = el('div', 'tile');
      const canvas = document.createElement('canvas');
      const foot = el('div', 'tile-foot');
      const txt = el('div');
      const note = avail ? a.desc : a.needs === 'tail' ? 'Needs a tail — add one in Review the look' : 'Needs ears — add them in Review the look';
      txt.append(el('strong', null, a.name), el('span', null, note));
      const sw = el('label', 'switch');
      sw.title = a.required ? 'Always included' : 'Include in the final animation';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = avail && (a.required || S.enabled.has(a.id));
      cb.disabled = !avail || !!a.required;
      cb.onchange = () => {
        if (cb.checked) S.enabled.add(a.id);
        else S.enabled.delete(a.id);
        tile.classList.toggle('off', !cb.checked);
        S.dirty = true;
        updateFooter();
      };
      sw.append(cb, el('span'));
      tile.classList.toggle('off', !cb.checked);
      tile.classList.toggle('unavailable', !avail);
      foot.append(txt, sw);
      tile.append(canvas, foot);
      grid.append(tile);
      S.tiles.push({ canvas, action: a });
    }
    sec.append(grid);
    root.append(sec);
  }
}

async function runRender() {
  if (S.pkg && !S.dirty) return;
  showBusy('Rendering the final animation', 'Preparing…', 0);
  const pkg = await buildPackage({
    renderer: getRenderer(),
    rig: S.rig,
    sprite: S.sprite,
    actions: enabledActions(),
    name: S.name,
    uid: S.uid,
    personality: S.personality,
    coat: S.analysis.coat,
  }, (msg, frac) => updateBusy(msg, frac));
  await finishPackage(pkg);
}

async function finishPackage(pkg) {
  pkg.images = {};
  await Promise.all(Object.entries(pkg.previews).map(async ([id, url]) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    pkg.images[id] = img;
  }));
  if (S.pkg) Object.values(S.pkg.previews).forEach((u) => URL.revokeObjectURL(u));
  S.pkg = pkg;
  S.dirty = false;
  S.imported = false;
  hideBusy();
  console.log('[package]', JSON.stringify({ bytes: pkg.bytes.length, frames: pkg.totalFrames, actions: pkg.manifest.actions.map((a) => a.id), frame: pkg.manifest.frame }));
}

// ---------- step 4: bring it to the desktop ----------
function enterDesktop() {
  const { manifest, bytes, totalFrames } = S.pkg;
  $('#pkgName').textContent = manifest.name;
  const facts = $('#pkgFacts');
  facts.innerHTML = '';
  const add = (k, v) => facts.append(el('dt', null, k), el('dd', null, v));
  const acts = manifest.actions.filter((a) => !a.system);
  add('Actions', `${acts.length} + carrying pose`);
  add('Animation', `${totalFrames} frames at ${manifest.fps} fps`);
  add('Personality', PERSONALITIES.find((p) => p.id === manifest.personality).name);
  add('Coat', manifest.coat.label);
  add('Package', `${(bytes.length / 1e6).toFixed(1)} MB · ${manifest.name}.companion`);
  $('#importDone').hidden = !S.imported;
  $('#btnImport').textContent = S.imported ? 'Import again' : 'Import to desktop';
}

function drawPkg(t) {
  const { manifest, images } = S.pkg;
  const canvas = $('#pkgCanvas');
  const k = dpr();
  const cw = Math.round(480 * k), ch = Math.round(360 * k);
  if (canvas.width !== cw) { canvas.width = cw; canvas.height = ch; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, cw, ch);

  const acts = manifest.actions.filter((a) => !a.system);
  const slots = acts.map((a) => Math.max(2.4, a.dur * (a.kind === 'once' ? a.loops : 3)));
  const total = slots.reduce((x, y) => x + y, 0);
  let local = t % total, i = 0;
  while (local > slots[i]) { local -= slots[i]; i++; }
  const a = acts[i];
  $('#pkgAction').textContent = a.name;

  const F = a.frame || manifest.frame;
  const frame = a.kind === 'once'
    ? Math.min(a.frames * a.loops - 1, Math.floor(local * manifest.fps)) % a.frames
    : Math.floor(local * manifest.fps) % a.frames;
  const size = ch * 0.42;
  const s = size / F.spriteH;
  const groundY = ch * 0.86;
  let lift = 0;
  if (a.lift) {
    const u = ((local % a.dur) / a.dur - a.lift.from) / (a.lift.to - a.lift.from);
    if (u > 0 && u < 1) lift = Math.sin(Math.PI * u) * a.lift.height * size;
  }
  ctx.drawImage(images[a.id], (frame % a.cols) * F.w, Math.floor(frame / a.cols) * F.h, F.w, F.h,
    cw / 2 - F.anchorX * s, groundY - lift - F.anchorY * s, F.w * s, F.h * s);
  if (a.effect) {
    const r = manifest.rig;
    const fx = a.fx != null ? a.fx : (r.head.x - r.w / 2) / r.h;
    const fy = a.fy != null ? a.fy : (r.head.y - r.head.r - r.ground) / r.h;
    drawEffect(ctx, a.effect, local, cw / 2 + fx * size, groundY - lift + fy * size, size);
  }
}

async function importBytes(bytes, fromStudio) {
  try {
    const res = await api.importPackage(bytes);
    if (fromStudio) {
      S.imported = true;
      const done = $('#importDone');
      done.textContent = `${res.name} is on your desktop now. Look just above your taskbar!`;
      done.hidden = false;
      $('#btnImport').textContent = 'Import again';
    }
    toast(`${res.name} is on your desktop`);
    return res;
  } catch (err) {
    toast(cleanError(err), true);
    return null;
  }
}

function initStep4() {
  $('#btnImport').onclick = () => importBytes(S.pkg.bytes, true);
  $('#btnSave').onclick = async () => {
    try {
      const p = await api.savePackage(S.pkg.bytes, S.pkg.manifest.name);
      if (p) toast(`Saved to ${p}`);
    } catch (err) {
      toast(cleanError(err), true);
    }
  };
}

// ---------- animation loop ----------
const t0 = performance.now();
function loop(now) {
  const t = (now - t0) / 1000;
  try {
    if (S.mode === 'bird' && S.step === 2) bird.drawLook(t);
    else if (S.mode === 'bird' && S.step === 3) bird.drawCards(t);
    else if (S.step === 2 && S.analysis) drawLive(t);
    else if (S.step === 3 && S.analysis) for (const tile of S.tiles) drawPoseTile(tile.canvas, tile.action, t);
    else if (S.step === 4 && S.pkg) drawPkg(t);
  } catch (err) {
    console.error(err);
  }
  requestAnimationFrame(loop);
}

// ---------- self-test (npm run selftest) ----------
async function selftest(info) {
  const shot = (name) => api.capture(name);
  if (!info.image) return selftestBird(shot);
  setMode('photo');
  try {
    setPhoto(info.image ? new Blob([info.image]) : await makeSamplePhoto());
    setName('Mochi');
    await sleep(500);
    await shot('1-upload');
    await advance();
    await sleep(1200);
    await shot('2-look');
    await advance();
    await sleep(1500);
    await shot('3-poses');
    $('#main').scrollTop = 99999;
    await sleep(600);
    await shot('3-poses-bottom');
    await advance();
    await sleep(1000);
    await shot('4-desktop');
    const res = await api.importPackage(S.pkg.bytes);
    console.log('[selftest] imported', JSON.stringify(res));
    for (let i = 1; i <= 4; i++) {
      await sleep(2500);
      await shot(`overlay-${i}`);
    }
    api.selftestDone(true);
  } catch (err) {
    console.error('[selftest] error', err?.stack || err);
    api.selftestDone(false);
  }
}

async function selftestBird(shot) {
  try {
    await sleep(400);
    await shot('b1-upload');
    await advance();
    await sleep(2500);
    await shot('b2-look');
    await advance();
    await sleep(4000);
    await shot('b3-poses');
    $('#main').scrollTop = 99999;
    await sleep(2500);
    await shot('b3-poses-bottom');
    await advance();
    await sleep(1200);
    await shot('b4-desktop');
    const res = await api.importPackage(S.pkg.bytes);
    console.log('[selftest] imported', JSON.stringify(res), 'bytes', S.pkg.bytes.length);
    for (let i = 1; i <= 6; i++) {
      await sleep(2200);
      await shot(`overlay-${i}`);
    }
    api.selftestDone(true);
  } catch (err) {
    console.error('[selftest] error', err?.stack || err);
    api.selftestDone(false);
  }
}

// ---------- boot ----------
initStep1();
initStep2();
initStep4();
bird.init();
setMode('bird');
$('#btnNext').onclick = onNext;
$('#btnBack').onclick = () => goTo(S.step - 1);
$$('#stepper li').forEach((li) => {
  li.onclick = () => { const n = +li.dataset.step; if (n < S.step) goTo(n); };
});
$('#btnImportPkg').onclick = async () => {
  const r = await api.pickAndImport();
  if (r) toast(`${r.name} is on your desktop`);
};
goTo(1);
requestAnimationFrame(loop);
api.selftestInfo().then((info) => { if (info.on) selftest(info); });
