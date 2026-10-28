import * as THREE from "three";
import type { Entity } from "../contracts";
import { activePacks, packImage, packVersion } from "../packs";
import type { Img } from "../packs/img";

// Vanilla 1.21 entity texture per mob type (under assets/minecraft/textures/). The base model layer reads it.
export const MOB_SKIN_PATHS: Record<string, string> = {
  allay: "entity/allay/allay",
  armadillo: "entity/armadillo",
  axolotl: "entity/axolotl/axolotl_lucy",
  bat: "entity/bat",
  bee: "entity/bee/bee",
  blaze: "entity/blaze",
  bogged: "entity/skeleton/bogged",
  breeze: "entity/breeze/breeze",
  camel: "entity/camel/camel",
  cat: "entity/cat/tabby",
  cave_spider: "entity/spider/cave_spider",
  chicken: "entity/chicken",
  cod: "entity/fish/cod",
  cow: "entity/cow/cow",
  creeper: "entity/creeper/creeper",
  dolphin: "entity/dolphin",
  donkey: "entity/horse/donkey",
  drowned: "entity/zombie/drowned",
  elder_guardian: "entity/guardian_elder",
  end_crystal: "entity/end_crystal/end_crystal",
  ender_dragon: "entity/enderdragon/dragon",
  enderman: "entity/enderman/enderman",
  endermite: "entity/endermite",
  evoker: "entity/illager/evoker",
  fox: "entity/fox/fox",
  frog: "entity/frog/temperate_frog",
  ghast: "entity/ghast/ghast",
  glow_squid: "entity/squid/glow_squid",
  goat: "entity/goat/goat",
  guardian: "entity/guardian",
  hoglin: "entity/hoglin/hoglin",
  horse: "entity/horse/horse_brown",
  husk: "entity/zombie/husk",
  illusioner: "entity/illager/illusioner",
  iron_golem: "entity/iron_golem/iron_golem",
  llama: "entity/llama/creamy",
  magma_cube: "entity/slime/magmacube",
  mooshroom: "entity/cow/red_mooshroom",
  mule: "entity/horse/mule",
  ocelot: "entity/cat/ocelot",
  panda: "entity/panda/panda",
  parrot: "entity/parrot/parrot_red_blue",
  phantom: "entity/phantom",
  pig: "entity/pig/pig",
  piglin: "entity/piglin/piglin",
  piglin_brute: "entity/piglin/piglin_brute",
  pillager: "entity/illager/pillager",
  polar_bear: "entity/bear/polarbear",
  pufferfish: "entity/fish/pufferfish",
  rabbit: "entity/rabbit/brown",
  ravager: "entity/illager/ravager",
  salmon: "entity/fish/salmon",
  sheep: "entity/sheep/sheep",
  shulker: "entity/shulker/shulker",
  silverfish: "entity/silverfish",
  skeleton: "entity/skeleton/skeleton",
  skeleton_horse: "entity/horse/horse_skeleton",
  slime: "entity/slime/slime",
  sniffer: "entity/sniffer/sniffer",
  snow_golem: "entity/snow_golem",
  spider: "entity/spider/spider",
  squid: "entity/squid/squid",
  stray: "entity/skeleton/stray",
  strider: "entity/strider/strider",
  tadpole: "entity/tadpole/tadpole",
  trader_llama: "entity/llama/creamy",
  tropical_fish: "entity/fish/tropical_a",
  turtle: "entity/turtle/big_sea_turtle",
  vex: "entity/illager/vex",
  villager: "entity/villager/villager",
  vindicator: "entity/illager/vindicator",
  wandering_trader: "entity/wandering_trader",
  warden: "entity/warden/warden",
  witch: "entity/witch",
  wither: "entity/wither/wither",
  wither_skeleton: "entity/skeleton/wither_skeleton",
  wolf: "entity/wolf/wolf",
  zoglin: "entity/hoglin/zoglin",
  zombie: "entity/zombie/zombie",
  zombie_horse: "entity/horse/horse_zombie",
  zombie_villager: "entity/zombie_villager/zombie_villager",
  zombified_piglin: "entity/piglin/zombified_piglin",
  player: "entity/player/wide/steve",
  player_slim: "entity/player/slim/alex",
};

const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);

// Vanilla variant textures keyed by the e.data.variant ids the passive mobs use.
const VARIANT_PATHS: Record<string, (v: unknown, e: Entity) => string> = {
  cat: (v) => `entity/cat/${str(v, "tabby")}`,
  horse: (v) => `entity/horse/horse_${str(v, "brown")}`,
  llama: (v) => `entity/llama/${str(v, "creamy")}`,
  trader_llama: (v) => `entity/llama/${str(v, "creamy")}`,
  wolf: (v, e) => {
    const base = str(v, "pale") === "pale" ? "entity/wolf/wolf" : `entity/wolf/wolf_${v}`;
    return base + (e.data.owner ? "_tame" : e.data._target !== undefined ? "_angry" : "");
  },
  rabbit: (v) => `entity/rabbit/${str(v, "brown")}`,
  frog: (v) => `entity/frog/${str(v, "temperate")}_frog`,
  parrot: (v) => `entity/parrot/parrot_${str(v, "red_blue") === "gray" ? "grey" : str(v, "red_blue")}`,
  axolotl: (v) => `entity/axolotl/axolotl_${str(v, "lucy")}`,
  fox: (v) => (v === "snow" ? "entity/fox/snow_fox" : "entity/fox/fox"),
  mooshroom: (v) => `entity/cow/${v === "brown" ? "brown" : "red"}_mooshroom`,
  panda: (v) => (str(v, "normal") === "normal" ? "entity/panda/panda" : `entity/panda/${v}_panda`),
};

export function skinPath(type: string, e?: Entity): string | undefined {
  const f = e && VARIANT_PATHS[type];
  return f ? f(e.data.variant, e) : MOB_SKIN_PATHS[type];
}

type SkinMat = THREE.MeshLambertMaterial | THREE.MeshBasicMaterial;

interface Tracked {
  claude: THREE.Texture | null;
  pack: THREE.Texture | null;
  v: number;
  path: string;
}

const TRACK = new WeakMap<SkinMat, Tracked>();
const PACK_TEX = new WeakSet<THREE.Texture>();
const TEX = new Map<string, THREE.Texture>();
let texV = -1;

// The first mesh in a model is the base skin layer (overlays such as wool are added after it).
export function baseMaterial(root: THREE.Object3D): SkinMat | null {
  let found: SkinMat | null = null;
  root.traverse((o) => {
    if (found) return;
    const m = (o as THREE.Mesh).material as SkinMat | undefined;
    if ((o as THREE.Mesh).isMesh && m && !Array.isArray(m) && m.map) found = m;
  });
  return found;
}

// Our skins and vanilla skins share the cuboid unwrap. Vanilla sizes in model pixels can differ (64x32 vs 64x64),
// so the texture is rescaled on v when the aspect ratio differs, keeping the width as the reference.
function packTexture(path: string, img: Img, w: number, h: number): THREE.Texture {
  if (texV !== packVersion()) {
    for (const t of TEX.values()) t.dispose();
    TEX.clear();
    texV = packVersion();
  }
  const key = `${path}|${w}x${h}`;
  let t = TEX.get(key);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = img.w;
  c.height = img.h;
  const g = c.getContext("2d");
  if (g) g.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
  t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  const unitH = img.h / (img.w / w);
  const r = h / unitH;
  if (Math.abs(r - 1) > 1e-6) {
    t.repeat.set(1, r);
    t.offset.set(0, 1 - r);
  }
  TEX.set(key, t);
  PACK_TEX.add(t);
  return t;
}

function imageSize(t: THREE.Texture | null): [number, number] {
  const im = t?.image as { width?: number; height?: number } | undefined;
  return [im?.width ?? 64, im?.height ?? 64];
}

// Call once per frame after the model animates (variants may swap the map back).
export function syncPackSkin(type: string, root: THREE.Object3D, mat?: SkinMat | null, e?: Entity): void {
  const path = skinPath(type, e);
  if (!path || typeof document === "undefined") return;
  const m = mat ?? baseMaterial(root);
  if (!m) return;
  let tr = TRACK.get(m);
  if (!tr) {
    tr = { claude: m.map, pack: null, v: -1, path };
    TRACK.set(m, tr);
  } else if (m.map && !PACK_TEX.has(m.map)) tr.claude = m.map;
  if (tr.v !== packVersion() || tr.path !== path) {
    tr.v = packVersion();
    tr.path = path;
    const img = activePacks().length ? packImage(path) : null;
    tr.pack = img ? packTexture(path, img, ...imageSize(tr.claude)) : null;
  }
  const want = tr.pack ?? tr.claude;
  if (want && m.map !== want) {
    m.map = want;
    if ("emissiveMap" in m && m.emissiveMap) m.emissiveMap = want;
    m.needsUpdate = true;
  }
}
