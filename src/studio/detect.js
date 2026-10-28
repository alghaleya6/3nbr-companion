// Finds the face, ears, tail, torso and feet on a cut-out pet silhouette.
// Works on shape alone: a distance transform locates the round masses (head, torso),
// radial profiles locate thin protrusions (ears around the head, tail around the body).

function distanceTransform(m, W, H) {
  const INF = 1e9;
  const d = new Float32Array(W * H);
  for (let i = 0; i < d.length; i++) d[i] = m[i] ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : d[y * W + x]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

// Farthest distance reachable from (cx, cy) along a ray while staying on the pet
// (tiny gaps of a pixel or so are tolerated).
function radial(m, W, H, cx, cy, ang, maxD) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let last = 0, gap = 0;
  for (let d = 0; d <= maxD; d += 0.5) {
    const x = Math.round(cx + dx * d), y = Math.round(cy + dy * d);
    if (x < 0 || y < 0 || x >= W || y >= H) break;
    if (m[y * W + x]) { last = d; gap = 0; } else { gap += 0.5; if (gap > 1.5) break; }
  }
  return last;
}

// Walks outward along a thin limb, staying on its ridge, until the limb ends.
function traceRidge(m, dt, W, H, start, dir, maxLen, maxThick) {
  let p = { ...start };
  let a0 = Math.atan2(dir.y, dir.x);
  for (let len = 0; len < maxLen; len += 1.5) {
    let best = null, bestV = 0;
    for (let da = -60; da <= 60; da += 10) {
      const a = a0 + (da * Math.PI) / 180;
      const x = p.x + Math.cos(a) * 1.5, y = p.y + Math.sin(a) * 1.5;
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= W || yi >= H || !m[yi * W + xi]) continue;
      const v = dt[yi * W + xi] - Math.abs(da) / 600;
      if (v > bestV) { bestV = v; best = { x, y, a }; }
    }
    if (!best || bestV > maxThick) break;
    a0 = a0 * 0.6 + best.a * 0.4;
    p = { x: best.x, y: best.y };
  }
  return p;
}

// Cheapest path from a to b inside the shape, preferring its centre line.
function medialPath(m, dt, W, H, a, b) {
  const idx = (p) => Math.round(p.y) * W + Math.round(p.x);
  const start = idx(a), goal = idx(b);
  if (!m[start] || !m[goal]) return null;
  const cost = new Float64Array(W * H).fill(Infinity);
  const prev = new Int32Array(W * H).fill(-1);
  const heap = [[0, start]];
  cost[start] = 0;
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (heap[j][0] <= heap[i][0]) break;
      [heap[i], heap[j]] = [heap[j], heap[i]];
      i = j;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let s = i;
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
        if (s === i) break;
        [heap[i], heap[s]] = [heap[s], heap[i]];
        i = s;
      }
    }
    return top;
  };
  while (heap.length) {
    const [c, i] = pop();
    if (i === goal) break;
    if (c > cost[i]) continue;
    const x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx;
        if (!m[j]) continue;
        const nc = c + Math.hypot(dx, dy) * (1 + 2 / (dt[j] + 0.5));
        if (nc < cost[j]) { cost[j] = nc; prev[j] = i; push([nc, j]); }
      }
    }
  }
  if (prev[goal] < 0) return null;
  const pts = [];
  for (let i = goal; i >= 0; i = prev[i]) pts.push({ x: i % W, y: (i / W) | 0 });
  pts.reverse();
  const out = pts.filter((_, i) => i % 3 === 0);
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  out[0] = { ...a };
  out[out.length - 1] = { ...b };
  return out;
}

function gridMask(alpha, w, h) {
  const k = Math.min(1, 160 / Math.max(w, h));
  const W = Math.max(8, Math.round(w * k));
  const H = Math.max(8, Math.round(h * k));
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, Math.floor((x + 0.5) / k));
      const sy = Math.min(h - 1, Math.floor((y + 0.5) / k));
      if (alpha[sy * w + sx] > 127) m[y * W + x] = 1;
    }
  }
  return { k, W, H, m };
}

function nearestInside(m, W, H, p, radius) {
  const x0 = Math.round(p.x), y0 = Math.round(p.y);
  let best = null, bd = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= W || y >= H || !m[y * W + x]) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = { x, y }; }
    }
  }
  return best;
}

// Rebuilds the tail's centre line after you move its markers (sprite coordinates).
export function retraceTail(alpha, w, h, base, tip) {
  const { k, W, H, m } = gridMask(alpha, w, h);
  const dt = distanceTransform(m, W, H);
  const a = nearestInside(m, W, H, { x: base.x * k, y: base.y * k }, 4);
  const b = nearestInside(m, W, H, { x: tip.x * k, y: tip.y * k }, 4);
  if (!a || !b) return null;
  const path = medialPath(m, dt, W, H, a, b);
  return path ? path.map((p) => ({ x: p.x / k, y: p.y / k })) : null;
}

function localMaxima(arr, win, minVal) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] < minVal) continue;
    let ok = true;
    for (let j = -win; j <= win && ok; j++) {
      if (j && arr[(i + j + arr.length) % arr.length] > arr[i]) ok = false;
    }
    if (ok) out.push(i);
  }
  return out;
}

// Main direction of the shape within radius r of c, oriented away from `away`.
function limbDirection(m, W, H, c, r, away) {
  let n = 0, mx = 0, my = 0;
  const pts = [];
  for (let y = Math.floor(c.y - r); y <= c.y + r; y++) {
    for (let x = Math.floor(c.x - r); x <= c.x + r; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H || !m[y * W + x]) continue;
      if ((x - c.x) ** 2 + (y - c.y) ** 2 > r * r) continue;
      pts.push(x, y); mx += x; my += y; n++;
    }
  }
  if (n < 3) return { x: c.x - away.x, y: c.y - away.y };
  mx /= n; my /= n;
  let cxx = 0, cyy = 0, cxy = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const dx = pts[i] - mx, dy = pts[i + 1] - my;
    cxx += dx * dx; cyy += dy * dy; cxy += dx * dy;
  }
  const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const d = { x: Math.cos(ang), y: Math.sin(ang) };
  return (c.x - away.x) * d.x + (c.y - away.y) * d.y >= 0 ? d : { x: -d.x, y: -d.y };
}

export function detectParts(alpha, w, h) {
  const { k, W, H, m } = gridMask(alpha, w, h);
  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error('No pet shape found.');
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const ground = maxY;
  const dt = distanceTransform(m, W, H);

  // Round masses: local maxima of the distance transform.
  let maxDT = 0, tI = 0;
  for (let i = 0; i < dt.length; i++) if (dt[i] > maxDT) { maxDT = dt[i]; tI = i; }
  let torso = { x: tI % W, y: Math.floor(tI / W), r: maxDT };
  const peaks = [];
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      const v = dt[y * W + x];
      if (v < maxDT * 0.2) continue;
      let ok = true;
      for (let j = -2; j <= 2 && ok; j++) for (let i = -2; i <= 2; i++) if (dt[(y + j) * W + x + i] > v) { ok = false; break; }
      if (ok && !peaks.some((p) => Math.hypot(p.x - x, p.y - y) < p.r * 0.6)) peaks.push({ x, y, r: v });
    }
  }

  // Head: a big round mass, high up. Torso: the biggest mass overall.
  let head = torso, best = -1;
  for (const p of peaks) {
    if (p.r < torso.r * 0.32) continue;
    const hf = (ground - p.y) / bh;
    const score = p.r * hf * hf;
    if (score > best) { best = score; head = p; }
  }
  if (Math.hypot(head.x - torso.x, head.y - torso.y) < torso.r * 0.5) {
    // Close-up portrait: the head is the biggest mass. Put the torso below it.
    let sx = 0, sy = 0, n = 0;
    for (let y = Math.ceil(head.y + head.r); y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) { sx += x; sy += y; n++; }
    torso = n > 20
      ? { x: sx / n, y: sy / n, r: Math.max(dt[Math.round(sy / n) * W + Math.round(sx / n)], head.r * 0.6) }
      : { x: head.x, y: Math.min(ground, head.y + head.r * 1.5), r: head.r * 0.8 };
  }
  const R = head.r * 1.2;

  const dx = head.x - torso.x;
  const facing = Math.abs(dx) < torso.r * 0.45 ? 0 : Math.sign(dx);
  const style = facing !== 0 && bw / bh > 1.1 ? 'walk' : 'hop';

  // Ears: peaks in the head outline, pointing upward.
  const angs = [];
  const prof = [];
  for (let a = -150; a <= -30; a += 2) {
    angs.push((a * Math.PI) / 180);
    prof.push(radial(m, W, H, head.x, head.y, (a * Math.PI) / 180, R * 2.6));
  }
  const earCands = [];
  // Peaks at the ends of the sweep are the snout or the back, not ears.
  for (let i = 3; i < prof.length - 3; i++) {
    if (prof[i] < R * 1.25) continue;
    let isMax = true;
    for (let j = Math.max(0, i - 3); j <= Math.min(prof.length - 1, i + 3); j++) if (prof[j] > prof[i]) isMax = false;
    if (!isMax) continue;
    const lo = Math.max(0, i - 12), hi = Math.min(prof.length - 1, i + 12);
    let minL = Infinity, minR = Infinity;
    for (let j = lo; j < i; j++) minL = Math.min(minL, prof[j]);
    for (let j = i + 1; j <= hi; j++) minR = Math.min(minR, prof[j]);
    if (prof[i] - Math.max(minL, minR) < R * 0.18) continue;
    earCands.push({ ang: angs[i], d: prof[i] });
  }
  earCands.sort((a, b) => b.d - a.d);
  const ears = [];
  for (const c of earCands) {
    if (ears.length >= 2) break;
    if (ears.some((e) => Math.abs(e.ang - c.ang) < (20 * Math.PI) / 180)) continue;
    ears.push(c);
  }
  const earTips = ears
    .map((e) => ({ x: head.x + Math.cos(e.ang) * e.d, y: head.y + Math.sin(e.ang) * e.d }))
    .sort((a, b) => a.x - b.x);

  // Tail: a long, thin protrusion away from the head that isn't a leg.
  let tail = null, tailScore = 0;
  const maxD = Math.max(bw, bh) * 1.2;
  const tprof = [];
  for (let a = 0; a < 360; a += 3) tprof.push(radial(m, W, H, torso.x, torso.y, (a * Math.PI) / 180, maxD));
  for (const i of localMaxima(tprof, 2, torso.r * 1.4)) {
    const ang = (i * 3 * Math.PI) / 180;
    const T = { x: torso.x + Math.cos(ang) * tprof[i], y: torso.y + Math.sin(ang) * tprof[i] };
    if (Math.hypot(T.x - head.x, T.y - head.y) < R * 1.6) continue;
    if (earTips.some((e) => Math.hypot(T.x - e.x, T.y - e.y) < R * 0.6)) continue;
    if (T.y > ground - bh * 0.12 && Math.sin(ang) > 0.5) continue; // a paw
    const len = Math.hypot(T.x - torso.x, T.y - torso.y);
    const ux = (torso.x - T.x) / len, uy = (torso.y - T.y) / len;
    const thick = [];
    let B = null;
    for (let s = 0; s < len; s += 0.5) {
      const x = Math.round(T.x + ux * s), y = Math.round(T.y + uy * s);
      const v = dt[y * W + x] || 0;
      if (v >= torso.r * 0.5) { B = { x: T.x + ux * s, y: T.y + uy * s }; break; }
      if (v > 0) thick.push(v);
    }
    if (!B || thick.length < 3) continue;
    thick.sort((a, b) => a - b);
    const thickness = thick[Math.floor(thick.length / 2)];
    if (thickness > torso.r * 0.38) continue;

    // A curved tail leaves the straight ray early: hop onto its centre line and
    // follow it to the real tip, then take the centre line back to the base.
    let ridge = T, rv = -1;
    const sr = Math.ceil(thickness * 2 + 1);
    for (let y = Math.round(T.y) - sr; y <= T.y + sr; y++) {
      for (let x = Math.round(T.x) - sr; x <= T.x + sr; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H || !m[y * W + x]) continue;
        if (dt[y * W + x] > rv && dt[y * W + x] <= thickness * 2.5) { rv = dt[y * W + x]; ridge = { x, y }; }
      }
    }
    const dir = limbDirection(m, W, H, ridge, Math.max(3, thickness * 2.5), B);
    const tip = traceRidge(m, dt, W, H, ridge, dir, Math.max(bw, bh), Math.max(thickness * 2.5, 2));
    const path = medialPath(m, dt, W, H, { x: Math.round(B.x), y: Math.round(B.y) }, { x: Math.round(tip.x), y: Math.round(tip.y) })
      || [B, tip];
    let L = 0;
    for (let j = 1; j < path.length; j++) L += Math.hypot(path[j].x - path[j - 1].x, path[j].y - path[j - 1].y);
    if (L < torso.r * 0.5) continue;
    const back = facing ? -((tip.x - torso.x) * facing) : 1;
    const score = (L / (thickness + 0.5)) * (facing ? (back > 0 ? 1.5 : 0.3) : 1);
    if (score > tailScore) { tailScore = score; tail = { base: path[0], tip: path[path.length - 1], width: thickness, path }; }
  }

  // Feet: the lowest band of the silhouette.
  let fMin = W, fMax = -1;
  for (let y = Math.floor(ground - bh * 0.06); y <= ground; y++) {
    for (let x = 0; x < W; x++) if (m[y * W + x]) { fMin = Math.min(fMin, x); fMax = Math.max(fMax, x); }
  }

  const s = 1 / k;
  const P = (p) => ({ x: p.x * s, y: p.y * s });
  return {
    w,
    h,
    ground: (ground + 1) * s,
    facing,
    style,
    headScale: 1,
    head: { ...P(head), r: R * s },
    torso: { ...P(torso), r: torso.r * s },
    ears: earTips.map(P),
    tail: tail ? { base: P(tail.base), tip: P(tail.tip), width: tail.width * s, path: tail.path.map(P) } : null,
    feet: { min: fMin * s, max: (fMax + 1) * s },
  };
}
