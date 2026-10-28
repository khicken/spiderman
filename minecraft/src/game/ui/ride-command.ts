import type { Entity, GameCtx } from "../contracts";
import { mobDef } from "../entities/registry";
import { dismountMob, dismountPlayer } from "../entities/riding";
import { titleCase } from "./data";

type Target = Entity | "player";

const TOO_MANY = "Only one entity is allowed, but the provided selector allows more than one";
const NONE = "No entity was found";

function vehicleOf(ctx: GameCtx, t: Target): Entity | undefined {
  const id = t === "player" ? ctx.player.vehicle : t.data.mount;
  return typeof id === "number" ? ctx.entities.get(id) : undefined;
}

// A single-entity selector: a player name, @s/@p/@r, @n, or @e with limit=1.
function select(ctx: GameCtx, s: string | undefined, player: string, fail: (m: string) => never): Target {
  if (!s) return fail("Unknown or incomplete command, see below for error");
  if (/^@[spr](\[|$)/.test(s) || s.toLowerCase() === player.toLowerCase()) return "player";
  if (/^@a(\[|$)/.test(s)) return fail(TOO_MANY);
  const m = /^@([en])(?:\[(.*)\])?$/.exec(s);
  if (!m) return fail(NONE);
  const args = new Map<string, string>();
  for (const kv of (m[2] ?? "").split(",").filter(Boolean)) {
    const [k, v = ""] = kv.split("=");
    args.set(k.trim(), v.trim());
  }
  const limit = m[1] === "n" ? 1 : args.has("limit") ? Number(args.get("limit")) : Infinity;
  if (limit !== 1) return fail(TOO_MANY);
  const typeArg = args.get("type")?.replace("minecraft:", "");
  const not = typeArg?.startsWith("!") ?? false;
  const type = not ? typeArg!.slice(1) : typeArg;
  const typeOk = (t: string) => !type || (not ? t !== type : t === type);
  const p = ctx.player.body.pos;
  const dist = args.get("distance");
  let lo = 0, hi = Infinity;
  if (dist) {
    const [a, b] = dist.includes("..") ? dist.split("..") : [dist, dist];
    lo = a ? Number(a) : 0;
    hi = b ? Number(b) : Infinity;
  }
  const name = args.get("name");
  const cands: { t: Target; d: number }[] = [];
  const consider = (t: Target, x: number, y: number, z: number) => {
    const d = Math.hypot(x - p.x, y - p.y, z - p.z);
    if (d >= lo && d <= hi) cands.push({ t, d });
  };
  if (typeOk("player") && !ctx.player.dead && (!name || name === player)) consider("player", p.x, p.y, p.z);
  for (const e of ctx.entities.all()) if (!e.dead && typeOk(e.type) && (!name || e.data.name === name)) consider(e, e.body.pos.x, e.body.pos.y, e.body.pos.z);
  const sort = m[1] === "n" ? "nearest" : args.get("sort") ?? "arbitrary";
  if (sort === "nearest") cands.sort((a, b) => a.d - b.d);
  else if (sort === "furthest") cands.sort((a, b) => b.d - a.d);
  else if (sort === "random") cands.sort(() => ctx.random() - 0.5);
  return cands[0]?.t ?? fail(NONE);
}

const nameOf = (t: Target, player: string) => (t === "player" ? player : (t.data.name as string | undefined) ?? mobDef(t.type)?.displayName ?? titleCase(t.type));

// Vanilla RideCommand.
export function rideCommand(ctx: GameCtx, a: string[], player: string, fail: (m: string) => never): string[] {
  const target = select(ctx, a[0], player, fail);
  const name = nameOf(target, player);
  if (a[1] === "dismount") {
    const v = vehicleOf(ctx, target);
    if (!v) return fail(`${name} is not riding any vehicle`);
    if (target === "player") dismountPlayer(ctx);
    else dismountMob(target);
    return [`${name} stopped riding ${nameOf(v, player)}`];
  }
  if (a[1] !== "mount") return fail("Unknown or incomplete command, see below for error");
  const vehicle = select(ctx, a[2], player, fail);
  const cur = vehicleOf(ctx, target);
  if (cur) return fail(`${name} is already riding ${nameOf(cur, player)}`);
  if (vehicle === "player") return fail("Players can't be ridden");
  for (let x: Entity | undefined = vehicle, i = 0; x && i < 64; x = vehicleOf(ctx, x), i++) if (x === target) return fail("Can't mount entity on itself or any of its passengers");
  if (vehicle.dead) return fail(`${name} couldn't start riding ${nameOf(vehicle, player)}`);
  if (target === "player") {
    if (ctx.player.gameMode === "spectator") return fail(`${name} couldn't start riding ${nameOf(vehicle, player)}`);
    ctx.player.vehicle = vehicle.id;
    ctx.player.flying = false;
    vehicle.data._ctl = undefined;
  } else target.data.mount = vehicle.id;
  return [`${name} started riding ${nameOf(vehicle, player)}`];
}
