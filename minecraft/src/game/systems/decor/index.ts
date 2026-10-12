import type { BlockBehavior, BlockState, GameCtx, GameEvent, ItemStack } from "../../contracts";
import { MIN_Y, idOf } from "../../contracts";
import { BLOCKS, SOLID, blockDef, blockId } from "../../blocks/registry";
import { checkHanging } from "../../entities/decor/hanging";
import type { World } from "../../world";
import type { SystemPart } from "..";
import { createBooks, type Books } from "./book";
import { signEdit } from "./sign-edit";
import { DYE_COLORS, createSignTexts, isSign, lineWidth, readSign, signShape, type SignData, type SignTexts } from "./sign-text";

const posKey = (x: number, y: number, z: number) => ((x + 1048576) * 2097152 + (z + 1048576)) * 512 + (y - MIN_Y);
const keyX = (k: number) => Math.floor(Math.floor(k / 512) / 2097152) - 1048576;
const keyZ = (k: number) => (Math.floor(k / 512) % 2097152) - 1048576;
const SCAN_RADIUS = 34;
const HOOKED = "__decorHooked";

interface Hooks {
  placed(x: number, y: number, z: number): void;
  use(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, held: ItemStack | null): boolean;
}
let hooks: Hooks | null = null;

// BEHAVIORS is a module singleton shared by every game instance, so it is wrapped once and calls the live system through `hooks`.
function hookSigns(behaviors: Record<string, BlockBehavior>) {
  for (const b of BLOCKS) {
    if (!b || !(b.tags?.includes("signs") || b.tags?.includes("hanging_signs"))) continue;
    const beh = (behaviors[b.name] ??= {}) as BlockBehavior & { [HOOKED]?: boolean };
    if (beh[HOOKED]) continue;
    beh[HOOKED] = true;
    const place = beh.place;
    beh.place = (ctx, x, y, z, info, s) => {
      const r = place ? place(ctx, x, y, z, info, s) : s;
      if (r !== null) hooks?.placed(x, y, z);
      return r;
    };
    const use = beh.use;
    beh.use = (ctx, x, y, z, s, held) => {
      if (use?.(ctx, x, y, z, s, held)) return true;
      return hooks?.use(ctx, x, y, z, s, held) ?? false;
    };
  }
}

export function createDecor(): SystemPart {
  let books: Books | null = null;
  let signs: SignTexts | null = null;
  let off: (() => void) | null = null;
  let pending = -1;
  let tableId = -1;

  function scanChunk(ctx: GameCtx, cx: number, cz: number) {
    const c = (ctx.world as World).chunkAt?.(cx, cz);
    if (!c || !books || !signs) return;
    const b = c.blocks;
    for (let i = 0; i < b.length; i++) {
      if ((b[i] & 0xfff) !== tableId) continue;
      const x = cx * 16 + (i & 15), z = cz * 16 + ((i >> 4) & 15), y = (i >> 8) + MIN_Y;
      books.add(posKey(x, y, z), x, y, z);
    }
    for (const be of c.be.values()) if (be.type === "sign") signs.refresh(posKey(be.x, be.y, be.z), be.x, be.y, be.z);
  }

  function dropChunk(cx: number, cz: number) {
    const inChunk = (k: number) => keyX(k) >> 4 === cx && keyZ(k) >> 4 === cz;
    if (books) for (const k of [...books.keys()]) if (inChunk(k)) books.remove(k);
    if (signs) for (const k of [...signs.keys()]) if (inChunk(k)) signs.remove(k);
  }

  function write(ctx: GameCtx, x: number, y: number, z: number, patch: Partial<SignData>) {
    if (!isSign(ctx.world.getBlock(x, y, z))) return;
    const be = ctx.world.getBlockEntity(x, y, z);
    ctx.world.setBlockEntity({ x, y, z, type: "sign", data: { ...readSign(be), ...patch } }, x, y, z);
    signs?.refresh(posKey(x, y, z), x, y, z);
  }

  function openEditor(ctx: GameCtx, x: number, y: number, z: number, back: boolean) {
    const s = ctx.world.getBlock(x, y, z);
    const d = readSign(ctx.world.getBlockEntity(x, y, z));
    const sh = signShape(s);
    const t = blockDef(s).textures;
    const lines = (back ? d.back : d.front) ?? ["", "", "", ""];
    const save = (l: string[]) => write(ctx, x, y, z, back ? { back: l.slice() } : { front: l.slice() });
    signEdit.open({
      hanging: sh.hanging,
      standing: !sh.wall && !sh.hanging,
      texture: t.all ?? t.side ?? t.top ?? "oak_planks",
      lines: lines.slice(),
      maxWidth: lineWidth(sh.hanging),
      color: DYE_COLORS[(back ? d.backColor : d.color) ?? "black"] ?? 0,
      update: save,
      done: save,
    });
  }

  function useSign(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, held: ItemStack | null): boolean {
    const p = ctx.player;
    if (p.gameMode === "spectator" || p.gameMode === "adventure") return false;
    const sh = signShape(s);
    const nx = Math.sin(sh.angle), nz = Math.cos(sh.angle);
    const back = !sh.wall && (p.body.pos.x - (x + 0.5)) * nx + (p.body.pos.z - (z + 0.5)) * nz < 0;
    const d = readSign(ctx.world.getBlockEntity(x, y, z));
    const snd = (name: string) => ctx.emit({ type: "sound", name, x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    if (d.waxed) {
      snd("block.sign.waxed_interact_fail");
      return true;
    }
    const item = held?.item ?? "";
    const hasText = ((back ? d.back : d.front) ?? []).some((l) => l);
    const dye = item.endsWith("_dye") ? item.slice(0, -4) : "";
    let patch: Partial<SignData> | null = null;
    let sound = "";
    if (dye && DYE_COLORS[dye] !== undefined) {
      patch = back ? { backColor: dye } : { color: dye };
      sound = "item.dye.use";
    } else if (item === "glow_ink_sac") {
      patch = back ? { backGlowing: true } : { glowing: true };
      sound = "item.glow_ink_sac.use";
    } else if (item === "ink_sac") {
      patch = back ? { backGlowing: false } : { glowing: false };
      sound = "item.ink_sac.use";
    } else if (item === "honeycomb") {
      patch = { waxed: true };
      sound = "item.honeycomb.wax_on";
    }
    if (patch && (hasText || item === "honeycomb")) {
      write(ctx, x, y, z, patch);
      snd(sound);
      ctx.inventory.removeHeld(1);
      return true;
    }
    openEditor(ctx, x, y, z, back);
    return true;
  }

  function onBlock(ctx: GameCtx, e: Extract<GameEvent, { type: "block_changed" }>) {
    const { x, y, z, from, to } = e;
    if (SOLID[idOf(from)] !== SOLID[idOf(to)]) checkHanging(ctx, x, y, z);
    if (!books || !signs) return;
    const k = posKey(x, y, z);
    if (idOf(to) === tableId) books.add(k, x, y, z);
    else if (idOf(from) === tableId) books.remove(k);
    if (isSign(from) || isSign(to)) signs.refresh(k, x, y, z);
    if (pending === k && isSign(to)) {
      pending = -1;
      openEditor(ctx, x, y, z, false);
    }
  }

  return {
    name: "decor",
    stage(ctx) {
      tableId = blockId("enchanting_table");
      hookSigns(ctx.behaviors);
      books = createBooks(ctx);
      signs = createSignTexts(ctx);
      hooks = {
        placed: (x, y, z) => {
          pending = posKey(x, y, z);
        },
        use: useSign,
      };
      off = ctx.world.on((ev) => {
        if (ev.type === "loaded") scanChunk(ctx, ev.cx, ev.cz);
        else if (ev.type === "unloaded") dropChunk(ev.cx, ev.cz);
      });
      const p = ctx.player.body.pos;
      const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
      for (let dz = -SCAN_RADIUS; dz <= SCAN_RADIUS; dz++) for (let dx = -SCAN_RADIUS; dx <= SCAN_RADIUS; dx++) scanChunk(ctx, pcx + dx, pcz + dz);
    },
    unstage() {
      off?.();
      off = null;
      hooks = null;
      books?.dispose();
      signs?.dispose();
      books = null;
      signs = null;
      if (signEdit.get()) signEdit.close();
    },
    onEvent(ctx, e) {
      if (e.type === "block_changed") onBlock(ctx, e);
    },
    tick(ctx) {
      books?.tick(ctx);
    },
    frame(ctx) {
      books?.frame(ctx);
      signs?.frame();
    },
    dispose() {
      off?.();
      books?.dispose();
      signs?.dispose();
      hooks = null;
    },
  };
}
