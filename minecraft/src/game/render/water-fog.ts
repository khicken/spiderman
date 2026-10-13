import type { Rgb } from "./celestial";
import { hexToRgb } from "./celestial";

// Vanilla biome water_fog_color; every other biome uses the default 0x050533.
const WATER_FOG: Record<string, number> = {
  warm_ocean: 0x041f33,
  lukewarm_ocean: 0x041633,
  deep_lukewarm_ocean: 0x041633,
  swamp: 0x232317,
  mangrove_swamp: 0x4d7a60,
  cherry_grove: 0x5db7ef,
};

const target: Rgb = [0, 0, 0];

export function createWaterFog() {
  const col: Rgb = [0.02, 0.02, 0.2];
  let ticks = 0;
  let fresh = true;
  return {
    // Vanilla LocalPlayer waterVisionTime: +1 per tick with the eyes in water, -10 out of it.
    step(dt: number, under: boolean) {
      ticks = under ? Math.min(600, ticks + dt * 20) : Math.max(0, ticks - dt * 200);
      if (!under) fresh = true;
    },
    vision() {
      if (ticks >= 600) return 1;
      const f = Math.min(1, ticks / 100);
      const g = ticks < 100 ? 0 : Math.min(1, (ticks - 100) / 500);
      return f * 0.6 + g * 0.4;
    },
    // Fog color fades over 5 s to the new biome's color, then brightens with water vision.
    color(biome: string, dt: number, out: Rgb): Rgb {
      hexToRgb(WATER_FOG[biome] ?? 0x050533, target);
      const k = fresh ? 1 : Math.min(1, dt / 5);
      fresh = false;
      for (let i = 0; i < 3; i++) col[i] += (target[i] - col[i]) * k;
      const v = this.vision();
      const y = Math.min(1 / Math.max(col[0], 1e-4), 1 / Math.max(col[1], 1e-4), 1 / Math.max(col[2], 1e-4));
      for (let i = 0; i < 3; i++) out[i] = col[i] * (1 - v) + col[i] * y * v;
      return out;
    },
    far(biome: string, renderBlocks: number) {
      let end = 96 * Math.max(0.25, this.vision());
      if (biome === "swamp" || biome === "mangrove_swamp") end *= 0.85;
      return Math.min(end, renderBlocks);
    },
  };
}
