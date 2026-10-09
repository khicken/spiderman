import * as THREE from "three";

const RISE = 5.75;
const SET = 18.75;
const PEAK = 60;
const DARK = 24 - SET + RISE;

export const NIGHT_START = -4;
export const NIGHT_FULL = -12;

export const sunElevation = (h: number) => {
  if (h >= RISE && h <= SET) return PEAK * Math.sin((Math.PI * (h - RISE)) / (SET - RISE));
  const n = (h - SET + 24) % 24;
  const x = Math.min(n, DARK - n);
  return x <= 1.5 ? -12 * x : -18 - (PEAK - 18) * Math.sin((Math.PI / 2) * Math.min(1, (x - 1.5) / (DARK / 2 - 1.5)));
};

export const nightAmount = (e: number) => 1 - THREE.MathUtils.smoothstep(e, NIGHT_FULL, NIGHT_START);

export const clockRate = (hours: number) => {
  const h = ((hours % 24) + 24) % 24;
  return h >= 17 && h < 19.5 ? 1 / 3 : 1;
};

type Key = {
  fog: string; warm: string; sky: string; ground: string; hemi: number; exposure: number; env: number; bloom: number;
  reflHi: number[]; reflLo: number[]; glow: number; head: number; fill: number; fillCol: string;
};

const NIGHT: Key = {
  fog: "#141a2b", warm: "#28304a", sky: "#6a7fb8", ground: "#0f121c", hemi: 0.45, exposure: 1.0, env: 0.12, bloom: 0.42,
  reflHi: [0.03, 0.05, 0.1], reflLo: [0.1, 0.1, 0.14], glow: 1.5, head: 1.6, fill: 0.4, fillCol: "#6f86c8",
};
const BLUE: Key = {
  fog: "#283050", warm: "#5e4660", sky: "#7d88c4", ground: "#151a2a", hemi: 0.62, exposure: 0.98, env: 0.28, bloom: 0.45,
  reflHi: [0.07, 0.11, 0.24], reflLo: [0.28, 0.22, 0.32], glow: 1.4, head: 1.45, fill: 0.36, fillCol: "#7080c0",
};
const AFTERGLOW: Key = {
  fog: "#4e4c66", warm: "#c47a68", sky: "#c4a0b8", ground: "#24273c", hemi: 0.74, exposure: 0.9, env: 0.4, bloom: 0.4,
  reflHi: [0.16, 0.22, 0.42], reflLo: [0.72, 0.44, 0.42], glow: 1.2, head: 1.25, fill: 0.4, fillCol: "#7f8cc8",
};
const DUSK: Key = {
  fog: "#73707f", warm: "#e09a70", sky: "#ffd2bd", ground: "#2e2e44", hemi: 0.85, exposure: 0.8, env: 0.6, bloom: 0.3,
  reflHi: [0.22, 0.36, 0.55], reflLo: [0.88, 0.55, 0.42], glow: 1, head: 1, fill: 0.45, fillCol: "#8a9ad0",
};
const GOLDEN: Key = {
  fog: "#9c9496", warm: "#f0b384", sky: "#ffdcc4", ground: "#4a4246", hemi: 0.92, exposure: 0.7, env: 0.7, bloom: 0.26,
  reflHi: [0.28, 0.42, 0.64], reflLo: [0.9, 0.64, 0.48], glow: 0.8, head: 0.7, fill: 0.42, fillCol: "#a8b4e0",
};
const AFTERNOON: Key = {
  fog: "#a2b3cc", warm: "#ead4b8", sky: "#e0eaff", ground: "#5e5c5c", hemi: 1.0, exposure: 0.6, env: 0.78, bloom: 0.16,
  reflHi: [0.32, 0.48, 0.74], reflLo: [0.8, 0.76, 0.74], glow: 0.62, head: 0.52, fill: 0.4, fillCol: "#c0cef0",
};
const DAY: Key = {
  fog: "#a4badb", warm: "#e6d8c2", sky: "#d4e4ff", ground: "#64625e", hemi: 1.05, exposure: 0.56, env: 0.8, bloom: 0.14,
  reflHi: [0.3, 0.5, 0.82], reflLo: [0.72, 0.8, 0.9], glow: 0.6, head: 0.5, fill: 0.4, fillCol: "#c8d4f0",
};

const KEYS: [number, Key][] = [
  [-90, NIGHT],
  [NIGHT_FULL - 2, NIGHT],
  [-8, BLUE],
  [-3, AFTERGLOW],
  [1, DUSK],
  [7, GOLDEN],
  [18, AFTERNOON],
  [35, DAY],
  [90, DAY],
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
const ELEV = KEYS.map((k) => k[0]);
const VALS = KEYS.map((k) => flat(k[1]));

export const CLOCK_KEYS = {
  stride: STRIDE,
  sample(h: number, out: Float32Array) {
    const e = sunElevation(((h % 24) + 24) % 24);
    let i = 0;
    while (i < ELEV.length - 2 && e >= ELEV[i + 1]) i++;
    const t = THREE.MathUtils.smoothstep(e, ELEV[i], ELEV[i + 1]);
    const a = VALS[i];
    const b = VALS[i + 1];
    for (let j = 0; j < STRIDE; j++) out[j] = a[j] + (b[j] - a[j]) * t;
  },
};
