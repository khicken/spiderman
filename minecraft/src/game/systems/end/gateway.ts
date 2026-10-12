import type { GameCtx } from "../../contracts";
import { stateOf } from "../../contracts";
import { OPAQUE, SOLID, blockByName } from "../../blocks/registry";
import { endTopAt } from "../../worldgen/end";
import { END_STATE, type Gateway } from "./state";
import { buildGateway } from "./exit";

const same = (g: Gateway, x: number, y: number, z: number) => g.x === x && g.y === y && g.z === z;

interface Pending {
  x: number;
  y: number;
  z: number;
  build: { origin: Gateway; ground: number } | null;
  ticks: number;
}

let pending: Pending | null = null;
let cooldownUntil = 0;

export const gatewayPending = () => pending !== null;

export function resetGateways() {
  pending = null;
  cooldownUntil = 0;
}

// Vanilla aims 1024 blocks out along the gateway direction and walks outward 16 at a time until it finds land.
function findExit(seed: number, gx: number, gz: number): { x: number; z: number; top: number } {
  let dx = gx, dz = gz;
  const l = Math.hypot(dx, dz);
  if (l < 1) dx = 1, dz = 0;
  else dx /= l, dz /= l;
  for (let k = 0; k < 64; k++) {
    const d = 1024 + k * 16;
    const bx = Math.floor(dx * d), bz = Math.floor(dz * d);
    for (let ox = -8; ox <= 8; ox += 4) {
      for (let oz = -8; oz <= 8; oz += 4) {
        const top = endTopAt(seed, bx + ox, bz + oz);
        if (top > 0) return { x: bx + ox, z: bz + oz, top };
      }
    }
  }
  return { x: Math.floor(dx * 1024), z: Math.floor(dz * 1024), top: -1 };
}

export function enterGateway(ctx: GameCtx, gx: number, gy: number, gz: number): void {
  if (ctx.world.dim !== "end" || pending || ctx.time.tick < cooldownUntil) return;
  cooldownUntil = ctx.time.tick + 40;
  const outer = END_STATE.outer.find((g) => same(g, gx, gy, gz));
  ctx.emit({ type: "sound", name: "block.end_gateway.spawn", x: gx + 0.5, y: gy + 0.5, z: gz + 0.5, volume: 1 });
  if (outer?.exit) {
    pending = { x: outer.exit.x + 0.5, y: outer.exit.y + 3, z: outer.exit.z + 0.5, build: null, ticks: 0 };
    return;
  }
  let main = END_STATE.gateways.find((g) => same(g, gx, gy, gz));
  if (!main) {
    main = { x: gx, y: gy, z: gz };
    END_STATE.gateways.push(main);
  }
  if (main.exit) {
    pending = { x: main.exit.x + 0.5, y: main.exit.y - 9, z: main.exit.z + 0.5, build: null, ticks: 0 };
    return;
  }
  const f = findExit(ctx.world.seed, gx, gz);
  pending = { x: f.x + 0.5, y: f.top > 0 ? f.top + 1 : 66, z: f.z + 0.5, build: { origin: main, ground: f.top }, ticks: 0 };
}

function groundY(ctx: GameCtx, x: number, z: number): number {
  for (let y = 120; y > 0; y--) {
    const id = ctx.world.getBlock(x, y, z) & 0xfff;
    if (SOLID[id] && OPAQUE[id]) return y;
  }
  return -1;
}

function finish(ctx: GameCtx, p: Pending) {
  const x = Math.floor(p.x), z = Math.floor(p.z);
  let feet = p.y;
  if (p.build) {
    let g = groundY(ctx, x, z);
    if (g < 0) {
      const stone = stateOf(blockByName("end_stone")!.id);
      for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
        const r = dx * dx + dz * dz;
        if (r > 18) continue;
        for (let dy = 0; dy < (r < 6 ? 3 : r < 12 ? 2 : 1); dy++) ctx.world.setBlock(x + dx, 64 - dy, z + dz, stone, 0);
      }
      g = 64;
    }
    const exit: Gateway = { x, y: g + 10, z, exit: { x: p.build.origin.x, y: p.build.origin.y, z: p.build.origin.z } };
    buildGateway(ctx.world, exit.x, exit.y, exit.z);
    END_STATE.outer.push(exit);
    p.build.origin.exit = { x: exit.x, y: exit.y, z: exit.z };
    feet = g + 1;
  } else {
    const g = groundY(ctx, x, z);
    if (g > 0 && feet < g + 1) feet = g + 1;
  }
  ctx.player.teleport(p.x, feet, p.z);
  ctx.player.body.fallDistance = 0;
  ctx.emit({ type: "sound", name: "entity.enderman.teleport", x: p.x, y: feet, z: p.z, volume: 1 });
}

// Holds the player still at the target until the chunks there load, then lands them and builds the exit gateway.
export function tickGateway(ctx: GameCtx): void {
  const p = pending;
  if (!p) return;
  if (ctx.world.dim !== "end") {
    pending = null;
    return;
  }
  p.ticks++;
  const b = ctx.player.body;
  if (!ctx.world.ready(p.x, p.z) && p.ticks < 600) {
    ctx.player.teleport(p.x, p.y + 1, p.z);
    b.vel.set(0, 0, 0);
    b.fallDistance = 0;
    return;
  }
  pending = null;
  cooldownUntil = ctx.time.tick + 40;
  finish(ctx, p);
}

export function tickPearls(ctx: GameCtx): void {
  if (ctx.world.dim !== "end") return;
  const gw = blockByName("end_gateway")?.id;
  for (const e of ctx.entities.all()) {
    if (e.type !== "ender_pearl" || e.dead || e.data._remove) continue;
    const p = e.body.pos;
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    if ((ctx.world.getBlock(x, y, z) & 0xfff) !== gw) continue;
    e.data._remove = true;
    enterGateway(ctx, x, y, z);
  }
}
