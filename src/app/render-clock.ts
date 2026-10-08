import * as THREE from "three";

const RISE = 5.75;
const SET = 18.75;
const PEAK = 60;

export const sunElevation = (h: number) => {
  if (h >= RISE && h <= SET) return PEAK * Math.sin((Math.PI * (h - RISE)) / (SET - RISE));
  const n = (h - SET + 24) % 24;
  return -PEAK * Math.sin((Math.PI * n) / (24 - SET + RISE));
};

type Key = {
  fog: string; warm: string; sky: string; ground: string; hemi: number; exposure: number; env: number; bloom: number;
  reflHi: number[]; reflLo: number[]; glow: number; head: number; fill: number; fillCol: string;
};

const NIGHT: Key = {
  fog: "#141a2b", warm: "#28304a", sky: "#6a7fb8", ground: "#0b0d16", hemi: 0.42, exposure: 1.0, env: 0.12, bloom: 0.42,
  reflHi: [0.03, 0.05, 0.1], reflLo: [0.1, 0.1, 0.14], glow: 1.5, head: 1.6, fill: 0.4, fillCol: "#6f86c8",
};
const DAY: Key = {
  fog: "#9aa6b8", warm: "#e9d2b6", sky: "#dfe9ff", ground: "#4a4a50", hemi: 1.0, exposure: 0.56, env: 0.8, bloom: 0.14,
  reflHi: [0.35, 0.5, 0.75], reflLo: [0.75, 0.78, 0.82], glow: 0.6, head: 0.5, fill: 0.4, fillCol: "#c8d4f0",
};
const DUSK: Key = {
  fog: "#6a6e7f", warm: "#d9a27c", sky: "#ffd2bd", ground: "#262a44", hemi: 0.85, exposure: 0.8, env: 0.6, bloom: 0.3,
  reflHi: [0.22, 0.36, 0.55], reflLo: [0.85, 0.55, 0.45], glow: 1, head: 1, fill: 0.45, fillCol: "#8a9ad0",
};

const KEYS: [number, Key][] = [
  [0, NIGHT],
  [4.5, NIGHT],
  [5.5, { fog: "#4a4f6a", warm: "#b07a78", sky: "#c9a8b8", ground: "#23263a", hemi: 0.7, exposure: 0.9, env: 0.35, bloom: 0.45, reflHi: [0.2, 0.28, 0.45], reflLo: [0.75, 0.5, 0.5], glow: 1.2, head: 1.3, fill: 0.4, fillCol: "#7f8cc8" }],
  [6.5, { ...DUSK, fog: "#8c8090", warm: "#e8a27a", sky: "#ffd6c4", ground: "#2a2e46" }],
  [9, DAY],
  [15, DAY],
  [17.5, { fog: "#8a8a96", warm: "#e2b48c", sky: "#ffe2cc", ground: "#3a3a4a", hemi: 0.95, exposure: 0.7, env: 0.7, bloom: 0.26, reflHi: [0.28, 0.42, 0.62], reflLo: [0.85, 0.62, 0.5], glow: 0.8, head: 0.7, fill: 0.42, fillCol: "#a8b4e0" }],
  [18.5, DUSK],
  [19.5, { fog: "#2e3348", warm: "#8a5a58", sky: "#8d8fc0", ground: "#141726", hemi: 0.65, exposure: 0.95, env: 0.3, bloom: 0.45, reflHi: [0.08, 0.12, 0.22], reflLo: [0.35, 0.22, 0.25], glow: 1.35, head: 1.4, fill: 0.35, fillCol: "#7080c0" }],
  [20.5, NIGHT],
  [24, NIGHT],
];

const STRIDE = 28;
const c = new THREE.Color();
const flat = (k: Key) => {
  const o: number[] = [];
  const add = (hex: string) => (c.set(hex), o.push(c.r, c.g, c.b));
  add(k.fog);
  add(k.warm);
  add(k.sky);
  add(k.ground);
  o.push(k.hemi, k.exposure, k.env, k.bloom, ...k.reflHi, ...k.reflLo, k.glow, k.head, k.fill);
  add(k.fillCol);
  return o;
};
const HOURS = KEYS.map((k) => k[0]);
const VALS = KEYS.map((k) => flat(k[1]));

export const CLOCK_KEYS = {
  stride: STRIDE,
  sample(h: number, out: Float32Array) {
    let i = 0;
    while (i < HOURS.length - 2 && h >= HOURS[i + 1]) i++;
    const t = THREE.MathUtils.smoothstep(h, HOURS[i], HOURS[i + 1]);
    const a = VALS[i];
    const b = VALS[i + 1];
    for (let j = 0; j < STRIDE; j++) out[j] = a[j] + (b[j] - a[j]) * t;
  },
};
