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
  pale_garden: 0x556980,
};

const target: Rgb = [0, 0, 0];
const surface: Rgb = [0, 0, 0];

// Underwater fog, tuned to be easier to see through than vanilla. Vanilla timing is kept (water vision builds over 30 s),
// but the fog starts further out and its color is the lit water color rather than vanilla's near black, then neon, blue.
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
    // biome fog color (fades over 5 s like vanilla) mixed into the biome's surface water color, scaled by daylight.
    color(biome: string, waterColor: number, day: number, dt: number, out: Rgb): Rgb {
      hexToRgb(WATER_FOG[biome] ?? 0x050533, target);
      const k = fresh ? 1 : Math.min(1, dt / 5);
      fresh = false;
      for (let i = 0; i < 3; i++) col[i] += (target[i] - col[i]) * k;
      hexToRgb(waterColor, surface);
      const v = this.vision();
      const lit = (0.5 + 0.25 * v) * (0.3 + 0.7 * day);
      for (let i = 0; i < 3; i++) out[i] = col[i] * 0.4 + surface[i] * lit * 0.85;
      return out;
    },
    // Vanilla ends at 96 * max(0.25, vision); this starts at 48 blocks so the first seconds are not murky.
    far(biome: string, renderBlocks: number) {
      let end = 96 * Math.max(0.5, this.vision());
      if (biome === "swamp" || biome === "mangrove_swamp") end *= 0.85;
      return Math.min(end, renderBlocks);
    },
    // Light boost while submerged, fed to the night vision path so deep floors are not black.
    light() {
      return 0.3 + 0.2 * this.vision();
    },
  };
}
