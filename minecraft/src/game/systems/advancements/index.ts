import type { GameCtx } from "../../contracts";
import type { SystemPart } from "..";
import { blockDef } from "../../blocks/registry";
import { uiBridge } from "../ui-bridge";
import { advTrigger, onAdvTrigger, type AdvTrigger, type Dim3 } from "./bus";
import { ADVANCEMENTS, BY_ID, BY_TITLE, type AdvDef } from "./defs";
import { applyTrigger, grantAll, isDone, progressOf, revoke, type AdvState, type Progress } from "./progress";
import { createWatcher } from "./watch";
import { installVault, resetVaults, tickVaults } from "./vault";

export { ADVANCEMENTS, TABS, type AdvDef, type TabId } from "./defs";
export { advTrigger } from "./bus";

const DEFAULT_PLAYER = "Player";
const players: Record<string, Progress> = {};
let playerName = DEFAULT_PLAYER;
let prog: Progress = (players[playerName] = {});
let ctxRef: GameCtx | null = null;
let travel: { x: number; z: number } | null = null;
const shots = new Map<number, { crossbow: boolean; types: string[] }>();

installVault();

export const advancementDone = (id: string) => !!prog[id]?.done;
export const advancementPlayer = () => playerName;

// Multiplayer host: triggers caused by a remote player go to that player instead of the host's progress.
let sink: ((t: AdvTrigger) => boolean) | null = null;
export function setAdvancementSink(fn: ((t: AdvTrigger) => boolean) | null) {
  sink = fn;
}

export function setAdvancementPlayer(name: string) {
  playerName = name || DEFAULT_PLAYER;
  prog = players[playerName] ??= {};
}

function announce(ctx: GameCtx, a: AdvDef) {
  if (!a.toast) return;
  const verb = a.kind === "challenge" ? "has completed the challenge" : a.kind === "goal" ? "has reached the goal" : "has made the advancement";
  ctx.emit({ type: "chat", text: `${playerName} ${verb} ${a.kind === "challenge" ? "§5" : "§a"}[${a.title}]` });
  ctx.audio.play(a.kind === "challenge" ? "ui.toast.challenge_complete" : "ui.toast.in");
  uiBridge.toast({ title: a.title, icon: a.icon, kind: a.kind });
}

export function grant(ctx: GameCtx, id: string): boolean {
  const a = BY_ID.get(id);
  if (!a || !grantAll(prog, a, Date.now())) return false;
  announce(ctx, a);
  return true;
}

export function revokeAdvancement(id: string): boolean {
  const a = BY_ID.get(id);
  return !!a && revoke(prog, a);
}

function followUps(t: AdvTrigger, ctx: GameCtx) {
  if (t.t === "item_used_on_block" && t.to === undefined) {
    if (t.block === "jukebox" && t.item.startsWith("music_disc_")) advTrigger({ t: "jukebox", biome: ctx.world.getBiome(t.x, t.z).name });
    if (t.item === "glass_bottle" && (t.block === "beehive" || t.block === "bee_nest")) {
      for (let dy = 1; dy <= 5; dy++)
        if (blockDef(ctx.world.getBlock(t.x, t.y - dy, t.z)).name.endsWith("campfire")) {
          advTrigger({ ...t, to: "safe" });
          break;
        }
    }
  } else if (t.t === "killed_entity" && t.projectile && t.byPlayer) {
    const k = shots.get(t.projectile.id) ?? { crossbow: t.projectile.crossbow, types: [] };
    k.types.push(t.type);
    shots.delete(t.projectile.id);
    shots.set(t.projectile.id, k);
    if (shots.size > 32) shots.delete(shots.keys().next().value!);
    advTrigger({ t: "projectile_kills", crossbow: k.crossbow, types: k.types });
  }
}

function handle(t: AdvTrigger) {
  const ctx = ctxRef;
  if (!ctx || sink?.(t)) return;
  if (t.t === "custom") {
    const a = BY_TITLE.get(t.title.toLowerCase());
    if (a) grant(ctx, a.id);
    return;
  }
  for (const a of applyTrigger(prog, ADVANCEMENTS, t, Date.now())) announce(ctx, a);
  followUps(t, ctx);
}

function entered(ctx: GameCtx, from: Dim3) {
  const dim = ctx.world.dim as Dim3;
  const p = ctx.player.body.pos;
  if (dim === "overworld" && from === "nether" && travel) {
    advTrigger({ t: "nether_travel", distance: Math.hypot(p.x - travel.x, p.z - travel.z) });
    travel = null;
  }
  advTrigger({ t: "entered_dimension", dim, from });
}

function loadProgress(raw: unknown): Progress {
  const out: Progress = {};
  for (const [id, v] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    if (typeof v === "number") {
      const a = BY_ID.get(id);
      if (a) grantAll(out, a, v);
    } else if (v && typeof v === "object" && BY_ID.has(id)) {
      const st = v as AdvState;
      out[id] = { c: { ...(st.c ?? {}) }, ...(st.done ? { done: st.done } : {}) };
    }
  }
  return out;
}

export function createAdvancements(): SystemPart {
  for (const k of Object.keys(players)) delete players[k];
  prog = players[playerName] = {};
  travel = null;
  shots.clear();
  resetVaults();
  const watch = createWatcher((id) => !!prog[id]?.done);
  let lastDim: Dim3 | null = null;
  let lastPos = { x: 0, z: 0 };
  const off = onAdvTrigger(handle);
  return {
    name: "advancements",
    stage(ctx) {
      ctxRef = ctx;
      watch.stage(ctx);
      const dim = ctx.world.dim as Dim3;
      if (lastDim && lastDim !== dim) {
        if (lastDim === "overworld" && dim === "nether") travel = { ...lastPos };
        entered(ctx, lastDim);
      }
      lastDim = dim;
    },
    unstage(ctx) {
      lastPos = { x: ctx.player.body.pos.x, z: ctx.player.body.pos.z };
    },
    tick(ctx) {
      ctxRef = ctx;
      tickVaults(ctx);
      watch.tick(ctx);
    },
    onEvent(ctx, e) {
      ctxRef = ctx;
      if (e.type === "advancement") advTrigger({ t: "custom", title: e.title });
      else if (e.type === "player_died") advTrigger({ t: "custom", title: "killed_by_something" });
      else watch.onEvent(ctx, e);
    },
    save: () => ({ v: 2, players, travel }),
    load(d) {
      for (const k of Object.keys(players)) delete players[k];
      const data = (d ?? {}) as { v?: number; players?: Record<string, unknown>; travel?: { x: number; z: number } | null };
      if (data.v === 2 && data.players) for (const [name, p] of Object.entries(data.players)) players[name] = loadProgress(p);
      else players[DEFAULT_PLAYER] = loadProgress(d);
      prog = players[playerName] ??= {};
      travel = data.travel ?? null;
      watch.reset();
    },
    dispose() {
      off();
      if (ctxRef) ctxRef = null;
    },
  };
}

export interface AdvView {
  def: AdvDef;
  done: boolean;
  at?: number;
  got: number;
  total: number;
  missing: string[];
}

export function advancementList(): AdvView[] {
  return ADVANCEMENTS.map((def) => {
    const st = prog[def.id];
    const { got, total } = progressOf(def, st);
    return { def, done: isDone(def, st) && !!st?.done, at: st?.done, got, total, missing: Object.keys(def.crit).filter((k) => !st || !(k in st.c)) };
  });
}
