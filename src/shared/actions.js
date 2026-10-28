// The actions published in the Studio, and the pose each one produces over one loop.
// A pose is a small set of puppet parameters that rig.js turns into a mesh deformation.
// Conventions (rig.js maps them onto the photo's actual facing):
//   head.rot   > 0  nose down        ears[i] > 0  ear tips go back
//   tail.rot   > 0  tail lifts up    root.rot > 0  body pitches nose-down
//   legs.front > 0  front legs reach forward; lift > 0 raises the feet
//   root.x / root.y are in body heights, head.x / head.y in head radii.

export const FPS = 20;

export const GROUPS = [
  { id: 'rest', title: 'Rests', blurb: 'How it settles down' },
  { id: 'attention', title: 'Looks at you', blurb: 'How it reacts to you' },
  { id: 'move', title: 'Moves', blurb: 'How it gets around the desktop' },
  { id: 'play', title: 'Plays', blurb: 'Little moments of fun' },
];

export const CATALOG = [
  { id: 'rest', group: 'rest', name: 'Rest', desc: 'Breathes calmly between activities', required: true, dur: 2.4, kind: 'stay' },
  { id: 'sleep', group: 'rest', name: 'Nap', desc: 'Settles down for a snooze', dur: 3.2, kind: 'stay', effect: 'zzz', default: true },
  { id: 'sit', group: 'rest', name: 'Sit', desc: 'Sits back and watches the screen', dur: 2.4, kind: 'stay', default: true },
  { id: 'look', group: 'attention', name: 'Looks at you', desc: 'Perks up when your cursor comes close', dur: 2.4, kind: 'stay', default: true },
  { id: 'happy', group: 'attention', name: 'Happy bounce', desc: 'Bounces with hearts when you click it', dur: 0.8, kind: 'once', loops: 3, effect: 'hearts', default: true },
  { id: 'wag', group: 'attention', name: 'Tail wag', desc: 'Wags its tail at you', dur: 0.6, kind: 'stay', needs: 'tail', default: true },
  { id: 'ears', group: 'attention', name: 'Ear twitch', desc: 'Flicks its ears now and then', dur: 1.8, kind: 'stay', needs: 'ears', default: true },
  { id: 'walk', group: 'move', name: 'Walk', desc: 'Strolls along the taskbar', required: true, dur: 0.9, kind: 'move', speed: 0.5 },
  { id: 'run', group: 'move', name: 'Zoomies', desc: 'Sprints across the screen', dur: 0.5, kind: 'move', speed: 1.9, default: true },
  { id: 'jump', group: 'move', name: 'Jump', desc: 'Leaps when you double-click it', dur: 1.1, kind: 'once', loops: 1, lift: { from: 0.28, to: 0.78, height: 0.7 }, default: true },
  { id: 'twirl', group: 'play', name: 'Twirl', desc: 'Spins around on the spot', dur: 0.9, kind: 'once', loops: 2 },
  { id: 'stretch', group: 'play', name: 'Big stretch', desc: 'A long, satisfying stretch', dur: 2.8, kind: 'once', loops: 1, default: true },
  { id: 'sniff', group: 'play', name: 'Sniff around', desc: 'Noses at something interesting', dur: 1.6, kind: 'stay' },
  { id: 'shake', group: 'play', name: 'Shake off', desc: 'A full-body shake', dur: 1.1, kind: 'once', loops: 1 },
  { id: 'dance', group: 'play', name: 'Happy dance', desc: 'Sways to a little tune', dur: 1.2, kind: 'stay', effect: 'notes' },
];

// Always rendered into the package; used while you carry the companion around.
export const SYSTEM_ACTIONS = [
  { id: 'held', group: 'system', name: 'Carried', dur: 1.2, kind: 'stay', system: true },
];

export const PERSONALITIES = [
  { id: 'calm', name: 'Calm', hint: 'Mostly rests and strolls, rarely in a hurry.' },
  { id: 'playful', name: 'Playful', hint: 'Lots of walking, zoomies and tricks.' },
  { id: 'sleepy', name: 'Sleepy', hint: 'Naps often and loves a good stretch.' },
  { id: 'curious', name: 'Curious', hint: 'Sniffs around and keeps an eye on your cursor.' },
];

// How often the desktop client picks each action, per personality.
export const BEHAVIOR_WEIGHTS = {
  calm: { rest: 6, sit: 4, sleep: 3, look: 2, wag: 1, ears: 2, walk: 3, run: 0.3, jump: 0.3, twirl: 0.2, stretch: 1.5, sniff: 1, shake: 0.5, dance: 0.2, happy: 0.3 },
  playful: { rest: 3, sit: 1, sleep: 1, look: 2, wag: 2, ears: 1, walk: 4, run: 2.5, jump: 1.5, twirl: 1.5, stretch: 1, sniff: 1, shake: 1, dance: 1.5, happy: 1 },
  sleepy: { rest: 4, sit: 3, sleep: 6, look: 1, wag: 0.5, ears: 1, walk: 1.5, run: 0.2, jump: 0.2, twirl: 0.2, stretch: 2, sniff: 0.5, shake: 0.5, dance: 0.2, happy: 0.3 },
  curious: { rest: 3, sit: 2, sleep: 1, look: 3, wag: 1, ears: 2.5, walk: 4, run: 1, jump: 0.8, twirl: 0.5, stretch: 1, sniff: 4, shake: 0.6, dance: 0.4, happy: 0.5 },
};

export function actionAvailable(action, rig) {
  if (action.needs === 'tail') return !!rig.tail;
  if (action.needs === 'ears') return rig.ears.length > 0;
  return true;
}

export function neutralPose() {
  return {
    root: { x: 0, y: 0, sx: 1, sy: 1, rot: 0, pivot: 'ground', autoComp: false },
    breath: 0,
    head: { rot: 0, x: 0, y: 0 },
    ears: [0, 0],
    tail: { rot: 0, curl: 0 },
    legs: { front: 0, back: 0, liftF: 0, liftB: 0, compF: 0, compB: 0 },
  };
}

const TAU = Math.PI * 2;
const PI = Math.PI;
const sin = Math.sin;
const cos = Math.cos;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
// 0 outside [a, b], a smooth hump inside.
const pulse = (t, a, b) => (t <= a || t >= b ? 0 : sin(PI * (t - a) / (b - a)));
// Ramp up over [a, b], hold, ramp down over [c, d].
const envelope = (t, a, b, c, d) => smooth((t - a) / (b - a)) * (1 - smooth((t - c) / (d - c)));

export const POSES = {
  rest(t) {
    const p = neutralPose();
    p.breath = 0.022 * sin(TAU * t);
    p.head.rot = 0.025 * sin(TAU * t + 0.8);
    p.tail.rot = 0.1 * sin(TAU * t);
    p.tail.curl = 0.05 * sin(TAU * t - 1);
    return p;
  },

  sleep(t) {
    const p = neutralPose();
    p.root.sy = 0.86;
    p.root.sx = 1.05;
    p.breath = 0.035 * sin(TAU * t);
    p.head.rot = 0.32 + 0.02 * sin(TAU * t);
    p.head.y = 0.25;
    p.ears = [0.25, 0.25];
    p.tail.rot = -0.3;
    p.tail.curl = 0.25;
    p.legs.compF = 0.45;
    p.legs.compB = 0.45;
    return p;
  },

  sit(t, rig) {
    const p = neutralPose();
    p.breath = 0.02 * sin(TAU * t);
    if (rig.style === 'walk') {
      p.root.pivot = 'front';
      p.root.rot = -0.2;
      p.root.autoComp = true;
      p.head.rot = 0.12 + 0.02 * sin(TAU * t);
      p.tail.rot = -0.25;
    } else {
      p.root.sy = 0.94;
      p.root.sx = 1.03;
      p.head.rot = 0.03 * sin(TAU * t);
    }
    return p;
  },

  look(t, rig) {
    const p = neutralPose();
    if (rig.facing) {
      p.head.rot = -0.12 + 0.05 * sin(TAU * t);
      p.head.x = 0.06;
    } else {
      p.head.rot = 0.16 * sin(TAU * t); // curious head tilt
    }
    p.ears = [-0.15, -0.15];
    p.tail.rot = 0.15 + 0.2 * sin(2 * TAU * t);
    p.breath = 0.018 * sin(TAU * t);
    return p;
  },

  happy(t) {
    const p = neutralPose();
    const b = sin(PI * t);
    const land = Math.pow(1 - b, 8);
    p.root.y = -0.13 * b;
    p.root.sy = 1 + 0.06 * b - 0.1 * land;
    p.root.sx = 1 - 0.03 * b + 0.08 * land;
    p.head.rot = -0.1 * b;
    p.ears = [-0.2 + 0.15 * b, -0.2 + 0.15 * b];
    p.tail.rot = 0.3 + 0.4 * sin(2 * TAU * t);
    p.legs.compF = 0.15 * b;
    p.legs.compB = 0.15 * b;
    return p;
  },

  wag(t) {
    const p = neutralPose();
    p.tail.rot = 0.12 + 0.32 * sin(2 * TAU * t);
    p.tail.curl = 0.2 * sin(2 * TAU * t - 0.9);
    p.root.rot = 0.012 * sin(2 * TAU * t + PI);
    p.breath = 0.015 * sin(TAU * t);
    p.head.rot = -0.04;
    return p;
  },

  ears(t) {
    const p = neutralPose();
    p.ears = [0.4 * pulse(t, 0.12, 0.24) - 0.05, 0.4 * pulse(t, 0.55, 0.67) - 0.05];
    p.head.rot = 0.04 * pulse(t, 0.1, 0.32) - 0.03 * pulse(t, 0.5, 0.75);
    p.breath = 0.02 * sin(TAU * t);
    p.tail.rot = 0.08 * sin(TAU * t);
    return p;
  },

  walk(t, rig) {
    const p = neutralPose();
    const ph = TAU * t;
    if (rig.style === 'walk') {
      p.legs.front = 0.24 * sin(ph);
      p.legs.back = 0.24 * sin(ph + PI);
      p.legs.liftF = 0.1 * Math.max(0, cos(ph));
      p.legs.liftB = 0.1 * Math.max(0, cos(ph + PI));
      p.root.y = -0.012 * (1 - cos(2 * ph)) / 2;
      p.head.rot = 0.035 * sin(2 * ph);
      p.head.y = 0.04 * sin(2 * ph);
      p.tail.rot = 0.12 + 0.15 * sin(ph);
      p.tail.curl = 0.1 * sin(ph - 1);
      p.ears = [0.04 * sin(2 * ph), 0.04 * sin(2 * ph + 0.5)];
    } else {
      const b = sin(PI * ((t * 2) % 1));
      const land = Math.pow(1 - b, 6);
      p.root.y = -0.08 * b;
      p.root.sy = 1 + 0.04 * b - 0.07 * land;
      p.root.sx = 1 - 0.02 * b + 0.05 * land;
      p.root.rot = 0.05 * sin(ph);
      p.ears = [0.15 * b, 0.15 * b];
      p.tail.rot = 0.2 * sin(ph);
    }
    return p;
  },

  run(t, rig) {
    const p = neutralPose();
    const ph = TAU * t;
    if (rig.style === 'walk') {
      p.legs.front = 0.34 * sin(ph);
      p.legs.back = 0.34 * sin(ph + 0.9 * PI);
      p.legs.liftF = 0.14 * Math.max(0, cos(ph));
      p.legs.liftB = 0.14 * Math.max(0, cos(ph + 0.9 * PI));
      p.root.y = -0.045 * Math.abs(sin(ph));
      p.root.rot = 0.06 * sin(ph);
      p.root.sx = 1 + 0.04 * sin(ph + 0.5);
      p.head.rot = 0.08;
      p.ears = [0.35, 0.35];
      p.tail.rot = -0.05 + 0.12 * sin(ph);
    } else {
      const b = sin(PI * t);
      const land = Math.pow(1 - b, 6);
      p.root.y = -0.12 * b;
      p.root.sy = 1 + 0.06 * b - 0.09 * land;
      p.root.sx = 1 - 0.03 * b + 0.07 * land;
      p.ears = [0.3 * b, 0.3 * b];
      p.tail.rot = 0.3 * b;
    }
    return p;
  },

  jump(t) {
    const p = neutralPose();
    const crouch = envelope(t, 0.0, 0.2, 0.22, 0.3);
    const up = pulse(t, 0.26, 0.5);
    const landing = envelope(t, 0.76, 0.82, 0.84, 1.0);
    const air = pulse(t, 0.3, 0.8);
    p.root.sy = 1 - 0.18 * crouch - 0.16 * landing + 0.12 * up;
    p.root.sx = 1 + 0.1 * crouch + 0.1 * landing - 0.06 * up;
    p.head.rot = 0.12 * crouch - 0.12 * up + 0.08 * landing;
    p.legs.compF = 0.25 * pulse(t, 0.4, 0.75);
    p.legs.compB = 0.25 * pulse(t, 0.4, 0.75);
    p.legs.front = 0.2 * pulse(t, 0.28, 0.55);
    p.legs.back = -0.2 * pulse(t, 0.28, 0.55);
    p.tail.rot = 0.4 * air;
    p.ears = [0.3 * air, 0.3 * air];
    return p;
  },

  twirl(t) {
    const p = neutralPose();
    p.root.sx = cos(TAU * t);
    p.root.y = -0.07 * sin(PI * t);
    p.ears = [0.2, 0.2];
    p.tail.rot = 0.3;
    return p;
  },

  stretch(t, rig) {
    const p = neutralPose();
    const e = envelope(t, 0.05, 0.3, 0.72, 0.95);
    if (rig.style === 'walk') {
      p.root.pivot = 'back';
      p.root.rot = 0.17 * e;
      p.root.autoComp = true;
      p.root.sx = 1 + 0.05 * e;
      p.head.rot = -0.22 * e;
      p.head.x = 0.15 * e;
      p.legs.front = 0.2 * e;
    } else {
      p.root.sy = 1 + 0.1 * e;
      p.root.sx = 1 - 0.05 * e;
      p.head.rot = (rig.facing ? -0.2 : 0.12) * e;
    }
    p.tail.rot = 0.35 * e;
    p.ears = [0.15 * e, 0.15 * e];
    return p;
  },

  sniff(t, rig) {
    const p = neutralPose();
    const nose = 0.05 * sin(TAU * t * 5);
    if (rig.style === 'walk') {
      p.root.pivot = 'back';
      p.root.rot = 0.06;
      p.root.autoComp = true;
      p.head.rot = 0.3 + nose;
      p.head.x = 0.12;
    } else {
      p.head.rot = 0.12 * sin(TAU * t);
      p.head.y = 0.15 + nose * 0.8;
    }
    p.tail.rot = 0.2 + 0.12 * sin(TAU * t);
    p.ears = [-0.08, -0.08];
    return p;
  },

  shake(t) {
    const p = neutralPose();
    const amp = Math.pow(pulse(t, 0, 1), 0.6);
    const w = TAU * t * 7;
    p.root.rot = 0.08 * sin(w) * amp;
    p.root.sx = 1 + 0.03 * amp;
    p.head.rot = 0.14 * sin(w + 0.6) * amp;
    p.ears = [0.45 * sin(w + 1.2) * amp, 0.45 * sin(w + 1.6) * amp];
    p.tail.rot = 0.4 * sin(w + 2) * amp;
    return p;
  },

  dance(t) {
    const p = neutralPose();
    const w = sin(TAU * t);
    p.root.rot = 0.1 * w;
    p.root.y = -0.06 * Math.abs(w);
    p.head.rot = -0.12 * w;
    p.ears = [0.2 * w, -0.2 * w];
    p.tail.rot = 0.2 + 0.4 * sin(2 * TAU * t);
    p.legs.liftF = 0.12 * Math.max(0, w);
    p.legs.liftB = 0.12 * Math.max(0, -w);
    return p;
  },

  held(t) {
    const p = neutralPose();
    p.root.sy = 1.07;
    p.root.sx = 0.95;
    p.legs.liftF = -0.06;
    p.legs.liftB = -0.06;
    p.ears = [0.2, 0.2];
    p.tail.rot = -0.35 + 0.08 * sin(TAU * t);
    p.head.rot = 0.05 * sin(TAU * t);
    p.breath = 0.02 * sin(TAU * t);
    return p;
  },
};
