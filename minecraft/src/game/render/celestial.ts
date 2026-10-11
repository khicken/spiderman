// Vanilla 1.21 sky math. Pure functions on plain numbers, colors are sRGB 0..1.

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];

const TAU = Math.PI * 2;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function celestialAngle(dayTicks: number): number {
  const t = dayTicks / 24000 - 0.25;
  const d = t - Math.floor(t);
  const e = 0.5 - Math.cos(d * Math.PI) / 2;
  return (d * 2 + e) / 3;
}

export const sunHeight = (angle: number) => clamp01(Math.cos(angle * TAU) * 2 + 0.5);

export function daylight(angle: number, rain = 0, thunder = 0): number {
  let g = 1 - clamp01(1 - (Math.cos(angle * TAU) * 2 + 0.5));
  g *= 1 - (rain * 5) / 16;
  g *= 1 - (thunder * 5) / 16;
  return g * 0.8 + 0.2;
}

export function starBrightness(angle: number, rain = 0): number {
  const g = clamp01(1 - (Math.cos(angle * TAU) * 2 + 0.25));
  return g * g * 0.5 * (1 - rain);
}

export function moonPhase(totalTicks: number): number {
  return ((Math.floor(totalTicks / 24000) % 8) + 8) % 8;
}

export function hexToRgb(hex: number, out: Rgb): Rgb {
  out[0] = ((hex >> 16) & 255) / 255;
  out[1] = ((hex >> 8) & 255) / 255;
  out[2] = (hex & 255) / 255;
  return out;
}

// flash is the lightning flash 0..1.
export function skyColor(biomeSky: number, angle: number, rain: number, thunder: number, flash: number, out: Rgb): Rgb {
  hexToRgb(biomeSky, out);
  const g = sunHeight(angle);
  let r = out[0] * g, gr = out[1] * g, b = out[2] * g;
  if (rain > 0) {
    const l = (r * 0.3 + gr * 0.59 + b * 0.11) * 0.6;
    const m = 1 - rain * 0.75;
    r = r * m + l * (1 - m); gr = gr * m + l * (1 - m); b = b * m + l * (1 - m);
  }
  if (thunder > 0) {
    const l = (r * 0.3 + gr * 0.59 + b * 0.11) * 0.2;
    const m = 1 - thunder * 0.75;
    r = r * m + l * (1 - m); gr = gr * m + l * (1 - m); b = b * m + l * (1 - m);
  }
  if (flash > 0) {
    const f = Math.min(1, flash) * 0.45;
    r = r * (1 - f) + 0.8 * f; gr = gr * (1 - f) + 0.8 * f; b = b * (1 - f) + 1 * f;
  }
  out[0] = r; out[1] = gr; out[2] = b;
  return out;
}

export function sunriseColor(angle: number, out: Rgba): boolean {
  const h = Math.cos(angle * TAU);
  if (h < -0.4 || h > 0.4) { out[3] = 0; return false; }
  const j = (h / 0.4) * 0.5 + 0.5;
  let k = 1 - (1 - Math.sin(j * Math.PI)) * 0.99;
  k *= k;
  out[0] = j * 0.3 + 0.7;
  out[1] = j * j * 0.7 + 0.2;
  out[2] = 0.2;
  out[3] = k;
  return true;
}

export const sunSide = (angle: number) => (Math.sin(angle * TAU) > 0 ? -1 : 1);

const sunrise: Rgba = [0, 0, 0, 0];

// lookX: camera forward x on the horizontal plane, normalized.
export function overworldFog(
  biomeFog: number, sky: Rgb, angle: number, renderChunks: number, lookX: number,
  rain: number, thunder: number, out: Rgb,
): Rgb {
  hexToRgb(biomeFog, out);
  const sh = sunHeight(angle);
  out[0] *= sh * 0.94 + 0.06;
  out[1] *= sh * 0.94 + 0.06;
  out[2] *= sh * 0.91 + 0.09;
  if (renderChunks >= 4) {
    let k = lookX * sunSide(angle);
    if (k > 0 && sunriseColor(angle, sunrise)) {
      k *= sunrise[3];
      for (let i = 0; i < 3; i++) out[i] = out[i] * (1 - k) + sunrise[i] * k;
    }
  }
  const f = 1 - Math.pow(0.25 + (0.75 * renderChunks) / 32, 0.25);
  for (let i = 0; i < 3; i++) out[i] += (sky[i] - out[i]) * f;
  if (rain > 0) {
    const m = 1 - rain * 0.5, n = 1 - rain * 0.4;
    out[0] *= m; out[1] *= m; out[2] *= n;
  }
  if (thunder > 0) {
    const o = 1 - thunder * 0.5;
    out[0] *= o; out[1] *= o; out[2] *= o;
  }
  return out;
}

export function voidFactor(camY: number, bottomY: number): number {
  const d = (camY - bottomY) * 0.03125;
  if (d >= 1) return 1;
  return d < 0 ? 0 : d * d;
}

export function cloudColor(angle: number, rain: number, thunder: number, out: Rgb): Rgb {
  const g = sunHeight(angle);
  let r = g * 0.9 + 0.1, gr = g * 0.9 + 0.1, b = g * 0.85 + 0.15;
  if (rain > 0) {
    const l = (r * 0.3 + gr * 0.59 + b * 0.11) * 0.6;
    const m = 1 - rain * 0.95;
    r = r * m + l * (1 - m); gr = gr * m + l * (1 - m); b = b * m + l * (1 - m);
  }
  if (thunder > 0) {
    const l = (r * 0.3 + gr * 0.59 + b * 0.11) * 0.2;
    const m = 1 - thunder * 0.95;
    r = r * m + l * (1 - m); gr = gr * m + l * (1 - m); b = b * m + l * (1 - m);
  }
  out[0] = r; out[1] = gr; out[2] = b;
  return out;
}

export function skyLightTint(angle: number, rain: number, thunder: number, out: Rgb): Rgb {
  const d = (daylight(angle, rain, thunder) - 0.2) / 0.8;
  const f = d * 0.95 + 0.05;
  out[0] = f + (1 - f) * 0.35;
  out[1] = f + (1 - f) * 0.35;
  out[2] = 1;
  if (sunriseColor(angle, sunrise)) {
    const k = sunrise[3] * 0.3 * (1 - rain);
    for (let i = 0; i < 3; i++) out[i] = out[i] * (1 - k) + sunrise[i] * k;
  }
  return out;
}

export interface FogRange { near: number; far: number }

export function fogRange(dim: "overworld" | "nether" | "end", renderBlocks: number, out: FogRange): FogRange {
  if (dim === "nether") {
    out.near = renderBlocks * 0.05;
    out.far = Math.min(renderBlocks, 192) * 0.5;
  } else {
    out.far = renderBlocks;
    out.near = renderBlocks - Math.min(64, Math.max(4, renderBlocks / 10));
  }
  return out;
}

export function snowsAt(temperature: number, y: number): boolean {
  const t = temperature - (y > 80 ? ((y - 80) * 0.05) / 30 : 0);
  return t < 0.15;
}
