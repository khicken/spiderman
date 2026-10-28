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
  granted: Map<string, { amp: number; until: number }>; // effects from sources the host saw, by host tick
  credit: { food: number; sat: number }; // food the client may add: what it was seen eating
  now: number;
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
  return {
    health: 20, maxHealth: 20, food: 20, saturation: 5, exhaustion: 0, absorption: 0, foodTimer: 0, invulnerable: 0, lastHurt: 0, dead: false, blocking: false,
    effects: [], granted: new Map(), credit: { food: 0, sat: 0 }, now: 0, sent: "",
  };
}

export function resetHealth(h: Health) {
  Object.assign(h, newHealth(), { sent: "", now: h.now });
}

// Effects the host acts on, so a client cannot claim them: damage cuts, healing, extra hearts.
const TRUSTED = new Set(["resistance", "fire_resistance", "regeneration", "absorption", "health_boost", "saturation"]);
const CLAIM_SLACK = 40;

export function grantEffect(h: Health, id: string, amp: number, ticks: number) {
  const g = h.granted.get(id);
  h.granted.set(id, { amp: Math.max(amp, g?.amp ?? 0), until: Math.max(g?.until ?? 0, h.now + ticks) });
  if (id === "absorption") h.absorption = Math.max(h.absorption, 4 * (amp + 1));
}

const grantedAmp = (h: Health, id: string) => {
  const g = h.granted.get(id);
  return g && h.now <= g.until + CLAIM_SLACK ? g.amp : -1;
};

// What the client says it has, cut down to what the host granted.
export function claimEffects(h: Health, eff: [string, number][], abs: number, max: number) {
  h.effects = eff.filter(([id, amp]) => !TRUSTED.has(id) || amp <= grantedAmp(h, id));
  h.absorption = Math.min(h.absorption, abs, grantedAmp(h, "absorption") >= 0 ? 4 * (grantedAmp(h, "absorption") + 1) : 0);
  const boost = h.effects.find(([id]) => id === "health_boost");
  h.maxHealth = Math.min(max, boost ? 20 + 4 * (boost[1] + 1) : 20);
  h.health = Math.min(h.health, h.maxHealth);
}

export function eatCredit(h: Health, food: number, sat: number) {
  h.credit.food = Math.min(20, h.credit.food + food);
  h.credit.sat = Math.min(20, h.credit.sat + sat);
}

// A client food change: losses always count, gains only up to what it was seen eating. True when a gain was cut.
export function foodDelta(h: Health, df: number, ds: number): boolean {
  const cut = df > h.credit.food + 1e-6 || ds > h.credit.sat + 1e-6;
  if (df > 0) h.credit.food -= df = Math.min(df, h.credit.food);
  if (ds > 0) h.credit.sat -= ds = Math.min(ds, h.credit.sat);
  h.food = Math.max(0, Math.min(20, h.food + df));
  h.saturation = Math.max(0, Math.min(h.food, h.saturation + ds));
  return cut;
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
  amount = difficultyScale(ctx, amount, source, attacker);
  if (amount <= 0) return;
  const src = from ?? (attacker ? attacker.body.pos : null);
  if (h.blocking && src && SHIELDED.has(source) && -Math.sin(o.yaw) * (src.x - o.pos.x) - Math.cos(o.yaw) * (src.z - o.pos.z) > 0) {
    o.send({ t: "hurt", amount, source, blocked: String(attacker?.data.held ?? "").endsWith("_axe") && ctx.random() < 0.25 ? 2 : 1 });
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
    per = Math.max(1, Math.floor(dealt / 4));
    dealt = armorReduce(dealt, a.points, a.toughness);
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
    h.granted.clear();
    grantEffect(h, "regeneration", 1, 900);
    grantEffect(h, "absorption", 1, 100);
    grantEffect(h, "fire_resistance", 0, 800);
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
  h.now = tick;
  if (h.invulnerable > 0) h.invulnerable--;
  for (const [id, g] of h.granted) if (tick > g.until + CLAIM_SLACK) h.granted.delete(id);
  if (h.effects.some(([id]) => TRUSTED.has(id) && grantedAmp(h, id) < 0)) claimEffects(h, h.effects, h.absorption, h.maxHealth);
  if (!h.dead) {
    // Vanilla MobEffect ticks for the effects the host acts on.
    for (const [id, a] of h.effects) {
      const k = 50 >> a;
      if (id === "regeneration" && (k <= 0 || tick % k === 0)) healBy(o, 1);
      if (id === "saturation") {
        h.food = Math.min(20, h.food + a + 1);
        h.saturation = Math.min(h.food, h.saturation + (a + 1) * 2);
      }
    }
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
