// Puppet rig: turns one cut-out sprite plus a handful of anchor points
// (face, ears, tail, torso, feet) into a deformable mesh and renders poses with WebGL2.
//
// A rig, in sprite pixels:
//   { w, h, ground, facing: 1 | -1 | 0, style: 'walk' | 'hop', headScale,
//     head: {x, y, r}, torso: {x, y, r}, ears: [{x, y}],
//     tail: {base, tip, width, path?: [{x, y}]} | null, feet: {min, max},
//     taps?: [{x, y, r}] }  - spots such as a foot on a key; pose.taps[i] lifts spot i by that many radii

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const hyp = Math.hypot;

// Expands the user-editable rig into the geometry the deformer needs.
export function deriveRig(rig) {
  const fwd = rig.facing === -1 ? -1 : 1;
  const { head, torso } = rig;

  let ndx = torso.x - head.x;
  let ndy = torso.y - head.y;
  let nd = hyp(ndx, ndy);
  if (nd < head.r * 0.5) { ndx = 0; ndy = 1; nd = 1; }
  ndx /= nd; ndy /= nd;
  const neckDist = Math.min(head.r * 1.0, hyp(torso.x - head.x, torso.y - head.y) * 0.6 || head.r);
  const neck = { x: head.x + ndx * neckDist, y: head.y + ndy * neckDist };

  const ears = rig.ears.map((tip) => {
    const d = hyp(tip.x - head.x, tip.y - head.y) || 1;
    const ux = (tip.x - head.x) / d;
    const uy = (tip.y - head.y) / d;
    const bd = Math.min(head.r * 0.7, d * 0.55);
    const base = { x: head.x + ux * bd, y: head.y + uy * bd };
    const len = Math.max(2, d - bd);
    // For a front-facing pet, "back" means outward from the face.
    const sign = rig.facing ? -fwd : tip.x < head.x ? -1 : 1;
    return { base, tip, ux, uy, len, sign };
  });

  // The tail follows its centre line (a polyline) so curved tails bend as one piece.
  let tail = null;
  if (rig.tail) {
    const pts = rig.tail.path?.length >= 2 ? rig.tail.path : [rig.tail.base, rig.tail.tip];
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hyp(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const len = Math.max(2, cum[cum.length - 1]);
    // Which way "up" turns this tail, judged from its first third.
    let ref = pts[pts.length - 1];
    for (let i = 0; i < pts.length; i++) if (cum[i] >= len * 0.35) { ref = pts[i]; break; }
    tail = {
      base: pts[0],
      pts,
      cum,
      len,
      width: rig.tail.width || len * 0.12,
      sign: ref.x < pts[0].x ? 1 : -1,
    };
  }

  const legTop = Math.min(Math.max(torso.y + torso.r * 0.45, rig.h * 0.35), rig.ground - rig.h * 0.12);
  const feet = rig.feet || { min: rig.w * 0.2, max: rig.w * 0.8 };

  return {
    ...rig,
    fwd,
    neck,
    neckDir: { x: ndx, y: ndy },
    earsD: ears,
    tailD: tail,
    legTop,
    legLen: Math.max(1, rig.ground - legTop),
    frontFootX: fwd > 0 ? feet.max : feet.min,
    backFootX: fwd > 0 ? feet.min : feet.max,
    cx: rig.w / 2,
    headScale: rig.headScale || 1,
  };
}

// A regular grid over the sprite; cells with no visible pixels are dropped.
export function buildGrid(w, h, alpha) {
  const N = 64;
  const cell = Math.max(w, h) / N;
  const cols = Math.max(1, Math.ceil(w / cell));
  const rows = Math.max(1, Math.ceil(h / cell));
  const vx = cols + 1;
  const vy = rows + 1;
  const n = vx * vy;
  const rest = new Float32Array(n * 2);
  const uv = new Float32Array(n * 2);
  for (let j = 0; j < vy; j++) {
    for (let i = 0; i < vx; i++) {
      const k = j * vx + i;
      const x = Math.min(i * cell, w);
      const y = Math.min(j * cell, h);
      rest[k * 2] = x;
      rest[k * 2 + 1] = y;
      uv[k * 2] = x / w;
      uv[k * 2 + 1] = y / h;
    }
  }

  const occ = new Uint8Array(cols * rows);
  for (let cj = 0; cj < rows; cj++) {
    for (let ci = 0; ci < cols; ci++) {
      const x0 = Math.floor(ci * cell), x1 = Math.min(w, Math.ceil((ci + 1) * cell));
      const y0 = Math.floor(cj * cell), y1 = Math.min(h, Math.ceil((cj + 1) * cell));
      let hit = 0;
      for (let y = y0; y < y1 && !hit; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          if (alpha[y * w + x] > 4) { hit = 1; break; }
        }
      }
      occ[cj * cols + ci] = hit;
    }
  }
  // Keep a one-cell border so bent edges never get clipped.
  const keep = new Uint8Array(cols * rows);
  for (let cj = 0; cj < rows; cj++) {
    for (let ci = 0; ci < cols; ci++) {
      let any = 0;
      for (let dj = -1; dj <= 1 && !any; dj++) {
        for (let di = -1; di <= 1; di++) {
          const a = ci + di, b = cj + dj;
          if (a >= 0 && b >= 0 && a < cols && b < rows && occ[b * cols + a]) { any = 1; break; }
        }
      }
      keep[cj * cols + ci] = any;
    }
  }
  const idx = [];
  for (let cj = 0; cj < rows; cj++) {
    for (let ci = 0; ci < cols; ci++) {
      if (!keep[cj * cols + ci]) continue;
      const a = cj * vx + ci, b = a + 1, c = a + vx, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  return { n, cell, rest, uv, index: new Uint32Array(idx) };
}

// Per-vertex influence of each body part.
export function computeWeights(D, grid) {
  const { n, rest } = grid;
  const W = {
    head: new Float32Array(n),
    ear: D.earsD.map(() => new Float32Array(n)),
    tail: new Float32Array(n),
    tailA: new Float32Array(n),
    depth: new Float32Array(n),
    front: new Float32Array(n),
    breath: new Float32Array(n),
    tap: (D.taps || []).map(() => new Float32Array(n)),
  };
  const R = D.head.r;
  for (let k = 0; k < n; k++) {
    const x = rest[k * 2];
    const y = rest[k * 2 + 1];

    // Head: everything within ~1.5 radii, fading out past the neck.
    const dh = hyp(x - D.head.x, y - D.head.y);
    let wh = 1 - smoothstep(R * 1.05, R * 1.55, dh);
    const s = ((x - D.head.x) * D.neckDir.x + (y - D.head.y) * D.neckDir.y) / R;
    wh *= 1 - smoothstep(0.8, 1.3, s);

    // Ears: a capsule from base to tip, bending more toward the tip.
    D.earsD.forEach((e, i) => {
      let a = ((x - e.base.x) * e.ux + (y - e.base.y) * e.uy) / e.len;
      let perp = Math.abs((x - e.base.x) * e.uy - (y - e.base.y) * e.ux);
      if (a > 1) perp = hyp(x - e.tip.x, y - e.tip.y);
      // Fade out in the empty space beside the ear so its edge pixels never smear.
      const inner = Math.max(e.len * 0.4, 3) + grid.cell * 0.5;
      const m = (1 - smoothstep(inner, inner + grid.cell * 1.5, perp)) * smoothstep(-0.05, 0.25, a);
      W.ear[i][k] = m * smoothstep(0, 0.7, clamp(a, 0, 1));
      wh = Math.max(wh, m);
    });
    W.head[k] = wh;

    // Tail: a band around its centre line, never stealing the head or torso core.
    if (D.tailD) {
      const t = D.tailD;
      let perp = Infinity, s = 0;
      for (let i = 0; i < t.pts.length - 1; i++) {
        const p0 = t.pts[i], p1 = t.pts[i + 1];
        const sx = p1.x - p0.x, sy = p1.y - p0.y;
        const L2 = sx * sx + sy * sy || 1;
        let u = ((x - p0.x) * sx + (y - p0.y) * sy) / L2;
        u = Math.min(1, i === 0 ? u : Math.max(0, u));
        const d = hyp(x - (p0.x + sx * u), y - (p0.y + sy * u));
        if (d < perp) { perp = d; s = t.cum[i] + u * Math.sqrt(L2); }
      }
      const a = s / t.len;
      // Full weight across the whole tail, fading out in the empty space around it.
      const inner = t.width * 1.3 + grid.cell;
      let m = (1 - smoothstep(inner, inner + grid.cell * 2, perp)) * smoothstep(-0.12, 0.08, a);
      m *= 1 - wh;
      m *= smoothstep(D.torso.r * 0.75, D.torso.r * 1.05, hyp(x - D.torso.x, y - D.torso.y));
      W.tail[k] = m;
      W.tailA[k] = clamp(a, 0, 1);
    }

    // Legs: everything below the belly line, split into front and back pairs.
    if (D.style === 'walk') {
      W.depth[k] = clamp((y - D.legTop) / D.legLen, 0, 1) * (1 - wh) * (1 - W.tail[k]);
      W.front[k] = smoothstep(-1, 1, ((x - D.torso.x) * D.fwd) / (D.torso.r * 0.5 + 1));
    }

    const db = hyp(x - D.torso.x, y - D.torso.y) / (D.torso.r * 1.4);
    W.breath[k] = Math.exp(-db * db) * (1 - wh);

    (D.taps || []).forEach((t, i) => {
      W.tap[i][k] = (1 - smoothstep(t.r * 0.55, t.r, hyp(x - t.x, y - t.y))) * (1 - wh);
    });
  }
  return W;
}

// Applies a pose to every vertex. Output is in sprite space.
export function deform(D, grid, W, pose, out) {
  const { n, rest } = grid;
  const f = D.fwd;
  const dirSign = D.facing === 0 ? 1 : f;
  const headAng = pose.head.rot * dirSign;
  const hdx = pose.head.x * D.head.r * f;
  const hdy = pose.head.y * D.head.r;
  const hs = D.headScale;
  const earAng = D.earsD.map((e, i) => (pose.ears[i] ?? pose.ears[0] ?? 0) * e.sign);
  const rootAng = pose.root.rot * dirSign;
  const legs = { ...pose.legs };

  let P;
  if (pose.root.pivot === 'front') P = { x: D.frontFootX, y: D.ground };
  else if (pose.root.pivot === 'back') P = { x: D.backFootX, y: D.ground };
  else if (pose.root.pivot === 'center') P = { x: D.torso.x, y: D.torso.y };
  else P = { x: D.cx, y: D.ground };

  // Rotating around one pair of feet sinks or lifts the other pair; bend those legs
  // so the paws stay on the ground.
  if (pose.root.autoComp && D.style === 'walk') {
    const other = pose.root.pivot === 'front' ? D.backFootX : D.frontFootX;
    const drop = (other - P.x) * Math.sin(rootAng) * pose.root.sy;
    const comp = clamp(drop / D.legLen, -0.35, 0.85);
    if (pose.root.pivot === 'front') legs.compB += comp;
    else legs.compF += comp;
  }

  const cr = Math.cos(rootAng), sr = Math.sin(rootAng);
  const { sx, sy } = pose.root;
  const tx = pose.root.x * D.h * f;
  const ty = pose.root.y * D.h;

  for (let k = 0; k < n; k++) {
    let x = rest[k * 2];
    let y = rest[k * 2 + 1];

    const depth = W.depth[k];
    if (depth > 0) {
      const zf = W.front[k], zb = 1 - zf;
      const comp = legs.compF * zf + legs.compB * zb;
      y = D.legTop + (y - D.legTop) * (1 - comp * depth);
      x += (legs.front * zf + legs.back * zb) * D.legLen * depth * f;
      y -= (legs.liftF * zf + legs.liftB * zb) * D.legLen * depth;
    }

    for (let i = 0; i < D.earsD.length; i++) {
      const w = W.ear[i][k];
      if (w <= 0) continue;
      const e = D.earsD[i];
      const a = earAng[i] * w;
      const c = Math.cos(a), s = Math.sin(a);
      const dx = x - e.base.x, dy = y - e.base.y;
      x = e.base.x + dx * c - dy * s;
      y = e.base.y + dx * s + dy * c;
    }

    const wt = W.tail[k];
    if (wt > 0 && D.tailD) {
      const t = D.tailD;
      const aa = W.tailA[k];
      const a = (pose.tail.rot * smoothstep(0, 0.3, aa) + pose.tail.curl * aa * aa) * t.sign * wt;
      const c = Math.cos(a), s = Math.sin(a);
      const dx = x - t.base.x, dy = y - t.base.y;
      x = t.base.x + dx * c - dy * s;
      y = t.base.y + dx * s + dy * c;
    }

    for (let i = 0; i < W.tap.length; i++) {
      const lift = pose.taps?.[i];
      if (lift && W.tap[i][k] > 0) y -= lift * D.taps[i].r * W.tap[i][k];
    }

    const wb = W.breath[k];
    if (wb > 0 && pose.breath) {
      y = D.torso.y + (y - D.torso.y) * (1 + pose.breath * wb);
      x = D.torso.x + (x - D.torso.x) * (1 + pose.breath * 0.4 * wb);
    }

    const wh = W.head[k];
    if (wh > 0) {
      let dx = x - D.neck.x, dy = y - D.neck.y;
      const sc = 1 + (hs - 1) * wh;
      dx *= sc; dy *= sc;
      const a = headAng * wh;
      const c = Math.cos(a), s = Math.sin(a);
      x = D.neck.x + dx * c - dy * s + hdx * wh;
      y = D.neck.y + dx * s + dy * c + hdy * wh;
    }

    const dx = (x - P.x) * sx, dy = (y - P.y) * sy;
    out[k * 2] = P.x + dx * cr - dy * sr + tx;
    out[k * 2 + 1] = P.y + dx * sr + dy * cr + ty;
  }
}

const VS = `#version 300 es
in vec2 aPos;
in vec2 aUv;
uniform vec2 uSize;
out vec2 vUv;
void main() {
  vUv = aUv;
  vec2 c = aPos / uSize * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 outColor;
void main() { outColor = texture(uTex, vUv); }`;

export class RigRenderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('This PC does not support WebGL2, which the animation preview needs.');
    this.gl = gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    this.loc = {
      pos: gl.getAttribLocation(prog, 'aPos'),
      uv: gl.getAttribLocation(prog, 'aUv'),
      size: gl.getUniformLocation(prog, 'uSize'),
    };
    this.posBuf = gl.createBuffer();
    this.uvBuf = gl.createBuffer();
    this.idxBuf = gl.createBuffer();
    this.tex = gl.createTexture();
    this.vao = gl.createVertexArray();
  }

  // Uploads a new sprite (after analysis or a brush touch-up) and rebuilds the mesh.
  setSprite(source, rig, alpha) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.grid = buildGrid(rig.w, rig.h, alpha);
    this.local = new Float32Array(this.grid.n * 2);
    this.screen = new Float32Array(this.grid.n * 2);

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.grid.uv, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.loc.uv);
    gl.vertexAttribPointer(this.loc.uv, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.screen.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.loc.pos);
    gl.vertexAttribPointer(this.loc.pos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.grid.index, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    this.setRig(rig);
  }

  // Cheap: re-derives geometry and weights when markers move.
  setRig(rig) {
    this.D = deriveRig(rig);
    this.W = computeWeights(this.D, this.grid);
  }

  // Renders a pose into this.canvas (width x height). The ground point under the
  // sprite's centre lands at (anchorX, anchorY); scale maps sprite px to canvas px.
  render(pose, { width, height, scale, anchorX, anchorY, flip = false }) {
    const gl = this.gl;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    deform(this.D, this.grid, this.W, pose, this.local);
    const fx = flip ? -scale : scale;
    const { cx, ground } = this.D;
    for (let k = 0; k < this.grid.n; k++) {
      this.screen[k * 2] = anchorX + (this.local[k * 2] - cx) * fx;
      this.screen[k * 2 + 1] = anchorY + (this.local[k * 2 + 1] - ground) * scale;
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    gl.uniform2f(this.loc.size, width, height);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.screen);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.drawElements(gl.TRIANGLES, this.grid.index.length, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    return this.canvas;
  }
}
