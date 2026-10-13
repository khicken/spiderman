import type { DamageSource, Entity, GameCtx, GameMode, ItemStack, Rules } from "../contracts";
import { armorTotals, difficultyScale, protectionEpf } from "../player/survival";
import { BYPASS_ARMOR, armorReduce, ench, protectionReduce } from "../player/stats";
import type { HostMsg } from "./protocol";

// The host owns each remote player's health and hunger. Clients report what they detect (falls, fire, eating) and display what the host sends.
export interface Health {
  health: number;
  maxHealth: number;
  food: number;
  saturation: number;
  exhaustion: number;
  absorption: number;
  foodTimer: number;
  invulnerable: number;
  lastHurt: number;
  dead: boolean;
  blocking: boolean;
  effects: [string, number][];
  sent: string;
}

export interface HealthOwner {
  hp: Health;
  yaw: number;
  pos: { x: number; y: number; z: number };
  gameMode: GameMode;
  inv: { slots: (ItemStack | null)[]; selected: number; held(): ItemStack | null };
  send(m: HostMsg): void;
}

const SHIELDED = new Set<DamageSource>(["mob", "arrow", "explosion", "player", "trident"]);

export function newHealth(): Health {
  return { health: 20, maxHealth: 20, food: 20, saturation: 5, exhaustion: 0, absorption: 0, foodTimer: 0, invulnerable: 0, lastHurt: 0, dead: false, blocking: false, effects: [], sent: "" };
}

export function resetHealth(h: Health) {
  Object.assign(h, newHealth(), { sent: "" });
}

const level = (h: Health, id: string) => {
  for (const [e, a] of h.effects) if (e === id) return a + 1;
  return 0;
};

const invulnerableMode = (o: HealthOwner) => o.gameMode === "creative" || o.gameMode === "spectator";

export function exhaust(o: HealthOwner, v: number) {
  if (invulnerableMode(o) || !(v > 0)) return;
  o.hp.exhaustion = Math.min(40, o.hp.exhaustion + Math.min(v, 40));
}

export function healBy(o: HealthOwner, n: number) {
  const h = o.hp;
  if (h.dead || !(n > 0)) return;
  h.health = Math.min(h.maxHealth, h.health + n);
}

// Same arithmetic as player/survival.ts damage(); visuals and armor wear happen on the client.
export function hostDamage(o: HealthOwner, ctx: GameCtx, amount: number, source: DamageSource, attacker?: Entity, from?: { x: number; z: number } | null) {
  const h = o.hp;
  if (h.dead || !(amount > 0)) return;
  if (invulnerableMode(o) && source !== "void") return;
  if ((source === "fire" || source === "lava") && level(h, "fire_resistance")) return;
  amount = difficultyScale(ctx, amount, source);
  if (amount <= 0) return;
  const src = from ?? (attacker ? attacker.body.pos : null);
  if (h.blocking && src && SHIELDED.has(source) && -Math.sin(o.yaw) * (src.x - o.pos.x) - Math.cos(o.yaw) * (src.z - o.pos.z) > 0) {
    o.send({ t: "hurt", amount, source, blocked: String(attacker?.data.held ?? "").endsWith("_axe") ? 2 : 1 });
    return;
  }
  let dealt = amount;
  let fresh = false;
  if (h.invulnerable > 10) {
    if (amount <= h.lastHurt) return;
    dealt = amount - h.lastHurt;
    h.lastHurt = amount;
  } else {
    h.lastHurt = amount;
    h.invulnerable = 20;
    fresh = true;
  }
  const inv = { inventory: o.inv } as unknown as Pick<GameCtx, "inventory">;
  let per = 0;
  if (!BYPASS_ARMOR.has(source)) {
    const a = armorTotals(inv);
    dealt = armorReduce(dealt, a.points, a.toughness);
    per = Math.max(1, Math.floor(amount / 4));
  }
  const res = level(h, "resistance");
  if (res > 0 && source !== "void") dealt *= Math.max(0, 1 - res * 0.2);
  dealt = protectionReduce(dealt, protectionEpf(inv, source));
  const absorbed = Math.min(h.absorption, dealt);
  h.absorption -= absorbed;
  dealt -= absorbed;
  exhaust(o, 0.1);
  if (attacker) thorns(o, ctx, attacker);
  if (dealt > 0) h.health = Math.max(0, h.health - dealt);
  if (fresh) o.send({ t: "hurt", amount: dealt, source, armor: per, ax: src?.x, az: src?.z });
  else if (per) o.send({ t: "armor", slots: [36, 37, 38, 39], n: per });
  if (h.health > 0) return;
  const held = o.inv.held()?.item === "totem_of_undying", off = o.inv.slots[40]?.item === "totem_of_undying";
  if (held || off) {
    h.health = 1;
    h.absorption = 4 * 2;
    h.effects = [];
    o.send({ t: "totem" });
    return;
  }
  h.dead = true;
  h.health = 0;
  o.send({ t: "die", source, attacker: attacker?.type });
}

function thorns(o: HealthOwner, ctx: GameCtx, attacker: Entity) {
  const hit: number[] = [];
  for (let i = 36; i <= 39; i++) {
    const lvl = ench(o.inv.slots[i], "thorns");
    if (lvl > 0 && ctx.random() < 0.15 * lvl) {
      ctx.entities.damage(attacker.id, 1 + Math.floor(ctx.random() * 4), "thorns", "player");
      hit.push(i);
    }
  }
  if (hit.length) o.send({ t: "armor", slots: hit, n: 2 });
}

export function tickHealth(o: HealthOwner, ctx: GameCtx, rules: Rules, tick: number) {
  const h = o.hp;
  if (h.invulnerable > 0) h.invulnerable--;
  if (!h.dead) {
    const diff = rules.difficulty;
    if (h.exhaustion > 4) {
      h.exhaustion -= 4;
      if (h.saturation > 0) h.saturation = Math.max(h.saturation - 1, 0);
      else if (diff !== "peaceful") h.food = Math.max(h.food - 1, 0);
    }
    const hurt = h.health > 0 && h.health < h.maxHealth;
    if (diff === "peaceful") {
      if (hurt && tick % 20 === 0) healBy(o, 1);
      if (h.food < 20 && tick % 10 === 0) h.food++;
    }
    if (h.saturation > 0 && hurt && h.food >= 20) {
      if (++h.foodTimer >= 10) {
        const f = Math.min(h.saturation, 6);
        healBy(o, f / 6);
        exhaust(o, f);
        h.foodTimer = 0;
      }
    } else if (h.food >= 18 && hurt) {
      if (++h.foodTimer >= 80) {
        healBy(o, 1);
        exhaust(o, 6);
        h.foodTimer = 0;
      }
    } else if (h.food <= 0) {
      if (++h.foodTimer >= 80) {
        if (h.health > 10 || diff === "hard" || (h.health > 1 && diff === "normal")) hostDamage(o, ctx, 1, "starve");
        h.foodTimer = 0;
      }
    } else h.foodTimer = 0;
  }
  const j = `${h.health},${h.food},${h.saturation},${h.absorption}`;
  if (j !== h.sent) {
    h.sent = j;
    o.send({ t: "stats", health: h.health, food: h.food, saturation: h.saturation, absorption: h.absorption });
  }
}
