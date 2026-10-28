// Little overlays drawn above a companion: hearts, Zzz, music notes and a spawn poof.
// Everything is a pure function of elapsed time, so previews and the desktop match.

function heart(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.3);
  ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.78, x, y + s);
  ctx.bezierCurveTo(x, y + s * 0.78, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3);
  ctx.fill();
}

// (x, y) is the point just above the companion's head; size is its height in px.
export function drawEffect(ctx, kind, time, x, y, size) {
  ctx.save();
  if (kind === 'hearts') {
    for (let i = 0; i < 4; i++) {
      const ph = (time * 0.9 + i / 4) % 1;
      const px = x + (i - 1.5) * size * 0.16 + Math.sin(ph * 6 + i) * size * 0.05;
      const py = y - ph * size * 0.55;
      ctx.globalAlpha = Math.sin(Math.PI * ph);
      ctx.fillStyle = i % 2 ? '#ff6f91' : '#ff4f6d';
      heart(ctx, px, py, size * (0.09 + 0.06 * ph));
    }
  } else if (kind === 'zzz' || kind === 'notes') {
    const glyphs = kind === 'zzz' ? ['z', 'Z', 'z'] : ['♪', '♫', '♪'];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let i = 0; i < 3; i++) {
      const ph = (time * (kind === 'zzz' ? 0.42 : 0.7) + i / 3) % 1;
      const px = x + size * 0.12 + ph * size * 0.32 + (kind === 'notes' ? Math.sin(ph * 9) * size * 0.05 : 0);
      const py = y - ph * size * 0.45;
      const fs = size * (0.11 + 0.1 * ph);
      ctx.font = `700 ${fs}px "Segoe UI", system-ui, sans-serif`;
      ctx.globalAlpha = Math.sin(Math.PI * ph);
      ctx.lineWidth = Math.max(2, fs * 0.16);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeText(glyphs[i], px, py);
      ctx.fillStyle = kind === 'zzz' ? '#5b6cff' : '#e2672f';
      ctx.fillText(glyphs[i], px, py);
    }
  } else if (kind === 'poof') {
    const t = Math.min(1, time / 0.8);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      const r = size * (0.15 + 0.45 * t);
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = i % 2 ? '#ffd166' : '#ffffff';
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.7, size * 0.05 * (1 - t * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
