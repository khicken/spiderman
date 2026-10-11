import type { Entity, GameCtx } from "../contracts";

const TAU = Math.PI * 2;

export function celestialAngle(dayTime: number) {
  const d = ((dayTime / 24000 - 0.25) % 1 + 1) % 1;
  const e = 0.5 - Math.cos(d * Math.PI) / 2;
  return (d * 2 + e) / 3;
}

// Vanilla skyDarken 0 (noon) .. 11 (night), with rain and thunder.
export function skyDarken(ctx: GameCtx) {
  const f = celestialAngle(ctx.time.dayTime);
  let d = 1 - (Math.cos(f * TAU) * 2 + 0.5);
  d = Math.min(1, Math.max(0, d));
  d = 1 - d;
  d *= 1 - (ctx.time.rain * 5) / 16;
  d *= 1 - (ctx.time.thunder * 5) / 16;
  return Math.floor((1 - d) * 11);
}

// Render daylight 0.2 (night) .. 1 (noon), the vanilla sky brightness.
export function daylight(ctx: GameCtx) {
  const f = celestialAngle(ctx.time.dayTime);
  let g = 1 - (Math.cos(f * TAU) * 2 + 0.2);
  g = Math.min(1, Math.max(0, g));
  g = 1 - g;
  g *= 1 - (ctx.time.rain * 5) / 16;
  g *= 1 - (ctx.time.thunder * 5) / 16;
  return g * 0.8 + 0.2;
}

// Vanilla getMaxLocalRawBrightness: max(block light, sky light - skyDarken).
export function lightAt(ctx: GameCtx, x: number, y: number, z: number, darken = skyDarken(ctx)) {
  const bx = Math.floor(x);
  const by = Math.floor(y);
  const bz = Math.floor(z);
  const sky = ctx.world.getSkyLight(bx, by, bz) - darken;
  const block = ctx.world.getBlockLight(bx, by, bz);
  return Math.max(0, Math.max(sky, block));
}

export function canSeeSky(ctx: GameCtx, x: number, y: number, z: number) {
  return ctx.world.getSkyLight(Math.floor(x), Math.floor(y), Math.floor(z)) >= 15;
}

// Vanilla isSunBurnTick for undead mobs: day, open sky, not wet.
export function sunBurns(e: Entity, ctx: GameCtx) {
  if (ctx.world.dim !== "overworld" || e.body.inWater || ctx.time.rain > 0.2) return false;
  const ey = e.body.pos.y + e.body.height * 0.85;
  const darken = skyDarken(ctx);
  const br = brightnessCurve(lightAt(ctx, e.body.pos.x, ey, e.body.pos.z, darken));
  return br > 0.5 && ctx.random() * 30 < (br - 0.4) * 2 && darken < 4 && canSeeSky(ctx, e.body.pos.x, ey, e.body.pos.z);
}

// Vanilla light-level to brightness curve (dimension ambient 0).
export function brightnessCurve(level: number) {
  const f = level / 15;
  return f / (4 - 3 * f);
}

