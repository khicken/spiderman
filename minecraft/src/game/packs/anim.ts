import { blend, crop, type Img } from "./img";

export interface AnimMeta {
  frametime?: number;
  frames?: (number | { index: number; time?: number })[];
  interpolate?: boolean;
  width?: number;
  height?: number;
}

export interface Strip {
  frames: Img[];
  times: [index: number, ticks: number][];
  interpolate: boolean;
}

// Vanilla frame size: width x width unless the .mcmeta says otherwise; frames stack top to bottom.
export function toStrip(img: Img, meta: AnimMeta | null): Strip {
  const fw = meta?.width ?? Math.min(img.w, img.h);
  const fh = meta?.height ?? fw;
  const cols = Math.max(1, Math.floor(img.w / fw));
  const n = Math.max(1, cols * Math.floor(img.h / fh));
  const frames: Img[] = [];
  if (n === 1 || !meta) frames.push(n === 1 && fw === img.w && fh === img.h ? img : crop(img, 0, 0, fw, fh));
  else for (let i = 0; i < n; i++) frames.push(crop(img, (i % cols) * fw, Math.floor(i / cols) * fh, fw, fh));
  const ft = Math.max(1, meta?.frametime ?? 1);
  const list = meta?.frames?.length ? meta.frames : frames.map((_, i) => i);
  const times: Strip["times"] = list
    .map((f) => (typeof f === "number" ? [f, ft] : [f.index, Math.max(1, f.time ?? ft)]) as [number, number])
    .filter(([i]) => i >= 0 && i < frames.length);
  if (!times.length) times.push([0, ft]);
  return { frames, times, interpolate: !!meta?.interpolate && frames.length > 1 };
}

// Resamples a pack animation into evenly timed frames, so the chunk shader can step through layers at a fixed rate.
export function evenFrames(s: Strip, maxFrames: number): { frames: Img[]; ticks: number } {
  if (s.frames.length === 1 || s.times.length === 1) return { frames: [s.frames[s.times[0][0]]], ticks: 1 };
  const period = s.times.reduce((n, t) => n + t[1], 0);
  let g = s.interpolate ? 1 : s.times.reduce((a, t) => gcd(a, t[1]), s.times[0][1]);
  let count = period / g;
  if (count > maxFrames) {
    count = maxFrames;
    g = period / count;
  }
  const frames: Img[] = [];
  for (let k = 0; k < count; k++) {
    let t = k * g, e = 0;
    while (e < s.times.length - 1 && t >= s.times[e][1]) t -= s.times[e++][1];
    const cur = s.frames[s.times[e][0]];
    if (!s.interpolate) frames.push(cur);
    else frames.push(blend(cur, s.frames[s.times[(e + 1) % s.times.length][0]], t / s.times[e][1]));
  }
  return { frames, ticks: g };
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}
