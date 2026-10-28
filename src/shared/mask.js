// Alpha-mask clean-up shared by the cut-out tools.

// Morphological opening of the alpha mask: removes hairlines and 1-3 px slivers.
export function openAlpha(alpha, w, h, r = 2) {
  const tmp = new Uint8Array(w * h);
  const pass = (src, dst, pick) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = pick === 'min' ? 255 : 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) { if (pick === 'min') m = 0; continue; }
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          const v = xx < 0 || xx >= w ? 0 : src[yy * w + xx];
          m = pick === 'min' ? Math.min(m, v) : Math.max(m, v);
        }
      }
      dst[y * w + x] = m;
    }
  };
  pass(alpha, tmp, 'min');
  const opened = new Uint8Array(w * h);
  pass(tmp, opened, 'max');
  for (let i = 0; i < alpha.length; i++) alpha[i] = Math.min(alpha[i], opened[i]);
}

// Clears detached pieces smaller than `keep` times the largest one.
export function dropScraps(canvas, keep = 0.05) {
  const w = canvas.width, h = canvas.height, g = canvas.getContext('2d', { willReadFrequently: true });
  const id = g.getImageData(0, 0, w, h);
  const d = id.data;
  const label = new Int32Array(w * h).fill(-1);
  const sizes = [];
  for (let s0 = 0; s0 < w * h; s0++) {
    if (d[s0 * 4 + 3] < 20 || label[s0] >= 0) continue;
    const id0 = sizes.length;
    let n = 0;
    const stack = [s0];
    label[s0] = id0;
    while (stack.length) {
      const i = stack.pop();
      n++;
      const x = i % w, y = (i / w) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && label[j] < 0 && d[j * 4 + 3] >= 20) { label[j] = id0; stack.push(j); }
      }
    }
    sizes.push(n);
  }
  const big = Math.max(...sizes);
  for (let i = 0; i < w * h; i++) if (label[i] >= 0 && sizes[label[i]] < big * keep) d[i * 4 + 3] = 0;
  g.putImageData(id, 0, 0);
  return canvas;
}
