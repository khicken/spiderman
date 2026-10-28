// Writes the Claude pack in vanilla resource pack layout. Browser only (entity skins come from canvases).
import { BLOCK_TEXTURE_KEYS, claudeBlockTexture } from "../textures/index";
import { ANIMATED, paintFrame } from "../textures/animated";
import { ITEM_TEXTURE_KEYS, paintItemTexture } from "../textures/icons";
import { glintPixels } from "../textures/items-iso";
import {
  BUTTON_PATHS, CONTAINER_ART, armorUrl, arrowUrl, barPath, barUrl, bubbleUrl, buttonUrl, claudeSprite, emptySlotUrl, flameUrl, foodPath, foodUrl,
  heartPath, heartUrl, hotbarUrl, offhandUrl, panelUrl, selectionUrl, sliderTrackUrl, slotUrl, type EmptySlotKind, type HeartKind,
} from "../ui/sprites";
import { glyphOf, GLYPH_ROWS } from "../ui/font";
import { BOSS, lighten } from "../ui/hud";
import { LAYOUTS, type Layout, type Pt } from "../ui/container-layouts";
import { allMobs } from "../entities/registry";
import { MOB_SKIN_PATHS, baseMaterial } from "../entities/pack-skins";
import { paintSteveSkin } from "../player/model";
import { paintCloudMap, paintEndSky, paintMoonPhases, paintSun } from "../render/sky-art";
import { paintWeather } from "../render/weather";
import { PARTICLE_PATHS, paintParticleSheet } from "../render/particle-art";
import { allSoundNames, renderVariant, resolveSound } from "../audio/synth/registry";
import { claudeIcon } from "./claude-icon";
import { crop, newImg, type Img } from "./img";
import { encodePng } from "./png";
import { writeZip } from "./zip";
import { canEncodeOpus, encodeOgg } from "./ogg";
import { PACK_FORMAT, withClaudeOnly } from "./index";

const NS = "assets/minecraft/";
const T = `${NS}textures/`;
const px = (data: Uint8ClampedArray | Uint8Array, w: number, h: number): Img => ({ w, h, data: new Uint8ClampedArray(data) });

function over(dst: Img, src: Img, ox: number, oy: number) {
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const dx = ox + x, dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= dst.w || dy >= dst.h) continue;
      const s = (y * src.w + x) * 4, d = (dy * dst.w + dx) * 4, a = src.data[s + 3] / 255;
      if (!a) continue;
      for (let k = 0; k < 3; k++) dst.data[d + k] = src.data[s + k] * a + dst.data[d + k] * (1 - a);
      dst.data[d + 3] = Math.max(dst.data[d + 3], src.data[s + 3]);
    }
}

function slotPoints(L: Layout): { p: Pt; big: boolean }[] {
  const out: { p: Pt; big: boolean }[] = [];
  for (const p of L.rest) out.push({ p, big: false });
  for (const p of L.out ?? []) out.push({ p, big: !!L.bigOut });
  if (L.fuel) out.push({ p: L.fuel, big: false });
  if (L.inv) {
    for (let i = 0; i < 27; i++) out.push({ p: [L.inv[0] + (i % 9) * 18, L.inv[1] + Math.floor(i / 9) * 18], big: false });
    for (let i = 0; i < 9; i++) out.push({ p: [L.inv[0] + i * 18, L.inv[1] + 58], big: false });
  }
  for (const p of Object.values(L.armor ?? {})) if (p) out.push({ p, big: false });
  if (L.offhand) out.push({ p: L.offhand, big: false });
  return out;
}

function containerSheet(kind: keyof typeof LAYOUTS): Img {
  const L = LAYOUTS[kind];
  const panel = newImg(L.w, L.h);
  const sp = claudeSprite(() => panelUrl(L.w, L.h));
  if (sp) over(panel, sp, 0, 0);
  const slot = claudeSprite(() => slotUrl(18)), big = claudeSprite(() => slotUrl(26));
  for (const { p, big: b } of slotPoints(L)) {
    const s = b ? big : slot;
    if (s) over(panel, s, p[0] - (b ? 5 : 1), p[1] - (b ? 5 : 1));
  }
  const draw = (fn: () => string, x: number, y: number) => {
    const s = claudeSprite(fn);
    if (s) over(panel, s, x, y);
  };
  if (kind === "inventory") {
    for (let y = 8; y < 78; y++)
      for (let x = 26; x < 75; x++) {
        const i = (y * L.w + x) * 4;
        const c = x === 26 || y === 8 ? 0x37 : x === 74 || y === 77 ? 0xff : 0;
        panel.data[i] = panel.data[i + 1] = panel.data[i + 2] = c;
        panel.data[i + 3] = 255;
      }
    draw(() => arrowUrl(0, 16, 13), 135, 29);
  }
  if (kind === "crafting_table") draw(() => arrowUrl(0), 90, 35);
  if (kind === "furnace" || kind === "blast_furnace" || kind === "smoker") {
    draw(() => flameUrl(0), 56, 36);
    draw(() => arrowUrl(0, 24, 16), 79, 34);
  }
  for (const a of CONTAINER_ART[kind] ?? []) {
    if (a.url) draw(a.url, a.x, a.y);
    else {
      const r = newImg(a.w, a.h), c = a.c ?? 0;
      for (let i = 0; i < r.data.length; i += 4) r.data.set([(c >> 16) & 255, (c >> 8) & 255, c & 255, c >>> 24], i);
      over(panel, r, a.x, a.y);
    }
  }
  const sheet = newImg(kind === "villager" ? 512 : 256, 256);
  if (kind === "large_chest") {
    over(sheet, crop(panel, 0, 0, L.w, L.h - 97), 0, 0);
    over(sheet, crop(panel, 0, L.h - 97, L.w, 96), 0, 126);
  } else over(sheet, panel, 0, 0);
  return sheet;
}

function fontSheet(): Img {
  const img = newImg(128, 128);
  for (let code = 32; code < 127; code++) {
    const g = glyphOf(String.fromCharCode(code));
    const ox = (code % 16) * 8, oy = Math.floor(code / 16) * 8;
    for (let y = 0; y < GLYPH_ROWS; y++)
      for (let x = 0; x < Math.min(8, g.width); x++) {
        if (!g.rows[y * g.width + x]) continue;
        const i = ((oy + y) * 128 + ox + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = img.data[i + 3] = 255;
      }
  }
  return img;
}

function canvasImg(c: HTMLCanvasElement | OffscreenCanvas | ImageBitmap | HTMLImageElement): Img | null {
  const w = c.width, h = c.height;
  if (!w || !h) return null;
  const tmp = new OffscreenCanvas(w, h);
  const g = tmp.getContext("2d");
  if (!g) return null;
  g.drawImage(c as CanvasImageSource, 0, 0);
  return px(g.getImageData(0, 0, w, h).data, w, h);
}

function mobSkins(): Map<string, Img> {
  const out = new Map<string, Img>();
  for (const def of allMobs()) {
    const path = MOB_SKIN_PATHS[def.type];
    if (!path || out.has(path)) continue;
    try {
      const m = def.createModel();
      const mat = baseMaterial(m.root);
      const img = mat?.map?.image ? canvasImg(mat.map.image as HTMLCanvasElement) : null;
      if (img) out.set(path, img);
      m.dispose();
    } catch (e) {
      console.warn(`skin export ${def.type} failed`, e);
    }
  }
  const steve = canvasImg(paintSteveSkin());
  if (steve) out.set(MOB_SKIN_PATHS.player, steve);
  return out;
}

const SR = 22050;

// Batches bound memory and yield to the game loop between them.
async function inBatches<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

// Fallback when WebCodecs has no Opus encoder.
function wav(samples: Float32Array, sr: number): Uint8Array {
  const n = samples.length;
  const out = new Uint8Array(44 + n * 2);
  const dv = new DataView(out.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  str(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, "data"); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return out;
}

const HEARTS: HeartKind[] = ["normal", "poisoned", "withered", "absorbing", "frozen"];
// Collects every Claude texture synchronously (packs ignored), then encodes. Sounds are optional (synthesis takes a few seconds).
export async function exportClaudePack(opts: { sounds?: boolean } = {}): Promise<Uint8Array> {
  const images: [string, Img][] = [];
  const text: [string, string][] = [];
  withClaudeOnly(() => {
    for (const k of BLOCK_TEXTURE_KEYS) if (k !== "missing") images.push([`${T}block/${k}.png`, px(claudeBlockTexture(k), 16, 16)]);
    for (const a of ANIMATED) {
      const base = claudeBlockTexture(a.key);
      const strip = newImg(16, 16 * a.frames);
      strip.data.set(base, 0);
      for (let f = 1; f < a.frames; f++) strip.data.set(paintFrame(a, base, f), f * 1024);
      const i = images.findIndex(([p]) => p === `${T}block/${a.key}.png`);
      if (i >= 0) images[i][1] = strip;
      else images.push([`${T}block/${a.key}.png`, strip]);
      text.push([`${T}block/${a.key}.png.mcmeta`, JSON.stringify({ animation: { frametime: a.ticks } })]);
    }
    for (const k of ITEM_TEXTURE_KEYS) images.push([`${T}item/${k}.png`, px(paintItemTexture(k), 16, 16)]);
    const gui = (path: string, fn: () => string) => {
      const img = claudeSprite(fn);
      if (img) images.push([`${T}${path}.png`, img]);
    };
    for (const kind of HEARTS)
      for (const hc of [false, true]) for (const fill of ["full", "half"] as const) gui(heartPath(kind, fill, hc), () => heartUrl(kind, fill, hc));
    for (const hc of [false, true]) for (const blink of [false, true]) gui(heartPath("normal", "empty", hc, blink), () => heartUrl("normal", "empty", hc, blink));
    for (const fill of ["full", "half", "empty"] as const) {
      for (const hunger of [false, true]) gui(foodPath(fill, hunger), () => foodUrl(fill, hunger));
      gui(`gui/sprites/hud/armor_${fill}`, () => armorUrl(fill));
    }
    gui("gui/sprites/hud/air", () => bubbleUrl(false));
    gui("gui/sprites/hud/air_bursting", () => bubbleUrl(true));
    for (const look of ["normal", "hover", "disabled"] as const) gui(BUTTON_PATHS[look], () => buttonUrl(200, 20, look));
    gui("gui/sprites/widget/slider", () => sliderTrackUrl(200, 20));
    gui("gui/sprites/widget/slider_handle", () => buttonUrl(8, 20, "normal"));
    gui("gui/sprites/widget/slider_handle_highlighted", () => buttonUrl(8, 20, "hover"));
    gui("gui/sprites/hud/hotbar", hotbarUrl);
    gui("gui/sprites/hud/hotbar_selection", selectionUrl);
    gui("gui/sprites/hud/hotbar_offhand_left", offhandUrl);
    gui("gui/sprites/container/slot", () => slotUrl(18));
    const bars: [string, number, number, number, number][] = [
      ["xp_bg", 0x2a2a2a, 0x202020, 0x181818, 20], ["xp_fill", 0xa0ff60, 0x80ff20, 0x4c9a12, 20],
      ["jump_bg", 0x3a3a52, 0x2c2c40, 0x1c1c2a, 0], ["jump_fill", 0x9ab4ff, 0x6a8cf0, 0x3a50a0, 0],
    ];
    for (const [key, a, b, c, notch] of bars) gui(barPath(key) as string, () => barUrl(key, 182, a, b, c, notch));
    for (const [color, [fg, bg]] of Object.entries(BOSS)) {
      gui(barPath(`boss_bg_${color}`) as string, () => barUrl(`boss_bg_${color}`, 182, lighten(bg), bg, bg));
      gui(barPath(`boss_fg_${color}`) as string, () => barUrl(`boss_fg_${color}`, 182, lighten(fg), fg, fg));
    }
    for (const kind of ["helmet", "chestplate", "leggings", "boots", "shield"] as EmptySlotKind[]) gui(`gui/sprites/container/slot/${kind}`, () => emptySlotUrl(kind));
    gui("gui/sprites/container/furnace/burn_progress", () => arrowUrl(1, 24, 16));
    gui("gui/sprites/container/furnace/lit_progress", () => flameUrl(1));
    const sheets: [string, keyof typeof LAYOUTS][] = [
      ["inventory", "inventory"], ["crafting_table", "crafting_table"], ["furnace", "furnace"], ["blast_furnace", "blast_furnace"],
      ["smoker", "smoker"], ["shulker_box", "shulker_box"], ["dispenser", "dispenser"], ["hopper", "hopper"], ["generic_54", "large_chest"],
      ["crafter", "crafter"], ["anvil", "anvil"], ["enchanting_table", "enchanting_table"], ["brewing_stand", "brewing_stand"],
      ["grindstone", "grindstone"], ["stonecutter", "stonecutter"], ["smithing", "smithing_table"], ["loom", "loom"],
      ["cartography_table", "cartography_table"], ["villager", "villager"], ["beacon", "beacon"],
    ];
    for (const [name, kind] of sheets) images.push([`${T}gui/container/${name}.png`, containerSheet(kind)]);
    images.push([`${T}font/ascii.png`, fontSheet()]);
    for (const [path, img] of mobSkins()) images.push([`${T}${path}.png`, img]);
    const sun = paintSun(), moon = paintMoonPhases(), end = paintEndSky();
    images.push([`${T}environment/sun.png`, px(sun.data, sun.size, sun.size)]);
    images.push([`${T}environment/moon_phases.png`, px(moon.data, moon.width, moon.height)]);
    images.push([`${T}environment/end_sky.png`, px(end.data, end.size, end.size)]);
    const cloudMap = paintCloudMap(), clouds = newImg(256, 256);
    for (let i = 0; i < 256 * 256; i++) if (cloudMap[i]) clouds.data.fill(255, i * 4, i * 4 + 4);
    images.push([`${T}environment/clouds.png`, clouds]);
    images.push([`${T}environment/rain.png`, px(paintWeather("rain"), 64, 256)]);
    images.push([`${T}environment/snow.png`, px(paintWeather("snow"), 64, 256)]);
    const sheet = paintParticleSheet();
    for (const [layer, path] of PARTICLE_PATHS) images.push([`${T}${path}.png`, px(sheet.subarray(layer * 1024, layer * 1024 + 1024), 16, 16)]);
    images.push([`${T}misc/enchanted_glint_item.png`, px(glintPixels(64), 64, 64)]);
  });
  const files: [string, Uint8Array][] = [];
  const enc = new TextEncoder();
  files.push(["pack.mcmeta", enc.encode(JSON.stringify({ pack: { pack_format: PACK_FORMAT, description: "Claude Texture Pack: procedural art and sounds" } }, null, 2))]);
  files.push(["pack.png", await encodePng(claudeIcon(64))]);
  for (const [p, t] of text) files.push([p, enc.encode(t)]);
  files.push(...(await inBatches(images, 64, async ([p, img]) => [p, await encodePng(img)] as [string, Uint8Array])));
  if (opts.sounds !== false) {
    const doc: Record<string, { sounds: string[] }> = {};
    const names = allSoundNames().filter((n) => !n.startsWith("music_disc.") && !n.startsWith("music.") && resolveSound(n));
    const opus = await canEncodeOpus(SR);
    files.push(...(await inBatches(names, 16, async (name) => {
      const file = `claude/${name.replace(/\./g, "/")}`;
      doc[name] = { sounds: [file] };
      const r = resolveSound(name)!;
      const pcm = renderVariant(r.key, r.recipe, 0, SR).subarray(0, SR * 4);
      return [`${NS}sounds/${file}.ogg`, opus ? await encodeOgg(pcm, SR) : wav(pcm, SR)] as [string, Uint8Array];
    })));
    files.push([`${NS}sounds.json`, enc.encode(JSON.stringify(doc))]);
  }
  return writeZip(files);
}

export function downloadBytes(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
