import * as THREE from "three";
import type { BlockState, DamageSource, Dim, Entity, EntityApi, EntitySave, GameCtx, GameEvent, GameMode, PlayerApi } from "../contracts";
import { idOf } from "../contracts";
import { BLOCKS } from "../blocks/registry";
import type { PlayerPicker } from "../entities";
import { createInventory } from "../items";
import { SLEEP_RULE } from "../mechanics/interact";
import { makeBody } from "../player/physics";
import { runCommand, setPlayerName } from "../ui/commands";
import type { KeepCenter, World } from "../world";
import { saveMeta, type WorldMeta } from "../world/save";
import { findSpawn } from "../worldgen";
import { packChunk } from "./codec";
import { closeDim, openDim, tickDim, type DimState } from "./host-dims";
import { createTracker, type EntityTracker } from "./host-sync";
import type { GameInternals, Inventory, NetLink } from "./index";
import { playerName, skinOf } from "./profile";
import { cleanName, F, MAX_PLAYERS, PROTOCOL, newRoomCode, num, type ClientMsg, type Equip, type HostMsg, type PlayerListEntry, type PlayerRecord, type PlayerSnap } from "./protocol";
import { createTransport, type Transport } from "./transport";
import { createAvatars } from "./avatars";
import { setAdvancementSink } from "../systems/advancements";
import { exhaust, healBy, hostDamage, newHealth, resetHealth, tickHealth, type Health, type HealthOwner } from "./host-health";

export interface LanOptions {
  gameMode: GameMode;
  cheats: boolean;
}

interface Remote {
  peer: string;
  num: number;
  name: string;
  skin: 0 | 1;
  dim: Dim;
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  f: number;
  sw: number;
  eq: Equip;
  center: KeepCenter | null;
  reqs: Map<number, [number, number]>;
  tracker: EntityTracker;
  inv: Inventory;
  proxy: PlayerApi & { addEffect(id: string, amp: number, ticks: number): void };
  record: PlayerRecord;
  viewJson: string;
  lastMove: number;
  moveTick: number;
  joinedAt: number;
  dimTick: number;
  hp: Health;
  owner: HealthOwner;
}

type Meta = WorldMeta & { players?: Record<string, PlayerRecord> };

const SOUND_RANGE = 48;
const TICKED = new Set(["furnace", "lit_furnace", "blast_furnace", "lit_blast_furnace", "smoker", "lit_smoker", "brewing_stand", "hopper"]);
const CHUNKS_PER_TICK = 6;
const MAX_RD = 8;
const REACH = 12;
const key = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);
const clampRd = (r: number) => Math.max(2, Math.min(MAX_RD, r | 0));

export async function createHost(g: GameInternals, opts: LanOptions): Promise<NetLink> {
  const code = newRoomCode();
  const t: Transport = await createTransport(code);
  const meta = g.meta as Meta;
  const hostName = playerName();
  setPlayerName(hostName);
  const ownCheats = g.ctx.rules.cheats;
  if (opts.cheats) g.ctx.rules.cheats = true;
  const remotes = new Map<string, Remote>();
  const dims = new Map<Dim, DimState>();
  const avatars = createAvatars(() => g.ctx);
  let nextNum = 1;
  let tick = 0;
  let origin: Remote | null = null;
  let active: GameCtx | null = null;
  let ticking: GameCtx | null = null;
  let hostSw = 0;
  let prevAnim = 0;
  let lastDay = g.ctx.time.day;
  let sleepSince = 0;
  let disposed = false;
  const blockQ = new Map<Dim, number[]>();
  const beQ = new Map<Dim, { x: number; y: number; z: number }[]>();

  const send = (r: Remote, m: HostMsg) => t.send(r.peer, m);
  const all = (m: HostMsg) => {
    for (const r of remotes.values()) send(r, m);
  };
  const say = (text: string, color?: string) => {
    g.chat(text, color);
    all({ t: "chat", text, color });
  };

  const worldOf = (d: Dim): World | null => (d === g.dim ? g.world : dims.get(d)?.world ?? null);
  const entsOf = (d: Dim): EntityApi | null => (d === g.dim ? g.entities : dims.get(d)?.entities ?? null);
  const ctxFor = (d: Dim): GameCtx | null => (d === g.dim ? g.ctx : dims.get(d)?.sub ?? null);

  const dimOpts = {
    base: g.ctx,
    seed: meta.seed,
    worldId: meta.id,
    ctxFor,
    emit: (d: Dim, e: GameEvent) => onEvent(d, e),
  };

  function makeProxy(r: Remote): Remote["proxy"] {
    const body = makeBody(0.6, 1.8);
    body.pos = r.pos;
    const eye = new THREE.Vector3();
    const look = new THREE.Vector3();
    const p = {
      body,
      get yaw() {
        return r.yaw;
      },
      set yaw(v: number) {
        r.yaw = v;
      },
      get pitch() {
        return r.pitch;
      },
      set pitch(v: number) {
        r.pitch = v;
      },
      inv: null as unknown as Inventory,
      eye: () => eye.set(r.pos.x, r.pos.y + ((r.f & F.sneak) ? 1.27 : 1.62), r.pos.z),
      lookDir: () => look.set(-Math.sin(r.yaw) * Math.cos(r.pitch), Math.sin(r.pitch), -Math.cos(r.yaw) * Math.cos(r.pitch)),
      get health() {
        return r.hp.health;
      },
      set health(v: number) {
        r.hp.health = Math.max(0, Math.min(r.hp.maxHealth, v));
      },
      get maxHealth() {
        return r.hp.maxHealth;
      },
      get food() {
        return r.hp.food;
      },
      set food(v: number) {
        r.hp.food = Math.max(0, Math.min(20, v));
      },
      get saturation() {
        return r.hp.saturation;
      },
      set saturation(v: number) {
        r.hp.saturation = Math.max(0, v);
      },
      get exhaustion() {
        return r.hp.exhaustion;
      },
      air: 300,
      xpLevel: 0,
      xpProgress: 0,
      xpTotal: 0,
      gameMode: opts.gameMode,
      flying: false,
      sprinting: false,
      get sneaking() {
        return (r.f & F.sneak) !== 0;
      },
      get sleeping() {
        return (r.f & F.sleep) !== 0;
      },
      set sleeping(_v: boolean) {},
      get dead() {
        return r.hp.dead || (r.f & F.dead) !== 0;
      },
      spawn: meta.spawn ?? { x: 0, y: 80, z: 0 },
      effects: [],
      thirdPerson: 0 as const,
      target: null,
      targetEntity: null,
      breakProgress: 0,
      vehicle: null,
      damage(amount: number, source: DamageSource, attacker?: Entity) {
        const c = ctxFor(r.dim);
        const from = p.damageFrom;
        p.damageFrom = null;
        const before = r.hp.health;
        if (c) hostDamage(r.owner, c, amount, source, attacker, from);
        if (r.hp.health < before) avatars.hurt(r.num);
      },
      damageFrom: null as { x: number; y: number; z: number } | null,
      heal(n: number) {
        healBy(r.owner, n);
      },
      addXp(n: number) {
        send(r, { t: "xp", n });
      },
      addExhaustion(v: number) {
        exhaust(r.owner, v);
      },
      teleport(x: number, y: number, z: number) {
        r.pos.set(x, y, z);
        send(r, { t: "tp", x, y, z });
      },
      respawn() {},
      addEffect(id: string, amp: number, ticks: number) {
        send(r, { t: "effect", id, amp, ticks });
      },
    };
    return p as unknown as Remote["proxy"];
  }

  function applyRecord(r: Remote, join = false) {
    const pl = r.record.player as Record<string, unknown> | undefined;
    if (!pl) return;
    const px = r.proxy;
    if (join && typeof pl.health === "number") r.hp.health = Math.max(0, Math.min(20, pl.health));
    if (join && typeof pl.food === "number") r.hp.food = Math.max(0, Math.min(20, pl.food));
    if (join && typeof pl.saturation === "number") r.hp.saturation = Math.max(0, Math.min(20, pl.saturation));
    if (join && pl.dead === true) r.hp.dead = true;
    if (typeof pl.xpLevel === "number") px.xpLevel = pl.xpLevel;
    if (typeof pl.xpTotal === "number") px.xpTotal = pl.xpTotal;
    if (typeof pl.xpProgress === "number") px.xpProgress = pl.xpProgress;
    if (typeof pl.gameMode === "string") px.gameMode = pl.gameMode as GameMode;
    if (pl.spawn && typeof pl.spawn === "object") px.spawn = pl.spawn as PlayerApi["spawn"];
  }

  // Runs host code as if this player were the local one: containers, entity clicks and block edits use its inventory and position.
  function withPlayer<T>(r: Remote, fn: (c: GameCtx) => T): T | undefined {
    const c = ctxFor(r.dim);
    if (!c) return undefined;
    const op = c.player, oi = c.inventory, oa = active, oo = origin;
    const px = r.proxy;
    const before = [px.xpLevel, px.xpTotal, px.xpProgress, px.food, px.health];
    const ot = ticking;
    c.player = px;
    c.inventory = r.inv;
    active = c;
    origin = r;
    ticking = c;
    try {
      return fn(c);
    } catch (e) {
      console.warn("net host:", e);
      return undefined;
    } finally {
      c.player = op;
      c.inventory = oi;
      active = oa;
      origin = oo;
      ticking = ot;
      const after = [px.xpLevel, px.xpTotal, px.xpProgress, px.food, px.health];
      if (after.some((v, i) => v !== before[i])) send(r, { t: "stats", xpLevel: px.xpLevel, xpTotal: px.xpTotal, xpProgress: px.xpProgress, food: px.food, health: px.health });
    }
  }

  // Host code that ticks against a remote player reads its inventory; items it hands over go to the client.
  function remoteInv(r: Remote): Inventory {
    const v = Object.create(r.inv) as Inventory;
    v.add = (stack) => {
      if (stack && stack.count > 0) send(r, { t: "give", stack: { ...stack } });
      return null;
    };
    return v;
  }

  function everyone(d: Dim): PlayerApi[] {
    const out: PlayerApi[] = [];
    if (d === g.dim) out.push(g.player);
    for (const r of remotes.values()) if (r.dim === d) out.push(r.proxy);
    return out;
  }

  function sendView(r: Remote, withInv = true) {
    const v = r.inv.view();
    r.viewJson = v ? JSON.stringify(v) : "";
    send(r, { t: "view", view: v, inv: withInv ? r.inv.save() : undefined });
  }

  // Furnaces and brewing stands tick from one tracker per dimension, whoever placed or opened them.
  function trackIn(d: Dim, x: number, y: number, z: number) {
    if (d === g.dim) return g.inventory.trackBlockEntity(x, y, z);
    const st = dims.get(d);
    if (!st) return;
    st.bes ??= createInventory(() => st.sub);
    st.bes.trackBlockEntity(x, y, z);
  }

  function ensureDim(d: Dim) {
    if (d === g.dim || dims.has(d)) return;
    dims.set(d, openDim(dimOpts, d));
  }

  function picker(d: Dim): PlayerPicker {
    return (e) => {
      if (typeof e.data._net === "number") {
        for (const r of remotes.values()) if (r.num === e.data._net) return r.dim === d ? r.proxy : null;
        return null;
      }
      let best: PlayerApi | null = null;
      let bd = Infinity;
      if (d === g.dim && !g.player.dead && g.player.gameMode !== "spectator") {
        best = g.player;
        bd = g.player.body.pos.distanceToSquared(e.body.pos);
      }
      for (const r of remotes.values()) {
        if (r.dim !== d || (r.f & F.dead) || r.proxy.gameMode === "spectator" || r.proxy.gameMode === "creative") continue;
        const dd = r.pos.distanceToSquared(e.body.pos);
        if (dd < bd) {
          bd = dd;
          best = r.proxy;
        }
      }
      return best;
    };
  }
  (g.ctx as GameCtx & { playerFor?: PlayerPicker }).playerFor = picker(g.dim);
  setAdvancementSink((trig) => {
    const p = (ticking ?? g.ctx).player;
    if (p === g.player) return false;
    for (const r of remotes.values()) if (r.proxy === p) send(r, { t: "advt", trig: JSON.parse(JSON.stringify(trig, (_k, v) => (v instanceof Set ? { __set: [...v] } : v))) });
    return true;
  });
  (g.ctx as GameCtx & { playersAll?: () => PlayerApi[] }).playersAll = () => everyone(g.dim);

  function hello(peer: string, m: Extract<ClientMsg, { t: "hello" }>) {
    if (remotes.has(peer)) return;
    if (m.v !== PROTOCOL) {
      t.send(peer, { t: "full", reason: "Outdated client!" } satisfies HostMsg);
      return;
    }
    if (remotes.size >= MAX_PLAYERS - 1) {
      t.send(peer, { t: "full", reason: "The server is full!" } satisfies HostMsg);
      return;
    }
    let name = cleanName(String(m.name)) || "Player";
    const taken = (n: string) => n.toLowerCase() === hostName.toLowerCase() || [...remotes.values()].some((r) => r.name.toLowerCase() === n.toLowerCase());
    for (let i = 2; taken(name); i++) name = `${cleanName(String(m.name)).slice(0, 13)}_${i}`;
    meta.players ??= {};
    const record: PlayerRecord = meta.players[name] ?? { dim: "overworld", player: undefined, inventory: undefined };
    const saved = record.player as { pos?: [number, number, number] } | undefined;
    const sp = meta.spawn ?? { ...findSpawn(meta.seed), y: 80 };
    const pos = saved?.pos ? new THREE.Vector3(saved.pos[0], saved.pos[1], saved.pos[2]) : new THREE.Vector3(sp.x + 0.5, sp.y, sp.z + 0.5);
    const r: Remote = {
      peer, num: nextNum++, name, skin: skinOf(name), dim: record.dim, pos, yaw: 0, pitch: 0, f: 0, sw: 0,
      eq: { held: null, off: null, armor: [null, null, null, null] }, center: null, reqs: new Map(), tracker: createTracker(),
      inv: createInventory(() => active ?? g.ctx), proxy: null!, record, viewJson: "", lastMove: performance.now(), moveTick: tick, joinedAt: performance.now(), dimTick: tick,
      hp: newHealth(), owner: null!,
    };
    r.owner = {
      get hp() {
        return r.hp;
      },
      get yaw() {
        return r.yaw;
      },
      pos: r.pos,
      get gameMode() {
        return r.proxy.gameMode;
      },
      inv: r.inv,
      send: (m) => send(r, m),
    };
    r.proxy = makeProxy(r);
    (r.proxy as unknown as { inv: Inventory }).inv = remoteInv(r);
    if (record.inventory) r.inv.load(record.inventory);
    applyRecord(r, true);
    r.proxy.gameMode = opts.gameMode;
    remotes.set(peer, r);
    ensureDim(r.dim);
    const tm = g.ctx.time;
    send(r, {
      t: "welcome", v: PROTOCOL, you: r.num, hostName, worldName: meta.name, seed: meta.seed, rules: { ...meta.rules, cheats: opts.cheats }, cheats: opts.cheats,
      gameMode: opts.gameMode, spawn: sp, time: { t: "time", tick: tm.tick, dayTime: tm.dayTime, day: tm.day, rain: tm.rain, thunder: tm.thunder }, save: record.player ? record : undefined,
    });
    say(`§e${name} joined the game`);
  }

  function leave(peer: string, quiet = false) {
    const r = remotes.get(peer);
    if (!r) return;
    if (r.inv.view()) withPlayer(r, () => r.inv.close());
    store(r);
    remotes.delete(peer);
    if (!quiet) say(`§e${r.name} left the game`);
    void saveMeta(meta).catch(() => {});
  }

  function store(r: Remote) {
    meta.players ??= {};
    const player = (r.record.player ?? {}) as Record<string, unknown>;
    player.pos = [r.pos.x, r.pos.y, r.pos.z];
    meta.players[r.name] = { dim: r.dim, player, inventory: r.record.inventory ?? r.inv.save(), adv: r.record.adv };
  }

  // Right after a dimension change the client builds its arrival portal before its first move arrives.
  function nearEye(r: Remote, x: number, y: number, z: number) {
    if (tick - r.dimTick < 200 && r.center && Math.abs((x >> 4) - r.center.cx) <= 2 && Math.abs((z >> 4) - r.center.cz) <= 2) return true;
    const dx = x + 0.5 - r.pos.x, dy = y + 0.5 - (r.pos.y + 1.6), dz = z + 0.5 - r.pos.z;
    return dx * dx + dy * dy + dz * dz <= REACH * REACH;
  }

  function correct(r: Remote, w: World, x: number, y: number, z: number) {
    send(r, { t: "blocks", dim: r.dim, list: [x, y, z, w.getBlock(x, y, z)] });
  }

  function onMessage(peer: string, raw: unknown) {
    const m = raw as ClientMsg;
    if (!m || typeof m !== "object" || typeof m.t !== "string") return;
    if (m.t === "hello") return hello(peer, m);
    const r = remotes.get(peer);
    if (!r) return;
    switch (m.t) {
      case "move": {
        const x = num(m.x), y = num(m.y, -200, 1000), z = num(m.z);
        if (x === null || y === null || z === null) return;
        if (m.dim !== r.dim) return;
        const ticks = Math.max(1, tick - r.moveTick);
        const limit = (ticks + 4) * ((r.proxy.gameMode === "creative" || r.proxy.gameMode === "spectator") ? 6 : 4);
        if (Math.hypot(x - r.pos.x, z - r.pos.z) > Math.max(limit, 16) && performance.now() - r.joinedAt > 5000) {
          send(r, { t: "tp", x: r.pos.x, y: r.pos.y, z: r.pos.z });
          return;
        }
        r.pos.set(x, y, z);
        r.yaw = num(m.yaw) ?? r.yaw;
        r.pitch = num(m.pitch, -2, 2) ?? r.pitch;
        r.f = m.f | 0;
        r.sw = m.sw | 0;
        r.moveTick = tick;
        r.lastMove = performance.now();
        return;
      }
      case "equip":
        if (m.eq && Array.isArray(m.eq.armor)) r.eq = { held: m.eq.held ?? null, off: m.eq.off ?? null, armor: m.eq.armor.slice(0, 4) };
        return;
      case "center": {
        if (m.dim !== r.dim) {
          if (r.inv.view()) withPlayer(r, () => r.inv.close());
          r.dim = m.dim;
          r.dimTick = tick;
          r.pos.set(m.cx * 16 + 8, r.pos.y, m.cz * 16 + 8);
          r.reqs.clear();
          r.tracker.clear();
          send(r, { t: "ents", clear: true });
          ensureDim(r.dim);
        }
        r.center = { cx: m.cx | 0, cz: m.cz | 0, r: clampRd(m.r) + 1 };
        return;
      }
      case "req":
        if (m.dim !== r.dim) send(r, { t: "nochunk", dim: m.dim, cx: m.cx, cz: m.cz });
        else r.reqs.set(key(m.cx, m.cz), [m.cx | 0, m.cz | 0]);
        return;
      case "set": {
        const w = worldOf(r.dim);
        if (!w || m.dim !== r.dim) return;
        if (!nearEye(r, m.x, m.y, m.z) || !BLOCKS[idOf(m.s)]) return correct(r, w, m.x, m.y, m.z);
        withPlayer(r, (c) => c.world.setBlock(m.x, m.y, m.z, m.s as BlockState, m.f | 0));
        if (w.getBlock(m.x, m.y, m.z) !== m.s) correct(r, w, m.x, m.y, m.z);
        return;
      }
      case "be": {
        const w = worldOf(r.dim);
        if (!w || m.dim !== r.dim || !nearEye(r, m.x, m.y, m.z)) return;
        withPlayer(r, (c) => c.world.setBlockEntity(m.be ? { ...m.be } : null, m.x, m.y, m.z));
        queueBe(r.dim, m.x, m.y, m.z);
        return;
      }
      case "wl": {
        const w = worldOf(r.dim);
        if (!w || m.dim !== r.dim || !nearEye(r, m.x, m.y, m.z)) return;
        withPlayer(r, (c) => c.world.setWaterlogged?.(m.x, m.y, m.z, !!m.on));
        return;
      }
      case "spawn": {
        const e = entsOf(r.dim);
        if (!e || r.pos.distanceTo(new THREE.Vector3(m.x, m.y, m.z)) > 16) return;
        withPlayer(r, () => e.spawn(String(m.type), m.x, m.y, m.z, { ...(m.data ?? {}), vel: m.vel, yaw: m.yaw, pitch: m.pitch, _net: r.num }));
        return;
      }
      case "drop": {
        const e = entsOf(r.dim);
        if (!e || !m.stack || typeof m.stack.item !== "string") return;
        withPlayer(r, () => e.dropItem({ ...m.stack }, m.x, m.y, m.z, m.vel ? new THREE.Vector3(m.vel[0], m.vel[1], m.vel[2]) : undefined));
        return;
      }
      case "dropxp":
        withPlayer(r, () => entsOf(r.dim)?.dropXp(Math.min(10000, m.n | 0), m.x, m.y, m.z));
        return;
      case "hit":
        withPlayer(r, () => entsOf(r.dim)?.damage(m.id, Math.min(200, Math.max(0, +m.amount || 0)), m.source, "player"));
        return;
      case "kb":
        entsOf(r.dim)?.knockback(m.id, +m.dx || 0, +m.dz || 0, Math.min(5, +m.s || 0));
        return;
      case "interact": {
        if (m.inv) r.inv.load(m.inv);
        withPlayer(r, () => entsOf(r.dim)?.interact(m.id, r.inv.held()));
        sendView(r);
        return;
      }
      case "explode":
        if (r.pos.distanceTo(new THREE.Vector3(m.x, m.y, m.z)) < 16) withPlayer(r, () => entsOf(r.dim)?.explode(m.x, m.y, m.z, Math.min(8, +m.power || 0), !!m.fire));
        return;
      case "open":
        if (m.inv) r.inv.load(m.inv);
        withPlayer(r, () => r.inv.open(m.kind, m.at));
        if (m.at && (TICKED.has(m.kind) || m.kind === "brewing_stand")) trackIn(r.dim, m.at.x | 0, m.at.y | 0, m.at.z | 0);
        sendView(r);
        return;
      case "click":
        withPlayer(r, () => r.inv.clickSlot(m.i, m.c));
        sendView(r);
        return;
      case "opt":
        withPlayer(r, () => r.inv.chooseOption(String(m.id)));
        sendView(r);
        return;
      case "close":
        withPlayer(r, () => r.inv.close());
        send(r, { t: "view", view: null, inv: r.inv.save() });
        r.viewJson = "";
        return;
      case "inv":
        r.record.inventory = m.inv;
        r.record.player = m.player;
        if (m.adv) r.record.adv = m.adv;
        applyRecord(r);
        r.proxy.gameMode = (m.player as { gameMode?: GameMode })?.gameMode ?? r.proxy.gameMode;
        return;
      case "chat": {
        const text = String(m.text).slice(0, 256);
        if (text) say(`<${r.name}> ${text}`);
        return;
      }
      case "adv": {
        const text = String(m.text).slice(0, 200);
        if (!text.startsWith(`${r.name} has `)) return;
        g.chat(text);
        for (const o of remotes.values()) if (o !== r) send(o, { t: "chat", text });
        return;
      }
      case "died":
        say(String(m.msg).slice(0, 200));
        return;
      case "dmg": {
        const c = ctxFor(r.dim);
        const n = num(m.amount, 0, 3.5e38);
        if (c && n !== null) hostDamage(r.owner, c, n, m.source, undefined, null);
        return;
      }
      case "delta": {
        const h = r.hp;
        const dh = num(m.hp, -1e6, 1e6) ?? 0, df = num(m.food, -40, 40) ?? 0, ds = num(m.sat, -40, 40) ?? 0;
        if (h.dead) return;
        if (dh > 0) healBy(r.owner, dh);
        else if (dh < 0) h.health = Math.max(0, h.health + dh);
        h.food = Math.max(0, Math.min(20, h.food + df));
        h.saturation = Math.max(0, Math.min(h.food, h.saturation + ds));
        if (h.health <= 0) {
          h.dead = true;
          send(r, { t: "die", source: "generic" });
        }
        return;
      }
      case "exh":
        exhaust(r.owner, num(m.v, 0, 40) ?? 0);
        return;
      case "pst": {
        const h = r.hp;
        h.effects = Array.isArray(m.eff) ? m.eff.slice(0, 64).filter((e) => Array.isArray(e) && typeof e[0] === "string").map((e) => [e[0], e[1] | 0] as [string, number]) : [];
        h.absorption = num(m.abs, 0, 100) ?? 0;
        h.maxHealth = num(m.max, 1, 1024) ?? 20;
        h.health = Math.min(h.health, h.maxHealth);
        h.blocking = !!m.block;
        if (m.gm === "survival" || m.gm === "creative" || m.gm === "adventure" || m.gm === "spectator") r.proxy.gameMode = m.gm;
        return;
      }
      case "respawn":
        resetHealth(r.hp);
        r.joinedAt = performance.now();
        return;
      case "cmd": {
        const line = String(m.line).slice(0, 512);
        const shared = social(line, r.name);
        if (shared) return send(r, { t: "cmdres", lines: shared });
        const lines = withPlayer(r, (c) => {
          const was = c.rules.cheats;
          c.rules.cheats = opts.cheats;
          setPlayerName(r.name);
          try {
            return runCommand(c, line);
          } finally {
            c.rules.cheats = was;
            setPlayerName(hostName);
          }
        });
        send(r, { t: "cmdres", lines: lines ?? [] });
        return;
      }
      case "bye":
        leave(peer);
        return;
    }
  }

  t.onMessage = (from, msg) => onMessage(from, msg);
  t.onPeer = (id, joined) => {
    if (!joined) leave(id);
  };

  // /list and /me need every player, so they never reach runCommand.
  function social(line: string, who: string): string[] | null {
    const parts = line.trim().replace(/^\//, "").split(/\s+/);
    const name = (parts[0] ?? "").toLowerCase();
    if (name === "list") {
      const names = link.players().map((p) => p.name);
      return [`There are ${names.length} of a max of ${MAX_PLAYERS} players online: ${names.join(", ")}`];
    }
    if (name === "me" && parts.length > 1) {
      say(`* ${who} ${parts.slice(1).join(" ").slice(0, 200)}`);
      return [];
    }
    return null;
  }

  function queueBe(d: Dim, x: number, y: number, z: number) {
    let q = beQ.get(d);
    if (!q) beQ.set(d, (q = []));
    q.push({ x, y, z });
  }

  function onEvent(d: Dim, e: GameEvent) {
    switch (e.type) {
      case "sound":
      case "particles": {
        if (e.x === undefined) return;
        const msg: HostMsg = e.type === "sound" ? { t: "sound", name: e.name, x: e.x, y: e.y, z: e.z, volume: e.volume, pitch: e.pitch } : { t: "fx", e: e as unknown as Record<string, unknown> };
        for (const r of remotes.values()) {
          if (r === origin || r.dim !== d) continue;
          const dx = r.pos.x - e.x, dz = r.pos.z - (e.z ?? 0);
          if (dx * dx + dz * dz < SOUND_RANGE * SOUND_RANGE) send(r, msg);
        }
        return;
      }
      case "block_changed": {
        let q = blockQ.get(d);
        if (!q) blockQ.set(d, (q = []));
        q.push(e.x, e.y, e.z, e.to);
        if (d !== g.dim && TICKED.has(BLOCKS[idOf(e.to)]?.name ?? "")) trackIn(d, e.x, e.y, e.z);
        if (worldOf(d)?.getBlockEntity(e.x, e.y, e.z)) queueBe(d, e.x, e.y, e.z);
        return;
      }
      case "chat":
        if (d === g.dim && !active && / has (made the advancement|reached the goal|completed the challenge) /.test(e.text)) all({ t: "chat", text: e.text.replace(/^Player /, `${hostName} `) });
        return;
      case "player_died":
        if (d === g.dim && !active) all({ t: "chat", text: e.message.replace(/^Player\b/, hostName) });
        return;
    }
  }

  function flushBlocks() {
    for (const [d, list] of blockQ) {
      if (!list.length) continue;
      const w = worldOf(d);
      const be = (beQ.get(d) ?? []).map((p) => ({ ...p, be: w?.getBlockEntity(p.x, p.y, p.z) ?? null }));
      for (const r of remotes.values()) if (r.dim === d) send(r, { t: "blocks", dim: d, list, be: be.length ? be : undefined });
      blockQ.set(d, []);
      beQ.delete(d);
    }
    for (const [d, list] of beQ) {
      const w = worldOf(d);
      const be = list.map((p) => ({ ...p, be: w?.getBlockEntity(p.x, p.y, p.z) ?? null }));
      for (const r of remotes.values()) if (r.dim === d) send(r, { t: "blocks", dim: d, list: [], be });
    }
    beQ.clear();
  }

  function serveChunks(r: Remote) {
    const w = worldOf(r.dim);
    if (!w || !r.center || !r.reqs.size) return;
    let n = 0;
    for (const [k, [cx, cz]] of r.reqs) {
      if (Math.abs(cx - r.center.cx) > r.center.r || Math.abs(cz - r.center.cz) > r.center.r) {
        r.reqs.delete(k);
        send(r, { t: "nochunk", dim: r.dim, cx, cz });
        continue;
      }
      const data = w.readyChunk(cx, cz);
      if (!data) continue;
      r.reqs.delete(k);
      t.sendBin(r.peer, packChunk(data));
      if (++n >= CHUNKS_PER_TICK) break;
    }
  }

  function hostEquip(): Equip {
    const s = g.inventory.slots;
    const n = (i: number) => s[i]?.item ?? null;
    return { held: g.inventory.held()?.item ?? null, off: n(40), armor: [n(36), n(37), n(38), n(39)] };
  }

  function hostFlags(): number {
    const p = g.player as PlayerApi & { pose?: string; swimming?: boolean };
    return (p.pose === "crouching" ? F.sneak : 0) | (p.sprinting ? F.sprint : 0) | (p.body.onGround ? F.ground : 0) | (p.sleeping ? F.sleep : 0) | (p.dead ? F.dead : 0) | (p.flying ? F.fly : 0) | (p.pose === "swimming" ? F.swim : 0);
  }

  function snapshot(): PlayerSnap[] {
    const p = g.player;
    const anim = (p as unknown as { attackAnim: number }).attackAnim ?? 0;
    if (anim > 0 && (prevAnim === 0 || anim < prevAnim)) hostSw++;
    prevAnim = anim;
    const list: PlayerSnap[] = [{ id: 0, name: hostName, dim: g.dim, x: p.body.pos.x, y: p.body.pos.y, z: p.body.pos.z, yaw: p.yaw, pitch: p.pitch, f: hostFlags(), sw: hostSw, eq: hostEquip(), skin: skinOf(hostName) }];
    for (const r of remotes.values()) list.push({ id: r.num, name: r.name, dim: r.dim, x: r.pos.x, y: r.pos.y, z: r.pos.z, yaw: r.yaw, pitch: r.pitch, f: r.f, sw: r.sw, eq: r.eq, skin: r.skin });
    return list;
  }

  function pickups(r: Remote, ents: EntityApi) {
    if ((r.f & F.dead) || r.proxy.gameMode === "spectator") return;
    const near: Entity[] = [];
    ents.near(r.pos.x, r.pos.y + 0.9, r.pos.z, 2.2, near);
    for (const e of near) {
      if (e.dead || e.data._remove || e.data._fly !== undefined) continue;
      const dx = Math.abs(e.body.pos.x - r.pos.x), dy = e.body.pos.y - r.pos.y, dz = Math.abs(e.body.pos.z - r.pos.z);
      if (dx > 1.3 || dz > 1.3 || dy < -0.5 || dy > 2.3) continue;
      if (e.type === "item") {
        const delay = (e.data.pickupDelay as number) ?? 0;
        if (delay > 0) continue;
        const stack = e.data.stack as { item: string; count: number } | undefined;
        if (!stack) continue;
        send(r, { t: "give", stack: { ...stack } });
        e.dead = true;
        e.data._fly = 3;
        all({ t: "sound", name: "entity.item.pickup", x: r.pos.x, y: r.pos.y, z: r.pos.z, volume: 0.2, pitch: 1.4 + Math.random() * 0.6 });
        g.ctx.audio.play("entity.item.pickup", r.pos.x, r.pos.y, r.pos.z, 0.2, 1.6);
      } else if (e.type === "xp_orb") {
        send(r, { t: "xp", n: (e.data.value as number) ?? 1 });
        e.dead = true;
        e.data._fly = 2;
      }
    }
  }

  function tickSleep() {
    SLEEP_RULE.othersAsleep = () => {
      for (const r of remotes.values()) if (r.dim === "overworld" && r.proxy.gameMode !== "spectator" && !(r.f & F.sleep)) return false;
      return true;
    };
    const tm = g.ctx.time;
    if (tm.day !== lastDay) {
      lastDay = tm.day;
      if (tm.dayTime < 40) all({ t: "wake" });
    }
    const players = [...remotes.values()].filter((r) => r.dim === "overworld");
    const total = players.length + (g.dim === "overworld" ? 1 : 0);
    const asleep = players.filter((r) => r.f & F.sleep).length + (g.dim === "overworld" && g.player.sleeping ? 1 : 0);
    if (asleep > 0 && asleep < total && tick % 20 === 0) g.actionBar(`${asleep}/${total} players sleeping`);
    // The bed tick runs only in the host's own world; with the host elsewhere the overworld sleepers skip the night here.
    if (g.dim !== "overworld" && total > 0 && asleep === total) {
      if (!sleepSince) sleepSince = tick;
      else if (tick - sleepSince >= 100) {
        sleepSince = 0;
        tm.dayTime = 0;
        tm.day += 1;
        tm.rain = 0;
        tm.thunder = 0;
        lastDay = tm.day;
        all({ t: "time", tick: tm.tick, dayTime: tm.dayTime, day: tm.day, rain: 0, thunder: 0 });
        all({ t: "wake" });
      }
    } else sleepSince = 0;
  }

  const link: NetLink & { peek(d: Dim, x: number, y: number, z: number): number } = {
    role: "host",
    code,
    peek: (d, x, y, z) => worldOf(d)?.getBlock(x, y, z) ?? -1,
    ctxFor,
    adoptWorld(d) {
      const st = dims.get(d);
      if (!st) return null;
      dims.delete(d);
      const saves = st.entities.save();
      st.entities.dispose();
      return { world: st.world, saves };
    },
    releaseWorld(d, world, saves: EntitySave[]) {
      if (![...remotes.values()].some((r) => r.dim === d)) return false;
      dims.set(d, openDim(dimOpts, d, world, saves));
      return true;
    },
    event(e) {
      onEvent(g.dim, e);
    },
    tick() {
      if (disposed) return;
      tick++;
      const ctx = g.ctx as GameCtx & { playerFor?: PlayerPicker };
      ctx.playerFor = picker(g.dim);
      (ctx as GameCtx & { playersAll?: () => PlayerApi[] }).playersAll = () => everyone(g.dim);
      const mainKeep: KeepCenter[] = [];
      for (const r of remotes.values()) if (r.dim === g.dim && r.center) mainKeep.push(r.center);
      g.world.keep(mainKeep);
      for (const [d, st] of dims) {
        const inDim = [...remotes.values()].filter((r) => r.dim === d && r.center);
        if (!inDim.length) {
          if (!st.emptySince) st.emptySince = performance.now();
          else if (performance.now() - st.emptySince > 10000) {
            dims.delete(d);
            void closeDim(st, meta.id);
          }
          continue;
        }
        st.emptySince = 0;
        const focus = inDim[0];
        st.sub.player = focus.proxy;
        st.sub.inventory = focus.inv;
        st.sub.playerFor = picker(d);
        (st.sub as GameCtx & { playersAll?: () => PlayerApi[] }).playersAll = () => everyone(d);
        try {
          ticking = st.sub;
          tickDim(st, focus.center!, inDim.slice(1).map((r) => r.center!));
          st.bes?.tick(st.sub);
        } catch (e) {
          console.warn("net dim tick:", e);
        } finally {
          ticking = null;
        }
      }
      flushBlocks();
      const players = snapshot();
      avatars.set(players, 0, g.dim);
      const tm = g.ctx.time;
      for (const r of remotes.values()) {
        const hc = ctxFor(r.dim);
        if (hc) tickHealth(r.owner, hc, hc.rules, tick);
        const v = r.proxy.body.vel;
        if (v.x || v.y || v.z) {
          send(r, { t: "push", x: v.x, y: v.y, z: v.z });
          v.set(0, 0, 0);
        }
        serveChunks(r);
        const ents = entsOf(r.dim);
        if (ents) {
          r.tracker.sync(ents, r.pos.x, r.pos.y, r.pos.z, tick, (m) => send(r, m), (b) => t.sendBin(r.peer, b, false));
          pickups(r, ents);
        }
        send(r, { t: "players", list: players });
        if (tick % 20 === 0) send(r, { t: "time", tick: tm.tick, dayTime: tm.dayTime, day: tm.day, rain: tm.rain, thunder: tm.thunder });
        if (tick % 5 === 0 && r.inv.view()) {
          const v = JSON.stringify(r.inv.view());
          if (v !== r.viewJson) sendView(r, false);
        }
      }
      if (tick % 20 === 0) all({ t: "host" });
      if (tick % 40 === 0) all({ t: "list", list: link.players() });
      tickSleep();
    },
    frame(dt) {
      avatars.frame(dt);
    },
    beforeSave(m) {
      const mm = m as Meta;
      for (const r of remotes.values()) store(r);
      mm.players = meta.players;
      for (const st of dims.values()) void closeDim(st, meta.id, false);
    },
    say(text) {
      say(`<${hostName}> ${text}`);
    },
    command(line) {
      return social(line, hostName);
    },
    players() {
      const list: PlayerListEntry[] = [{ id: 0, name: hostName, ping: 0 }];
      for (const r of remotes.values()) list.push({ id: r.num, name: r.name, ping: t.direct(r.peer) ? 20 : 150 });
      return list;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      all({ t: "bye", reason: "Server closed" });
      for (const r of remotes.values()) store(r);
      remotes.clear();
      for (const st of dims.values()) void closeDim(st, meta.id);
      dims.clear();
      SLEEP_RULE.othersAsleep = () => true;
      setAdvancementSink(null);
      g.ctx.rules.cheats = ownCheats;
      delete (g.ctx as GameCtx & { playerFor?: PlayerPicker }).playerFor;
      delete (g.ctx as GameCtx & { playersAll?: unknown }).playersAll;
      avatars.dispose();
      setTimeout(() => t.leave(), 300);
    },
  };
  return link;
}
