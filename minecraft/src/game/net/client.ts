import * as THREE from "three";
import type { ClickKind, ContainerView, Dim, Entity, EntityApi, GameEvent, ItemStack } from "../contracts";
import type { MirrorEntities } from "../entities";
import { mobDef } from "../entities/registry";
import { wakeUp } from "../mechanics/interact";
import type { PlayerState } from "../player/state";
import { die, remoteArmorHit, remoteBlock, remoteHurt, useTotem } from "../player/survival";
import { setPlayerName } from "../ui/commands";
import { advTrigger, setAdvancementPlayer } from "../systems/advancements";
import type { AdvTrigger } from "../systems/advancements/bus";
import type { RemoteLink } from "../world";
import type { WorldMeta } from "../world/save";
import { createAvatars } from "./avatars";
import { unpackChunk, unpackMoves, type EntMove } from "./codec";
import { entData } from "./host-sync";
import type { GameInternals, Inventory, NetLink } from "./index";
import { BIN, F, PROTOCOL, type ClientMsg, type Equip, type HostMsg, type PlayerListEntry, type WelcomeMsg } from "./protocol";
import { createTransport, type Transport } from "./transport";
import { cleanLook, localLook } from "./skins";

export type JoinStatus = "connecting" | "joining" | "loading";

export interface ClientLink extends NetLink {
  readonly welcome: WelcomeMsg;
  readonly name: string;
  onClose: ((reason: string) => void) | null;
  makeMeta(): WorldMeta;
}

const JOIN_TIMEOUT = 30000;
// Commands that change the shared world, time or position run on the host against this player's proxy.
const HOST_COMMANDS = new Set(["time", "weather", "tp", "teleport", "setblock", "fill", "difficulty", "gamerule", "summon", "setworldspawn", "kill", "list", "me", "locate"]);
const SILENT_MS = 10000;

const reviveSets = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(reviveSets);
  if (!v || typeof v !== "object") return v;
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.__set)) return new Set(o.__set);
  const out: Record<string, unknown> = {};
  for (const k in o) out[k] = reviveSets(o[k]);
  return out;
};

export function connectClient(code: string, name: string, rd: number, status?: (s: JoinStatus) => void): { done: Promise<ClientLink>; cancel(): void } {
  let cancelled = false;
  let t: Transport | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const done = new Promise<ClientLink>((resolve, reject) => {
    const started = performance.now();
    void createTransport(code).then((tr) => {
      t = tr;
      if (cancelled) {
        tr.leave();
        return;
      }
      status?.("connecting");
      const hello: ClientMsg = { t: "hello", v: PROTOCOL, name, rd };
      tr.onMessage = (from, raw) => {
        const m = raw as HostMsg;
        if (!m || typeof m !== "object") return;
        if (m.t === "host") {
          status?.("joining");
          tr.send(from, hello);
        } else if (m.t === "full") {
          clearInterval(timer!);
          tr.leave();
          reject(new Error(m.reason));
        } else if (m.t === "welcome") {
          clearInterval(timer!);
          status?.("loading");
          resolve(createClient(tr, from, m, name));
        }
      };
      timer = setInterval(() => {
        if (performance.now() - started > JOIN_TIMEOUT) {
          clearInterval(timer!);
          tr.leave();
          reject(new Error("Timed out"));
          return;
        }
        tr.broadcast(hello);
      }, 1000);
      tr.broadcast(hello);
    }, reject);
  });
  return {
    done,
    cancel() {
      cancelled = true;
      if (timer) clearInterval(timer);
      t?.leave();
    },
  };
}

function createClient(t: Transport, hostId: string, welcome: WelcomeMsg, name: string): ClientLink {
  let g: GameInternals | null = null;
  let raw: MirrorEntities | null = null;
  let local = false;
  const pending: Entity[] = [];
  const toLocal = new Map<number, Entity>();
  const toHost = new Map<number, number>();
  const moveQ: EntMove[][] = [];
  const scratch: EntMove[] = [];
  let remoteView: ContainerView | null = null;
  let inv: Inventory | null = null;
  let list: PlayerListEntry[] = [];
  let lastHeard = performance.now();
  let closed = false;
  let eqJson = "";
  let invAt = 0;
  let invVer = -1;
  let sw = 0;
  let prevAnim = 0;
  let exh = 0;
  let pstJson = "";
  let hostSeq = 0;
  let muting = false;
  const shadow = { hp: -1, food: 0, sat: 0 };
  const avatars = createAvatars(() => g!.ctx);
  setPlayerName(name);
  setAdvancementPlayer(name);

  const send = (m: ClientMsg) => t.send(hostId, m);
  const advOf = () => ((g?.systemsSave().advancements as { players?: Record<string, unknown> } | undefined)?.players ?? {})[name];

  function close(reason: string) {
    if (closed) return;
    closed = true;
    clearInterval(watch);
    t.leave();
    link.onClose?.(reason);
  }

  const watch = setInterval(() => {
    if (performance.now() - lastHeard > SILENT_MS) close("Timed out");
  }, 1000);

  t.onPeer = (id, joined) => {
    if (id === hostId && !joined) close("Connection Lost");
  };

  // Cursor and 2x2 grid items stay in the save: the host counts guarded items and would see them vanish and return.
  const invSave = () => inv!.save();

  function loadInv(data: unknown) {
    if (!inv || !data) return;
    const sel = inv.selected;
    inv.load({ ...(data as Record<string, unknown>), carried: [], craft: [] });
    inv.selected = sel;
  }

  function mirrorSpawn(s: NonNullable<Extract<HostMsg, { t: "ents" }>["spawn"]>[number]) {
    if (!raw || toLocal.has(s.id)) return;
    const e = raw.create(s.type, s.x, s.y, s.z, { ...s.data, yaw: s.yaw, persistent: true });
    if (!e) return;
    e.yaw = s.yaw;
    e.headYaw = s.yaw;
    e.health = s.hp;
    e.body.vel.set(0, 0, 0);
    e.body.noClip = true;
    toLocal.set(s.id, e);
    toHost.set(e.id, s.id);
  }

  function mirrorGone(id: number) {
    const e = toLocal.get(id);
    if (!e) return;
    e.data._remove = true;
    toLocal.delete(id);
    toHost.delete(e.id);
  }

  function clearMirrors() {
    for (const id of [...toLocal.keys()]) mirrorGone(id);
    moveQ.length = 0;
  }

  function applyMoves() {
    for (const e of toLocal.values()) {
      e.data._px = e.body.pos.x;
      e.data._py = e.body.pos.y;
      e.data._pz = e.body.pos.z;
      e.data._pyaw = e.yaw;
      e.data._phy = e.headYaw;
      e.data._ppitch = e.pitch;
    }
    while (moveQ.length > 3) moveQ.shift();
    const mv = moveQ.shift();
    if (!mv) return;
    for (const m of mv) {
      const e = toLocal.get(m.id);
      if (!e) continue;
      if (Math.abs(e.body.pos.x - m.x) > 16 || Math.abs(e.body.pos.z - m.z) > 16) {
        e.data._px = m.x;
        e.data._py = m.y;
        e.data._pz = m.z;
      }
      e.body.pos.set(m.x, m.y, m.z);
      e.yaw = m.yaw;
      e.headYaw = m.headYaw;
      e.pitch = m.pitch;
      e.body.onGround = (m.f & 4) !== 0;
      if (m.f & 1 && !e.dead) {
        e.dead = true;
        e.data._death = 0;
      }
      if (m.f & 2 && e.hurtTicks === 0) e.hurtTicks = 10;
      if (m.f & 8 && e.data._fly === undefined) e.data._fly = 3;
    }
  }

  function onMessage(from: string, rawMsg: unknown) {
    if (from !== hostId) return;
    lastHeard = performance.now();
    const m = rawMsg as HostMsg;
    if (!m || typeof m !== "object") return;
    // Sent right after the welcome, before the game attaches.
    if (m.t === "skins") {
      for (const s of Array.isArray(m.list) ? m.list : []) if (s && typeof s.id === "number" && s.id !== welcome.you) avatars.look(s.id, cleanLook(s.look));
      return;
    }
    if (!g) return;
    const ctx = g.ctx;
    switch (m.t) {
      case "time":
        ctx.time.dayTime = m.dayTime;
        ctx.time.day = m.day;
        ctx.time.rain = m.rain;
        ctx.time.thunder = m.thunder;
        return;
      case "nochunk":
        if (m.dim === g.dim) g.world.dropRequest(m.cx, m.cz);
        return;
      case "blocks": {
        if (m.dim !== g.dim) return;
        const w = g.world;
        for (let i = 0; i + 3 < m.list.length; i += 4) w.applyBlock(m.list[i], m.list[i + 1], m.list[i + 2], m.list[i + 3]);
        for (const b of m.be ?? []) w.applyBlockEntity(b.be ? { ...b.be } : null, b.x, b.y, b.z);
        return;
      }
      case "ents":
        if (m.clear) clearMirrors();
        for (const s of m.spawn ?? []) mirrorSpawn(s);
        for (const id of m.gone ?? []) mirrorGone(id);
        for (const [id, d] of m.data ?? []) {
          const e = toLocal.get(id);
          if (e) Object.assign(e.data, d);
        }
        return;
      case "players":
        avatars.set(m.list, welcome.you, g.dim);
        return;

      case "list":
        list = m.list;
        return;
      case "chat":
        g.chat(m.text, m.color);
        return;
      case "sound":
        ctx.audio.play(m.name, m.x, m.y, m.z, m.volume, m.pitch);
        return;
      case "fx":
        ctx.renderer.addParticles(m.e as Extract<GameEvent, { type: "particles" }>);
        return;
      case "view": {
        if (m.inv) {
          loadInv(m.inv);
          if (typeof m.seq === "number") hostSeq = m.seq;
        }
        const was = !!remoteView;
        remoteView = m.view;
        if (inv) inv.version++;
        if (m.view && !was) g.route({ type: "open_container", kind: m.view.kind });
        else if (!m.view && was) g.route({ type: "close_container" });
        return;
      }
      case "setinv":
        loadInv(m.inv);
        hostSeq = m.seq;
        return;
      case "gm": {
        const p = g.player;
        p.gameMode = m.mode;
        if (m.mode === "survival" || m.mode === "adventure") p.flying = false;
        if (m.mode === "spectator") p.flying = true;
        return;
      }
      case "give": {
        if (typeof m.seq === "number") hostSeq = m.seq;
        const rest = inv?.add({ ...m.stack });
        if (rest && rest.count > 0) {
          const p = g.player.body.pos;
          send({ t: "drop", stack: rest, x: p.x, y: p.y + 1.3, z: p.z });
        }
        ctx.audio.play("entity.item.pickup", g.player.body.pos.x, g.player.body.pos.y, g.player.body.pos.z, 0.2, 1.6);
        return;
      }
      case "xp":
        g.player.addXp(m.n);
        ctx.audio.play("entity.experience_orb.pickup", g.player.body.pos.x, g.player.body.pos.y, g.player.body.pos.z, 0.1, 1);
        return;
      case "stats": {
        const p = g.player;
        if (m.xpLevel !== undefined) p.xpLevel = m.xpLevel;
        if (m.xpTotal !== undefined) p.xpTotal = m.xpTotal;
        if (m.xpProgress !== undefined) p.xpProgress = m.xpProgress;
        if (m.food !== undefined) p.food = shadow.food = m.food;
        if (m.health !== undefined && !p.dead) p.health = shadow.hp = m.health;
        if (m.saturation !== undefined) p.saturation = shadow.sat = m.saturation;
        if (m.absorption !== undefined) (p as unknown as PlayerState).absorption = m.absorption;
        return;
      }
      case "hurt": {
        const p = g.player as unknown as PlayerState;
        if (p.dead) return;
        if (m.blocked) remoteBlock(p, m.amount, m.blocked === 2);
        else remoteHurt(p, m.amount, m.source, m.armor ?? 0, m.ax, m.az);
        return;
      }
      case "armor":
        remoteArmorHit(g.player as unknown as PlayerState, m.slots.filter((i) => i >= 0 && i <= 40), Math.max(0, m.n | 0));
        return;
      case "totem":
        useTotem(g.player as unknown as PlayerState, ctx);
        return;
      case "die": {
        const p = g.player as unknown as PlayerState;
        if (p.dead) return;
        die(p, ctx, m.source, m.attacker ? ({ type: m.attacker } as Entity) : undefined);
        return;
      }
      case "push":
        g.player.body.vel.x += m.x;
        g.player.body.vel.y += m.y;
        g.player.body.vel.z += m.z;
        return;
      case "effect":
        g.player.addEffect(m.id, m.amp, m.ticks);
        return;
      case "tp":
        g.player.teleport(m.x, m.y, m.z);
        return;
      case "wake":
        wakeUp(ctx);
        return;
      case "advt":
        advTrigger(reviveSets(m.trig) as AdvTrigger);
        return;
      case "cmdres":
        for (const l of m.lines.slice(0, 50)) g.chat(String(l));
        return;
      case "bye":
        close(m.reason || "Connection Lost");
        return;
    }
  }

  t.onMessage = onMessage;
  t.onBinary = (from, data) => {
    if (from !== hostId || !g) return;
    lastHeard = performance.now();
    if (data[0] === BIN.chunk) {
      void unpackChunk(data)
        .then((c) => {
          if (g && c.dim === g.dim) g.world.receiveChunk(c);
        })
        .catch((e) => console.warn("net chunk:", e));
    } else if (data[0] === BIN.ents) {
      moveQ.push(unpackMoves(data, scratch).slice());
    }
  };

  function equip(): Equip {
    const s = inv!.slots;
    const n = (i: number) => s[i]?.item ?? null;
    return { held: inv!.held()?.item ?? null, off: n(40), armor: [n(36), n(37), n(38), n(39)] };
  }

  function flags(): number {
    const p = g!.player as GameInternals["player"] & { pose?: string };
    return (p.pose === "crouching" ? F.sneak : 0) | (p.sprinting ? F.sprint : 0) | (p.body.onGround ? F.ground : 0) | (p.sleeping ? F.sleep : 0) | (p.dead ? F.dead : 0) | (p.flying ? F.fly : 0) | (p.pose === "swimming" ? F.swim : 0);
  }

  const vel = new THREE.Vector3();

  function sendInv(now: number) {
    invAt = now;
    invVer = inv!.version;
    send({ t: "inv", inv: invSave(), player: g!.player.save(), adv: advOf(), seq: hostSeq });
  }

  const pstOf = (p: PlayerState) => JSON.stringify([p.effects.map((e) => [e.id, e.amplifier]), p.absorption, p.maxHealth, !!p.blocking, p.gameMode]);
  const gained = (p: PlayerState) => shadow.hp >= 0 && (p.food > shadow.food || p.saturation > shadow.sat || p.health > shadow.hp || pstOf(p) !== pstJson);

  // Local writes to health or food (eating, cake, potions, commands) become requests; the host's next stats message is the truth.
  function syncHealth(p: PlayerState) {
    if (exh > 0) {
      send({ t: "exh", v: exh });
      exh = 0;
    }
    const pst = pstOf(p);
    if (pst !== pstJson) {
      pstJson = pst;
      const eff = p.effects.map((e) => [e.id, e.amplifier] as [string, number]);
      send({ t: "pst", eff, abs: p.absorption, max: p.maxHealth, block: !!p.blocking, gm: p.gameMode });
    }
    if (shadow.hp < 0 || p.dead) {
      if (!p.dead && shadow.hp < 0) Object.assign(shadow, { hp: p.health, food: p.food, sat: p.saturation });
      return;
    }
    const dh = p.health - shadow.hp, df = p.food - shadow.food, ds = p.saturation - shadow.sat;
    if (Math.abs(dh) > 1e-6 || Math.abs(df) > 1e-6 || Math.abs(ds) > 1e-6) {
      send({ t: "delta", hp: dh, food: df, sat: ds });
      Object.assign(shadow, { hp: p.health, food: p.food, sat: p.saturation });
    }
  }

  const link: ClientLink = {
    role: "client",
    code: "",
    welcome,
    name,
    onClose: null,
    attach(gi) {
      g = gi;
      const p = gi.player as unknown as PlayerState;
      p.remote = {
        damage: (amount, source) => send({ t: "dmg", amount, source }),
        exhaust: (v) => {
          exh += v;
        },
      };
      send({ t: "skin", look: localLook() });
      const rawRespawn = p.respawn.bind(p);
      p.respawn = () => {
        rawRespawn();
        shadow.hp = -1;
        send({ t: "respawn" });
      };
    },
    makeMeta() {
      const now = Date.now();
      const save = welcome.save;
      const player = save?.player ? { ...(save.player as Record<string, unknown>), gameMode: welcome.gameMode } : undefined;
      return {
        id: `lan-${welcome.seed}-${welcome.you}`,
        name: welcome.worldName,
        seed: welcome.seed,
        gameMode: welcome.gameMode,
        hardcore: false,
        created: now,
        lastPlayed: now,
        dim: save?.dim ?? "overworld",
        dayTime: welcome.time.dayTime,
        tick: welcome.time.tick,
        rules: { ...welcome.rules },
        player,
        inventory: save?.inventory,
        version: 1,
        cheats: welcome.cheats,
        rain: welcome.time.rain,
        thunder: welcome.time.thunder,
        spawn: { ...welcome.spawn },
        ...(save?.adv ? { systems: { advancements: { v: 2, players: { [name]: save.adv } } } } : {}),
      } as WorldMeta;
    },
    remoteWorld(d: Dim): RemoteLink {
      return {
        request: (cx, cz) => send({ t: "req", dim: d, cx, cz }),
        center: (cx, cz, r) => send({ t: "center", dim: d, cx, cz, r }),
        setBlock: (x, y, z, s, f) => send({ t: "set", dim: d, x, y, z, s, f }),
        setBlockEntity: (be, x, y, z) => send({ t: "be", dim: d, x, y, z, be: be ? JSON.parse(JSON.stringify(be)) : null }),
        setWaterlogged: (x, y, z, on) => send({ t: "wl", dim: d, x, y, z, on }),
        action(kind, x, y, z, predict) {
          if (predict) {
            muting = true;
            try {
              if (!predict()) return false;
            } finally {
              muting = false;
            }
          }
          send({ t: "act", dim: d, kind, x, y, z });
          return true;
        },
      };
    },
    wrapEntities(e: MirrorEntities): EntityApi {
      raw = e;
      toLocal.clear();
      toHost.clear();
      moveQ.length = 0;
      const host = (id: number) => toHost.get(id);
      return {
        ...e,
        spawn(type, x, y, z, data) {
          if (!local || muting) return null;
          const made = e.create(type, x, y, z, data);
          if (made) pending.push(made);
          return made;
        },
        dropItem(stack: ItemStack, x, y, z, v) {
          if (muting) return;
          send({ t: "drop", stack: { ...stack }, x, y, z, vel: v ? [v.x, v.y, v.z] : undefined });
        },
        dropXp(n, x, y, z) {
          if (muting) return;
          send({ t: "dropxp", n, x, y, z });
        },
        damage(id, amount, source) {
          const h = host(id);
          if (h !== undefined) send({ t: "hit", id: h, amount, source });
        },
        knockback(id, dx, dz, s) {
          const h = host(id);
          if (h !== undefined) send({ t: "kb", id: h, dx, dz, s });
        },
        interact(id) {
          const h = host(id);
          const ent = e.get(id);
          if (h === undefined || !ent) return false;
          send({ t: "interact", id: h, inv: invSave(), seq: hostSeq });
          return !!mobDef(ent.type)?.onInteract || inv?.held()?.item === "name_tag";
        },
        explode(x, y, z, power, fire) {
          send({ t: "explode", x, y, z, power, fire: !!fire });
        },
        tick() {
          e.tickMirror();
        },
      };
    },
    wrapInventory(i) {
      inv = i;
      const rawOpen = i.open.bind(i);
      const rawClose = i.close.bind(i);
      const rawView = i.view.bind(i);
      const rawClick = i.clickSlot.bind(i);
      const rawOpt = i.chooseOption.bind(i);
      i.open = (kind, at) => {
        if (!at || kind === "inventory" || kind === "creative") return rawOpen(kind, at);
        send({ t: "open", kind, at: { ...at }, inv: invSave(), seq: hostSeq });
      };
      i.close = () => {
        if (!remoteView) return rawClose();
        remoteView = null;
        send({ t: "close" });
        i.version++;
      };
      i.view = () => remoteView ?? rawView();
      i.clickSlot = (idx: number, c: ClickKind) => (remoteView ? send({ t: "click", i: idx, c }) : rawClick(idx, c));
      i.chooseOption = (id: string) => (remoteView ? send({ t: "opt", id }) : rawOpt(id));
    },
    event(e) {
      if (e.type === "chat" && e.text.startsWith(`${name} has `)) send({ t: "adv", text: e.text });
      if (e.type === "player_died") send({ t: "died", msg: e.message.replace(/^Player\b/, name) });
    },
    tick() {
      if (!g) return;
      applyMoves();
      raw?.tickMirror();
      local = true;
    },
    afterTick() {
      if (!g) return;
      local = false;
      for (const e of pending) {
        const d = entData(e);
        if (e.data.owner === "player") d.owner = "player";
        vel.copy(e.body.vel);
        send({ t: "spawn", type: e.type, x: e.body.pos.x, y: e.body.pos.y, z: e.body.pos.z, vel: [vel.x, vel.y, vel.z], yaw: e.yaw, pitch: e.pitch, data: d });
        e.data._remove = true;
      }
      pending.length = 0;
      const p = g.player;
      const anim = (p as unknown as { attackAnim: number }).attackAnim ?? 0;
      if (anim > 0 && (prevAnim === 0 || anim < prevAnim)) sw++;
      prevAnim = anim;
      const now = performance.now();
      // The host grants food and effects from what left the inventory, so it must see the inventory first.
      if (inv && inv.version !== invVer && gained(p as unknown as PlayerState)) sendInv(now);
      syncHealth(p as unknown as PlayerState);
      send({ t: "move", x: p.body.pos.x, y: p.body.pos.y, z: p.body.pos.z, yaw: p.yaw, pitch: p.pitch, f: flags(), sw, dim: g.dim });
      const eq = equip();
      const j = JSON.stringify(eq);
      if (j !== eqJson) {
        eqJson = j;
        send({ t: "equip", eq });
      }
      if (inv && now - invAt > 2000 && inv.version !== invVer) sendInv(now);
    },
    frame(dt) {
      avatars.frame(dt);
    },
    debug: () => ({ avatars: avatars.list() }),
    say(text) {
      send({ t: "chat", text });
    },
    command(line) {
      const name = (line.trim().replace(/^\//, "").split(/\s+/)[0] ?? "").toLowerCase().replace(/^minecraft:/, "");
      if (!HOST_COMMANDS.has(name)) return null;
      send({ t: "cmd", line: line.slice(0, 512) });
      return [];
    },
    players: () => list,
    dispose() {
      if (!closed) {
        if (g && inv) send({ t: "inv", inv: invSave(), player: g.player.save(), adv: advOf(), seq: hostSeq });
        send({ t: "bye" });
      }
      closed = true;
      clearInterval(watch);
      avatars.dispose();
      setTimeout(() => t.leave(), 300);
    },
  };
  return link;
}
