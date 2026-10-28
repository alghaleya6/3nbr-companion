// Draws the app icon (a paw on a warm circle) and writes PNG + ICO files to assets/.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(size, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Shapes in a 0..1 unit square: background disc, then paw pads (ellipses).
const BG = [226, 103, 47];
const pads = [
  { x: 0.5, y: 0.63, rx: 0.17, ry: 0.14 },
  { x: 0.29, y: 0.45, rx: 0.075, ry: 0.095 },
  { x: 0.42, y: 0.33, rx: 0.075, ry: 0.1 },
  { x: 0.58, y: 0.33, rx: 0.075, ry: 0.1 },
  { x: 0.71, y: 0.45, rx: 0.075, ry: 0.095 },
];

function draw(size) {
  const out = Buffer.alloc(size * size * 4);
  const ss = 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let a = 0, w = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const u = (x + (sx + 0.5) / ss) / size, v = (y + (sy + 0.5) / ss) / size;
      const inBg = (u - 0.5) ** 2 + (v - 0.5) ** 2 <= 0.48 ** 2;
      const inPad = pads.some(p => ((u - p.x) / p.rx) ** 2 + ((v - p.y) / p.ry) ** 2 <= 1);
      if (inBg) { a++; if (inPad) w++; }
    }
    const n = ss * ss, i = (y * size + x) * 4;
    const wf = a ? w / a : 0;
    out[i] = Math.round(BG[0] * (1 - wf) + 255 * wf);
    out[i + 1] = Math.round(BG[1] * (1 - wf) + 255 * wf);
    out[i + 2] = Math.round(BG[2] * (1 - wf) + 255 * wf);
    out[i + 3] = Math.round((a / n) * 255);
  }
  return out;
}

mkdirSync('assets', { recursive: true });
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = Object.fromEntries(sizes.map(s => [s, png(s, draw(s))]));
writeFileSync('assets/icon.png', pngs[256]);
writeFileSync('assets/tray.png', pngs[32]);

// ICO container with embedded PNGs (supported since Windows Vista).
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map(s => {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s;
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngs[s].length, 8); e.writeUInt32LE(offset, 12);
  offset += pngs[s].length;
  return e;
});
writeFileSync('assets/icon.ico', Buffer.concat([header, ...entries, ...sizes.map(s => pngs[s])]));
console.log('wrote assets/icon.png, assets/tray.png, assets/icon.ico');
