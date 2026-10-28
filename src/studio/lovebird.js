// Studio track for 3nbr's pose pack: name -> AI look -> live pose cards -> package.
import { LOVEBIRD_POSES } from '../shared/lovebirdPoses.js';
import { PERSONALITIES, FPS } from '../shared/actions.js';
import { drawEffect } from '../shared/effects.js';
import { loadAiCuts, renderAiPose, buildAiPack, AI_SPRITE_H } from './aipack.js';

const LOOK_PREVIEWS = ['look', 'stretch', 'kiss', 'snack'];

export function createLovebird({ getRenderer, $, el, dpr, onChange }) {
  const B = {
    name: '3nbr',
    personality: 'playful',
    enabled: new Set(LOVEBIRD_POSES.map((p) => p.id)),
    cuts: null,
    previews: new Map(),
    cards: [],
  };

  // ---------- step 1 ----------
  function renderChecklist() {
    const box = $('#birdChecklist');
    box.innerHTML = '';
    for (const p of LOVEBIRD_POSES) {
      const on = p.required || B.enabled.has(p.id);
      const lab = el('label', on ? 'on' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = on;
      cb.disabled = !!p.required;
      cb.onchange = () => {
        if (cb.checked) B.enabled.add(p.id); else B.enabled.delete(p.id);
        lab.classList.toggle('on', cb.checked);
        updateCount();
        onChange();
      };
      lab.append(cb, document.createTextNode(p.name));
      box.append(lab);
    }
    updateCount();
  }

  function updateCount() {
    $('#birdPoseCount').textContent = `${enabledPoses().length} of ${LOVEBIRD_POSES.length} selected`;
  }

  function init() {
    const pbox = $('#birdPersonality');
    for (const p of PERSONALITIES) {
      const b = el('button', 'chip', p.name);
      b.onclick = () => {
        B.personality = p.id;
        [...pbox.children].forEach((c) => c.classList.toggle('on', c === b));
        onChange();
      };
      if (p.id === B.personality) b.classList.add('on');
      pbox.append(b);
    }
    const nameInput = $('#birdName');
    nameInput.value = B.name;
    nameInput.addEventListener('input', () => { B.name = nameInput.value.trim(); onChange(); });
    renderChecklist();
  }

  const enabledPoses = () => LOVEBIRD_POSES.filter((p) => p.required || B.enabled.has(p.id));

  async function ready() {
    if (!B.cuts) B.cuts = await loadAiCuts();
  }

  // ---------- previews ----------
  // Builds at most one missing preview per call so the UI stays responsive.
  function preview(id) {
    if (!B.cuts) return null;
    let pv = B.previews.get(id);
    if (!pv && !B.builtThisFrame) {
      B.builtThisFrame = true;
      const spec = LOVEBIRD_POSES.find((p) => p.id === id);
      pv = { ...renderAiPose(getRenderer(), B.cuts, id, spec.dur), spec };
      B.previews.set(id, pv);
    }
    return pv || null;
  }

  function drawTile(canvas, id, t, w = 320, h = 240) {
    const k = dpr();
    const cw = Math.round(w * k), ch = Math.round(h * k);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const ctx = canvas.getContext('2d');
    const pv = preview(id);
    ctx.clearRect(0, 0, cw, ch);
    if (!pv) return;
    // Scale so the bird is the same size on every card; wide props may run to the edge.
    const s = Math.min((ch * 0.8) / AI_SPRITE_H, (cw * 0.96) / pv.fw, (ch * 0.96) / pv.fh);
    const loopT = (t % (pv.frames / FPS)) / (pv.frames / FPS);
    const fi = Math.floor(loopT * pv.frames) % pv.frames;
    const gx = cw / 2 + (pv.anchorX - pv.fw / 2) * s, gy = ch - 6 * k;
    ctx.drawImage(pv.sheet, (fi % pv.cols) * pv.fw, Math.floor(fi / pv.cols) * pv.fh, pv.fw, pv.fh,
      gx - pv.anchorX * s, gy - pv.anchorY * s, pv.fw * s, pv.fh * s);
    if (pv.spec.effect) {
      const size = AI_SPRITE_H * s;
      drawEffect(ctx, pv.spec.effect, t, gx + pv.fx * size, gy + pv.fy * size, size);
    }
  }

  // ---------- step 2 ----------
  function enterLook() {
    const grid = $('#lookPreviews');
    grid.innerHTML = '';
    B.lookTiles = LOOK_PREVIEWS.map((id) => {
      const fig = el('figure');
      const c = document.createElement('canvas');
      fig.append(c, el('figcaption', null, LOVEBIRD_POSES.find((p) => p.id === id).name));
      grid.append(fig);
      return { c, id };
    });
    const facts = $('#birdFacts');
    facts.innerHTML = '';
    const add = (k, v) => facts.append(el('dt', null, k), el('dd', null, v));
    add('Name', B.name);
    add('Species', 'Lovebird');
    add('Personality', PERSONALITIES.find((p) => p.id === B.personality).name);
    add('Poses', `${enabledPoses().length} selected`);
  }

  function drawLook(t) {
    B.builtThisFrame = false;
    for (const tile of B.lookTiles || []) drawTile(tile.c, tile.id, t);
  }

  // ---------- step 3 ----------
  function enterPoses() {
    $('#birdPosesLede').textContent = `See how ${B.name} rests, looks at you and moves before the final animation is rendered.`;
    const box = $('#poseCards');
    box.innerHTML = '';
    B.cards = LOVEBIRD_POSES.map((p) => {
      const card = el('div', `pose-card${p.required || B.enabled.has(p.id) ? ' on' : ''}${p.required ? ' locked' : ''}`);
      const c = document.createElement('canvas');
      card.append(c, el('h4', null, p.name), el('p', null, p.desc), el('span', 'trigger', p.trigger), el('span', 'check'));
      if (!p.required) {
        card.onclick = () => {
          if (B.enabled.has(p.id)) B.enabled.delete(p.id); else B.enabled.add(p.id);
          card.classList.toggle('on', B.enabled.has(p.id));
          renderChecklist();
          onChange();
        };
      }
      box.append(card);
      return { c, id: p.id };
    });
  }

  function drawCards(t) {
    B.builtThisFrame = false;
    for (const card of B.cards) drawTile(card.c, card.id, t);
  }

  async function build(uid, onProgress) {
    await ready();
    return buildAiPack({
      renderer: getRenderer(), cuts: B.cuts, enabled: B.enabled,
      name: B.name, uid, personality: B.personality,
    }, onProgress);
  }

  return { B, init, ready, enterLook, drawLook, enterPoses, drawCards, build, enabledPoses };
}
