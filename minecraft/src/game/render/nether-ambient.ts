import type { WorldApi } from "../contracts";
import { OPAQUE } from "../blocks/registry";
import { idOf } from "../contracts";

// Vanilla biome ambient particles: kind and chance per sampled air block.
const AMBIENT: Record<string, [number, number]> = {
  basalt_deltas: [0, 0.118093334],
  soul_sand_valley: [1, 0.00625],
  crimson_forest: [2, 0.025],
  warped_forest: [3, 0.01428],
};
const W = [1, 4, 6, 4, 1];
let acc = 0;

// Vanilla CubicSampler-style blend of the biome fog colors around the camera, so fog fades across borders.
export function blendedFog(world: WorldApi, x: number, z: number, out: [number, number, number] | number[]) {
  let r = 0, g = 0, b = 0, t = 0;
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const c = world.getBiome(Math.floor(x) + (i - 2) * 4, Math.floor(z) + (j - 2) * 4).fogColor, k = W[i] * W[j];
      r += ((c >> 16) & 255) * k;
      g += ((c >> 8) & 255) * k;
      b += (c & 255) * k;
      t += k;
    }
  }
  out[0] = r / t / 255;
  out[1] = g / t / 255;
  out[2] = b / t / 255;
}

// Vanilla doAnimateTick: 667 samples within 16 and 667 within 32 blocks per client tick.
export function netherAmbient(world: WorldApi, cx: number, cy: number, cz: number, dt: number, spawn: (kind: number, x: number, y: number, z: number) => void) {
  acc += dt;
  let ticks = 0;
  while (acc >= 0.05 && ticks < 2) {
    acc -= 0.05;
    ticks++;
    for (let n = 0; n < 1334; n++) {
      const r = n & 1 ? 32 : 16;
      const x = Math.floor(cx + Math.floor(Math.random() * r) - Math.floor(Math.random() * r));
      const y = Math.floor(cy + Math.floor(Math.random() * r) - Math.floor(Math.random() * r));
      const z = Math.floor(cz + Math.floor(Math.random() * r) - Math.floor(Math.random() * r));
      if (y < 0 || y > 127) continue;
      const a = AMBIENT[world.getBiome(x, z).name];
      if (!a || Math.random() >= a[1] || OPAQUE[idOf(world.getBlock(x, y, z))]) continue;
      spawn(a[0], x + Math.random(), y + Math.random(), z + Math.random());
    }
  }
  if (acc > 0.1) acc = 0;
}
