import type { GameCtx, GameEvent } from "../../contracts";
import { blockByName } from "../../blocks/registry";
import { itemDef } from "../../items/registry";
import { mobDef } from "../../entities/registry";
import type { AdvTrigger } from "../advancements/bus";

type Counter = Record<string, number>;

interface Stats {
  custom: Counter;
  mined: Counter;
  crafted: Counter;
  used: Counter;
  killed: Counter;
  killedBy: Counter;
}

const empty = (): Stats => ({ custom: {}, mined: {}, crafted: {}, used: {}, killed: {}, killedBy: {} });
let stats = empty();
let last: { x: number; y: number; z: number } | null = null;
let wasGround = true;

const add = (c: Counter, k: string, n = 1) => {
  if (k) c[k] = (c[k] ?? 0) + n;
};

export function statMined(block: string) {
  add(stats.mined, block);
}

export function statTrigger(t: AdvTrigger) {
  switch (t.t) {
    case "killed_entity":
      if (!t.byPlayer) return;
      add(stats.killed, t.type);
      add(stats.custom, t.type === "player" ? "player_kills" : "mob_kills");
      return;
    case "consumed_item":
      add(stats.used, t.item);
      return;
    case "placed_block":
      add(stats.used, blockByName(t.block)?.item ?? t.block);
      return;
    case "crafted":
      add(stats.crafted, t.item);
      return;
    case "shot":
      add(stats.used, t.item);
      return;
    case "item_used_on_block":
      if (t.to === undefined && t.item) add(stats.used, t.item);
      return;
    case "bred_animals":
      add(stats.custom, "animals_bred");
      return;
    case "fished":
      add(stats.custom, "fish_caught");
      return;
    case "villager_trade":
      add(stats.custom, "traded_with_villager");
      return;
    case "slept":
      add(stats.custom, "sleep_in_bed");
      stats.custom.time_since_rest = 0;
      return;
    case "enchanted":
      add(stats.custom, "enchant_item");
      return;
    case "interact_entity":
      if (t.type === "villager") add(stats.custom, "talked_to_villager");
      return;
  }
}

export function statEvent(e: GameEvent, ctx: GameCtx) {
  if (e.type === "player_hurt") add(stats.custom, "damage_taken", Math.round(e.amount * 10));
  else if (e.type === "player_died") {
    add(stats.custom, "deaths");
    stats.custom.time_since_death = 0;
    const by = (ctx.player as { lastAttacker?: string }).lastAttacker;
    if (by) add(stats.killedBy, by);
  } else if (e.type === "open_container") {
    const k = { chest: "open_chest", large_chest: "open_chest", ender_chest: "open_enderchest", shulker_box: "open_shulker_box", barrel: "open_barrel", crafting_table: "interact_with_crafting_table", furnace: "interact_with_furnace", blast_furnace: "interact_with_blast_furnace", smoker: "interact_with_smoker", anvil: "interact_with_anvil", brewing_stand: "interact_with_brewingstand", beacon: "interact_with_beacon", hopper: "inspect_hopper", dropper: "inspect_dropper", dispenser: "inspect_dispenser", loom: "interact_with_loom", cartography_table: "interact_with_cartography_table", stonecutter: "interact_with_stonecutter", smithing_table: "interact_with_smithing_table", grindstone: "interact_with_grindstone" }[e.kind as string];
    if (k) add(stats.custom, k);
  }
}

// Vanilla Player.checkMovementStatistics: distances in centimeters, one bucket per way of moving.
export function statTick(ctx: GameCtx) {
  const p = ctx.player;
  const c = stats.custom;
  add(c, "play_time");
  add(c, "total_world_time");
  add(c, "time_since_death");
  add(c, "time_since_rest");
  if (p.sneaking) add(c, "sneak_time");
  const b = p.body.pos;
  if (!last || p.dead) {
    last = { x: b.x, y: b.y, z: b.z };
    return;
  }
  const dx = b.x - last.x, dy = b.y - last.y, dz = b.z - last.z;
  last.x = b.x;
  last.y = b.y;
  last.z = b.z;
  const h = Math.round(Math.hypot(dx, dz) * 100);
  const full = Math.round(Math.hypot(dx, dy, dz) * 100);
  if (full > 1000) return;
  const body = p.body;
  if (p.vehicle != null) {
    const v = ctx.entities.get(p.vehicle);
    const k = v ? ({ minecart: "minecart_one_cm", boat: "boat_one_cm", chest_boat: "boat_one_cm", pig: "pig_one_cm", horse: "horse_one_cm", donkey: "horse_one_cm", mule: "horse_one_cm", strider: "strider_one_cm", camel: "horse_one_cm" } as Record<string, string>)[v.type] : undefined;
    if (k && full > 0) add(c, k, full);
  } else if (p.fallFlying) {
    if (full > 0) add(c, "aviate_one_cm", full);
  } else if (p.pose === "swimming" && body.inWater) {
    if (full > 0) add(c, "swim_one_cm", full);
  } else if (body.onClimbable && dy > 0) {
    add(c, "climb_one_cm", Math.round(dy * 100));
  } else if (body.inWater) {
    if (h > 0) add(c, body.onGround ? "walk_under_water_one_cm" : "walk_on_water_one_cm", h);
  } else if (body.onGround) {
    if (h > 0) add(c, p.sneaking ? "crouch_one_cm" : p.sprinting ? "sprint_one_cm" : "walk_one_cm", h);
  } else if (p.flying) {
    if (full > 0) add(c, "fly_one_cm", full);
  } else if (dy < 0) add(c, "fall_one_cm", Math.round(-dy * 100));
  if (wasGround && !body.onGround && !body.inWater && !p.flying && body.vel.y > 0.3) add(c, "jump");
  wasGround = body.onGround;
}

const dist = (cm: number) => (cm >= 100000 ? `${(cm / 100000).toFixed(2)} km` : cm >= 100 ? `${(cm / 100).toFixed(2)} m` : `${cm} cm`);
function time(ticks: number): string {
  const s = ticks / 20;
  if (s < 60) return `${s.toFixed(2)} s`;
  if (s < 3600) return `${(s / 60).toFixed(2)} min`;
  if (s < 86400) return `${(s / 3600).toFixed(2)} h`;
  if (s < 31536000) return `${(s / 86400).toFixed(2)} d`;
  return `${(s / 31536000).toFixed(2)} y`;
}

// en_us.json stat.minecraft.* labels, in the vanilla General tab order.
const GENERAL: [string, string, "time" | "dist" | "num" | "dmg"][] = [
  ["animals_bred", "Animals Bred", "num"], ["aviate_one_cm", "Distance by Elytra", "dist"], ["boat_one_cm", "Distance by Boat", "dist"], ["climb_one_cm", "Distance Climbed", "dist"],
  ["crouch_one_cm", "Distance Crouched", "dist"], ["damage_taken", "Damage Taken", "dmg"], ["deaths", "Number of Deaths", "num"], ["enchant_item", "Items Enchanted", "num"],
  ["fall_one_cm", "Distance Fallen", "dist"], ["fish_caught", "Fish Caught", "num"], ["fly_one_cm", "Distance Flown", "dist"], ["horse_one_cm", "Distance by Horse", "dist"],
  ["interact_with_anvil", "Interactions with Anvil", "num"], ["interact_with_crafting_table", "Interactions with Crafting Table", "num"], ["interact_with_furnace", "Interactions with Furnace", "num"],
  ["jump", "Jumps", "num"], ["minecart_one_cm", "Distance by Minecart", "dist"], ["mob_kills", "Mob Kills", "num"], ["open_barrel", "Barrels Opened", "num"], ["open_chest", "Chests Opened", "num"],
  ["open_enderchest", "Ender Chests Opened", "num"], ["open_shulker_box", "Shulker Boxes Opened", "num"], ["pig_one_cm", "Distance by Pig", "dist"], ["play_time", "Time Played", "time"],
  ["player_kills", "Player Kills", "num"], ["sleep_in_bed", "Times Slept in a Bed", "num"], ["sneak_time", "Sneak Time", "time"], ["sprint_one_cm", "Distance Sprinted", "dist"],
  ["strider_one_cm", "Distance by Strider", "dist"], ["swim_one_cm", "Distance Swum", "dist"], ["talked_to_villager", "Talked to Villagers", "num"], ["time_since_death", "Time Since Last Death", "time"],
  ["time_since_rest", "Time Since Last Rest", "time"], ["total_world_time", "Time with World Open", "time"], ["traded_with_villager", "Traded with Villagers", "num"],
  ["walk_on_water_one_cm", "Distance Walked on Water", "dist"], ["walk_one_cm", "Distance Walked", "dist"], ["walk_under_water_one_cm", "Distance Walked under Water", "dist"],
];

export function generalRows(): [string, string][] {
  return GENERAL.map(([k, label, kind]) => {
    const v = stats.custom[k] ?? 0;
    return [label, kind === "time" ? time(v) : kind === "dist" ? dist(v) : kind === "dmg" ? (v / 10).toFixed(1) : String(v)];
  });
}

export interface ItemStatRow {
  item: string;
  name: string;
  mined: number;
  crafted: number;
  used: number;
}

export function itemRows(): ItemStatRow[] {
  const keys = new Set([...Object.keys(stats.mined).map((b) => blockByName(b)?.item ?? b), ...Object.keys(stats.crafted), ...Object.keys(stats.used)]);
  const minedByItem: Counter = {};
  for (const [b, n] of Object.entries(stats.mined)) add(minedByItem, blockByName(b)?.item ?? b, n);
  return [...keys]
    .filter((k) => k && itemDef(k))
    .map((k) => ({ item: k, name: itemDef(k)!.displayName, mined: minedByItem[k] ?? 0, crafted: stats.crafted[k] ?? 0, used: stats.used[k] ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function mobRows(): [string, string][] {
  const types = new Set([...Object.keys(stats.killed), ...Object.keys(stats.killedBy)]);
  const out: [string, string][] = [];
  for (const t of [...types].sort()) {
    const name = mobDef(t)?.displayName ?? t;
    const k = stats.killed[t] ?? 0, by = stats.killedBy[t] ?? 0;
    out.push([name, `${k ? `You killed ${k} ${name}` : `You have never killed ${name}`}`]);
    out.push(["", by ? `${name} killed you ${by} time(s)` : `You have never been killed by ${name}`]);
  }
  return out;
}

export function saveStats(): Stats {
  return stats;
}

export function loadStats(data: unknown) {
  const d = (data ?? {}) as Partial<Stats>;
  stats = { ...empty(), ...d } as Stats;
  for (const k of Object.keys(empty()) as (keyof Stats)[]) if (!stats[k] || typeof stats[k] !== "object") stats[k] = {};
  last = null;
}
