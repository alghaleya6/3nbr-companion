// Dev tool: builds the AI pose pack for 3nbr and lays out every pose on one sheet.
// ?frame=0.3 picks the loop phase shown, ?size the bird's on-screen size, ?only=a|b the
// poses; ?save writes assets/3nbr.companion.
import { loadAiCuts, renderAiPose, buildAiPack, AI_SPRITE_H } from '../studio/aipack.js';
import { LOVEBIRD_POSES } from '../shared/lovebirdPoses.js';
import { RigRenderer } from '../shared/rig.js';

async function main() {
  const params = new URLSearchParams(location.search);
  const phase = Number(params.get('frame') ?? 0.3);
  const cuts = await loadAiCuts();
  const renderer = new RigRenderer();
  let poses = [...LOVEBIRD_POSES, { id: 'held', name: 'Carried', dur: 0.6 }];
  if (params.get('only')) poses = poses.filter((p) => params.get('only').split('|').includes(p.id));
  const size = Number(params.get('size') ?? 150); // on-screen size, as on the desktop
  const cols = Number(params.get('cols') ?? 7), cellW = Math.round(268 * size / 150), cellH = Math.round(294 * size / 150) + 36;
  const sheet = document.createElement('canvas');
  sheet.width = cellW * cols;
  sheet.height = cellH * Math.ceil(poses.length / cols);
  const g = sheet.getContext('2d');
  for (const [k, spec] of poses.entries()) {
    const r = renderAiPose(renderer, cuts, spec.id, spec.dur);
    const x = (k % cols) * cellW, y = Math.floor(k / cols) * cellH;
    g.fillStyle = k % 2 ? '#dfe6ee' : '#ece6dd';
    g.fillRect(x, y, cellW, cellH);
    g.fillStyle = '#3b4a5e';
    g.fillRect(x, y + cellH - 36, cellW, 36);
    const fi = Math.floor(r.frames * phase);
    const s = size / AI_SPRITE_H;
    const ax = x + cellW / 2, ay = y + cellH - 36;
    g.drawImage(r.sheet, (fi % r.cols) * r.fw, Math.floor(fi / r.cols) * r.fh, r.fw, r.fh,
      ax - r.anchorX * s, ay - r.anchorY * s, r.fw * s, r.fh * s);
    // Anchor, head marker and effect point.
    g.fillStyle = '#e33';
    g.fillRect(ax - 3, ay - 3, 6, 6);
    g.strokeStyle = '#2a7';
    g.beginPath();
    g.arc(ax + r.hx * size, ay + r.hy * size, 6, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#222';
    g.font = '600 14px Segoe UI';
    g.fillText(`${spec.name}  ${r.fw}×${r.fh}×${r.frames}`, x + 6, y + 18);
  }
  document.body.append(sheet);
  if (params.has('save')) {
    const pack = await buildAiPack({ renderer, cuts, name: '3nbr', uid: '3nbr-ai0001', personality: 'playful' });
    console.log(`[aipack] ${pack.bytes.length} bytes, ${pack.totalFrames} frames`);
    await window.companion.devSave('assets/3nbr.companion', pack.bytes);
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  document.title = 'ready';
}

main().catch((e) => { console.error(e?.stack || e); document.title = 'ready'; });
