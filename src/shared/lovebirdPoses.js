// The lovebird pose pack: 13 poses with their names, triggers and timings, how the
// desktop client reacts, and each pose's live motion.
import { neutralPose } from './actions.js';

export const LOVEBIRD_POSES = [
  { id: 'look', name: 'Look Around', desc: 'Keeps a curious eye on what you are doing.', trigger: 'Automatic', required: true,
    kind: 'stay', dur: 4.8 },
  { id: 'keyboard', name: 'Keyboard Buddy', desc: 'Types along with you as you work.', trigger: 'Keyboard activity',
    kind: 'stay', dur: 1.8 },
  { id: 'patrol', name: 'Desktop Patrol', desc: 'Takes a little stroll around your desktop.', trigger: 'Walks automatically', required: true,
    kind: 'move', dur: 0.9, speed: 0.38 },
  { id: 'snack', name: 'Snack Time', desc: 'Stops for a quick bite before getting back to work.', trigger: 'Automatic',
    kind: 'stay', dur: 3.2 },
  { id: 'nap', name: 'Nap Time', desc: 'Settles in for a peaceful little nap.', trigger: 'Automatic',
    kind: 'stay', dur: 3.6, effect: 'zzz' },
  { id: 'stretch', name: 'Wing Stretch', desc: 'Fluffs up and gives both wings a happy stretch.', trigger: 'Automatic',
    kind: 'once', dur: 2.4, loops: 1 },
  { id: 'pats', name: 'Head Pats', desc: 'Leans in for a gentle pat on the head.', trigger: 'When you pet him',
    kind: 'stay', dur: 2.4, effect: 'hearts' },
  { id: 'disco', name: 'Disco Bird', desc: 'Bobs and bounces to its own little beat.', trigger: 'Automatic',
    kind: 'stay', dur: 1.0, effect: 'notes' },
  { id: 'kiss', name: 'Little Kiss', desc: 'Leans in close with a curious tilt of the head.', trigger: 'When you click him',
    kind: 'once', dur: 2.4, loops: 1, effect: 'hearts' },
  { id: 'preen', name: 'Feather Care', desc: 'Carefully preens its feathers from base to tip.', trigger: 'Automatic',
    kind: 'stay', dur: 2.6 },
  { id: 'pecks', name: 'Feisty Pecks', desc: 'Gives an approaching finger a few determined nibbles.', trigger: 'When your cursor comes close',
    kind: 'once', dur: 1.6, loops: 2 },
  { id: 'tucked', name: 'Tucked-In Nap', desc: 'Settles down with its head tucked into its back feathers.', trigger: 'Automatic',
    kind: 'stay', dur: 4.0, effect: 'zzz' },
  { id: 'scroll', name: 'Scroll Time', desc: 'Lounges on a little pillow and scrolls on a tiny phone.', trigger: 'Automatic',
    kind: 'stay', dur: 3.2 },
];

// How the desktop client reacts, and how often it picks each automatic pose.
export const LOVEBIRD_REACTIONS = {
  click: 'kiss', doubleClick: 'disco', near: 'pecks', pet: 'pats', typing: 'keyboard',
  look: 'look', held: 'held', land: 'look', wake: 'look', sleep: ['nap', 'tucked'],
};

export const LOVEBIRD_WEIGHTS = {
  calm: { look: 6, patrol: 3, snack: 2, nap: 2, stretch: 1.5, disco: 0.4, preen: 3, tucked: 1.5, scroll: 2 },
  playful: { look: 3, patrol: 5, snack: 1.5, nap: 1, stretch: 2, disco: 3, preen: 1.5, tucked: 0.7, scroll: 1.5 },
  sleepy: { look: 3, patrol: 1.5, snack: 1.5, nap: 5, stretch: 2, disco: 0.4, preen: 2, tucked: 4, scroll: 1.5 },
  curious: { look: 6, patrol: 4, snack: 2.5, nap: 1, stretch: 1, disco: 1, preen: 2, tucked: 0.8, scroll: 2.5 },
};

const TAU = Math.PI * 2;
const PI = Math.PI;
const sin = Math.sin;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const pulse = (t, a, b) => (t <= a || t >= b ? 0 : sin(PI * (t - a) / (b - a)));
const envelope = (t, a, b, c, d) => ease((t - a) / (b - a)) * (1 - ease((t - c) / (d - c)));
function keys(t, frames) {
  if (t <= frames[0][0]) return frames[0][1];
  for (let i = 1; i < frames.length; i++) {
    const [t1, v1] = frames[i];
    const [t0, v0] = frames[i - 1];
    if (t <= t1) return v0 + (v1 - v0) * ease((t - t0) / (t1 - t0));
  }
  return frames[frames.length - 1][1];
}

// Live motion for each pose: t is the loop phase 0..1, d the loop length in seconds.
export const LOVEBIRD_ANIM = {
  look(t) {
    const p = neutralPose();
    p.head.rot = keys(t, [[0, 0], [0.08, 0.13], [0.35, 0.13], [0.42, -0.02], [0.5, -0.14], [0.78, -0.14], [0.86, 0.04], [1, 0]]);
    p.breath = 0.018 * sin(TAU * t * 2);
    return p;
  },
  keyboard(t) {
    const p = neutralPose();
    const tap = Math.max(0, 1 - ((t * 8) % 1) * 3.5);
    p.head.rot = 0.09 * tap;
    p.root.y = -0.008 * tap;
    p.breath = 0.012 * sin(TAU * t);
    return p;
  },
  patrol(t) {
    const p = neutralPose();
    const hop = Math.abs(sin(TAU * t));
    p.root.y = -0.045 * hop;
    p.root.rot = 0.035 * sin(TAU * t);
    p.root.sy = 1 - 0.04 * Math.pow(1 - hop, 6);
    p.head.rot = 0.03 * sin(TAU * t * 2);
    return p;
  },
  snack(t) {
    const p = neutralPose();
    const u = t * 3.2;
    const pecking = u < 1.8 ? Math.max(0, sin(u * 9)) : 0;
    p.head.rot = 0.1 * pecking + (u >= 1.8 ? 0.05 * sin((u - 1.8) * 4) : 0);
    p.breath = 0.015 * sin(TAU * t);
    return p;
  },
  nap(t) {
    const p = neutralPose();
    p.breath = 0.035 * sin(TAU * t);
    p.head.rot = 0.015 * sin(TAU * t);
    return p;
  },
  stretch(t) {
    const p = neutralPose();
    const e = envelope(t, 0, 0.2, 0.75, 1);
    p.root.sy = 1 + 0.04 * e + 0.015 * sin(TAU * t * 6) * e;
    p.root.sx = 1 + 0.03 * e;
    p.root.rot = 0.012 * sin(TAU * t * 7);
    p.head.rot = -0.05 * e;
    return p;
  },
  pats(t) {
    const p = neutralPose();
    p.breath = 0.022 * sin(TAU * t);
    p.root.rot = -0.025 * (1 + sin(TAU * t)) / 2;
    return p;
  },
  disco(t) {
    const p = neutralPose();
    const bob = Math.abs(sin(TAU * t));
    p.root.y = -0.05 * bob;
    p.root.rot = 0.07 * sin(TAU * t);
    p.head.rot = 0.1 * sin(TAU * t * 2);
    p.root.sy = 1 - 0.03 * Math.pow(1 - bob, 6);
    return p;
  },
  kiss(t) {
    const p = neutralPose();
    const e = envelope(t, 0.05, 0.35, 0.75, 1);
    p.root.sx = 1 + 0.08 * e;
    p.root.sy = 1 + 0.08 * e;
    p.head.rot = 0.14 * e;
    p.root.y = -0.02 * pulse(t, 0.4, 0.6);
    return p;
  },
  preen(t) {
    const p = neutralPose();
    p.head.rot = 0.05 * sin(TAU * t * 6) * (0.6 + 0.4 * sin(TAU * t));
    p.breath = 0.015 * sin(TAU * t);
    return p;
  },
  pecks(t) {
    const p = neutralPose();
    const l = pulse(t, 0.1, 0.35) + pulse(t, 0.55, 0.8);
    p.head.x = 0.35 * l;
    p.head.rot = 0.08 * l;
    p.root.rot = 0.03 * l;
    return p;
  },
  tucked(t) {
    const p = neutralPose();
    p.breath = 0.03 * sin(TAU * t);
    return p;
  },
  scroll(t) {
    const p = neutralPose();
    p.head.rot = 0.04 * sin(TAU * t);
    p.breath = 0.015 * sin(TAU * t * 2);
    return p;
  },
  held(t) {
    const p = neutralPose();
    p.root.rot = 0.05 * sin(TAU * t * 3);
    p.root.sy = 1 + 0.04 * sin(TAU * t * 6);
    p.root.sx = 1 - 0.03 * sin(TAU * t * 6);
    return p;
  },
};
