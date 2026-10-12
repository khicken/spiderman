import type { BlockBehavior, GameCtx, GameEvent } from "../../contracts";
import { blockDef } from "../../blocks/registry";
import { containerChanged } from "../../mechanics/redstone/inventory";
import { useHeld } from "../../mechanics/util";
import { DISCS, discLabel } from "./discs";

interface Playing {
  x: number;
  y: number;
  z: number;
  end: number;
}

const playing = new Map<string, Playing>();
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

function start(ctx: GameCtx, x: number, y: number, z: number, disc: string) {
  const d = DISCS[disc];
  if (!d) return;
  const k = key(x, y, z);
  playing.set(k, { x, y, z, end: ctx.time.tick + d.seconds * 20 });
  ctx.audio.playRecord?.(k, disc.slice("music_disc_".length), x + 0.5, y + 0.5, z + 0.5, d.seconds);
  ctx.emit({ type: "action_bar", text: `§dNow Playing: ${discLabel(disc)}` });
}

function stop(ctx: GameCtx, x: number, y: number, z: number) {
  const k = key(x, y, z);
  if (!playing.delete(k)) return;
  ctx.audio.stopRecord?.(k);
}

export const JUKEBOX_BEHAVIOR: BlockBehavior = {
  use(ctx, x, y, z, _s, held) {
    const be = ctx.world.getBlockEntity(x, y, z);
    const cur = be?.items?.[0];
    if (cur) {
      stop(ctx, x, y, z);
      be!.items = [null];
      ctx.world.setBlockEntity(be!, x, y, z);
      ctx.entities.dropItem(cur, x + 0.5, y + 1.01, z + 0.5);
      containerChanged(ctx, x, y, z);
      return true;
    }
    if (!held || !DISCS[held.item]) return false;
    const disc = { ...held, count: 1 };
    ctx.world.setBlockEntity({ x, y, z, type: "jukebox", items: [disc], data: {} }, x, y, z);
    useHeld(ctx);
    start(ctx, x, y, z, disc.item);
    containerChanged(ctx, x, y, z);
    return true;
  },
};

function noteColor(note: number): number {
  const f = note / 24;
  const c = (o: number) => Math.round(Math.max(0, Math.sin((f + o) * Math.PI * 2) * 0.65 + 0.35) * 255);
  return (c(0) << 16) | (c(1 / 3) << 8) | c(2 / 3);
}

export function jukeboxTick(ctx: GameCtx) {
  if (!playing.size) return;
  const t = ctx.time.tick;
  for (const [k, p] of playing) {
    if (t >= p.end) {
      playing.delete(k);
      ctx.audio.stopRecord?.(k);
      continue;
    }
    if (t % 20 === 0) ctx.emit({ type: "particles", kind: "note", x: p.x + 0.5, y: p.y + 1.2, z: p.z + 0.5, count: 1, color: noteColor(Math.floor(ctx.random() * 25)) });
  }
}

export function jukeboxEvent(ctx: GameCtx, e: GameEvent) {
  if (e.type !== "block_changed" || !playing.size) return;
  if (blockDef(e.to).name === "jukebox") return;
  stop(ctx, e.x, e.y, e.z);
}

export function stopAllRecords(ctx: GameCtx) {
  for (const k of playing.keys()) ctx.audio.stopRecord?.(k);
  playing.clear();
}

export const isPlayingAt = (x: number, y: number, z: number) => playing.has(key(x, y, z));
