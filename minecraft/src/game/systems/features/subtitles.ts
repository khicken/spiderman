import type { GameCtx } from "../../contracts";

export interface SubtitleLine {
  text: string;
  at: number; // performance.now() of the last play
  x: number;
  y: number;
  z: number;
  positional: boolean;
  dir: -1 | 0 | 1; // -1 left arrow, 1 right arrow, 0 in front
}

const MOB_NAMES: Record<string, string> = { zombified_piglin: "Zombified Piglin", wither_skeleton: "Wither Skeleton", iron_golem: "Iron Golem", snow_golem: "Snow Golem", ender_dragon: "Ender Dragon", mooshroom: "Mooshroom", experience_orb: "Experience Orb" };
const AMBIENT: Record<string, string> = {
  zombie: "groans", husk: "groans", drowned: "gurgles", skeleton: "rattles", stray: "rattles", wither_skeleton: "rattles", creeper: "hisses", spider: "hisses", cave_spider: "hisses",
  enderman: "vwoops", cow: "moos", mooshroom: "moos", pig: "oinks", sheep: "baahs", chicken: "clucks", wolf: "pants", cat: "meows", horse: "neighs", donkey: "hee-haws", villager: "mumbles",
  witch: "giggles", ghast: "cries", blaze: "breathes", bee: "buzzes", parrot: "talks", fox: "squeaks", goat: "bleats", frog: "croaks", llama: "bleats", allay: "calls", bat: "screeches",
  squid: "swims", glow_squid: "swims", cod: "flops", salmon: "flops", tropical_fish: "flops", pufferfish: "flops", dolphin: "chirps", turtle: "chirps", axolotl: "chirps", tadpole: "flops",
  slime: "squishes", phantom: "screeches", piglin: "snorts", hoglin: "growls", warden: "groans", camel: "grunts", sniffer: "snorts", armadillo: "eats", breeze: "whirls", polar_bear: "groans",
};
const ACTIONS: Record<string, string> = {
  hurt: "hurts", death: "dies", step: "Footsteps", attack: "attacks", shoot: "shoots", eat: "eats", drink: "drinks", angry: "growls", growl: "growls", fuse: "hisses", primed: "fizzes",
  explode: "explodes", splash: "splashes", swim: "swims", jump: "jumps", flap: "flaps", sting: "stings", pollinate: "pollinates", loop: "buzzes", loop_aggressive: "buzzes angrily",
  scream: "screams", teleport: "teleports", stare: "cries out", throw: "throws", milk: "gets milked", shear: "gets sheared", saddle: "Saddle equips", tame: "gets tamed",
};
const FIXED: Record<string, string> = {
  "entity.item.pickup": "Item plops", "entity.experience_orb.pickup": "Experience gained", "entity.player.levelup": "Player dings", "entity.generic.eat": "Eating", "entity.generic.drink": "Sipping",
  "entity.player.burp": "Burp", "entity.generic.explode": "Explosion", "entity.lightning_bolt.thunder": "Thunder roars", "entity.lightning_bolt.impact": "Lightning strikes", "weather.rain": "Rain falls",
  "block.fire.ambient": "Fire crackles", "block.fire.extinguish": "Fire extinguished", "block.lava.pop": "Lava pops", "block.lava.ambient": "Lava pops", "block.water.ambient": "Water flows",
  "block.portal.ambient": "Portal whooshes", "block.portal.trigger": "Portal noise intensifies", "block.portal.travel": "Portal noise fades", "entity.tnt.primed": "TNT fizzes",
  "entity.arrow.shoot": "Arrow fired", "entity.arrow.hit": "Arrow hits", "entity.arrow.hit_player": "Player hit", "item.flintandsteel.use": "Flint and Steel click", "item.bucket.fill": "Bucket fills",
  "item.bucket.empty": "Bucket empties", "item.bottle.fill": "Bottle fills", "item.shield.block": "Shield blocks", "item.armor.equip_generic": "Gear equips", "entity.item.break": "Item breaks",
  "block.chest.open": "Chest opens", "block.chest.close": "Chest closes", "block.wooden_door.open": "Door creaks", "block.wooden_door.close": "Door creaks", "block.iron_door.open": "Door creaks",
  "block.iron_door.close": "Door creaks", "block.wooden_trapdoor.open": "Trapdoor creaks", "block.wooden_trapdoor.close": "Trapdoor creaks", "block.furnace.fire_crackle": "Furnace crackles",
  "block.anvil.use": "Anvil used", "block.anvil.land": "Anvil landed", "block.lever.click": "Lever clicks", "block.stone_button.click_on": "Button clicks", "block.wooden_button.click_on": "Button clicks",
  "block.piston.extend": "Piston moves", "block.piston.contract": "Piston moves", "block.beehive.enter": "Bee enters hive", "block.beehive.exit": "Bee leaves hive", "block.beehive.work": "Bees work",
  "block.beehive.shear": "Shears scrape", "block.beehive.drip": "Honey drips", "block.bell.use": "Bell rings", "block.campfire.crackle": "Campfire crackles", "block.end_portal.spawn": "End Portal opens",
  "block.end_portal_frame.fill": "Eye of Ender attaches", "entity.ender_eye.launch": "Eye of Ender shoots", "entity.ender_pearl.throw": "Ender Pearl flies", "entity.fishing_bobber.splash": "Fishing Bobber splashes",
  "entity.fishing_bobber.throw": "Bobber thrown", "entity.player.attack.crit": "Critical attack", "entity.player.attack.strong": "Strong attack", "entity.player.attack.sweep": "Sweeping attack",
  "entity.player.attack.weak": "Weak attack", "entity.player.attack.knockback": "Knockback attack", "entity.player.attack.nodamage": "Attack no damage", "entity.player.splash": "Splashing",
  "entity.player.swim": "Swimming", "entity.player.breath": "Breathing", "entity.player.small_fall": "Something trips", "entity.player.big_fall": "Something fell", "entity.generic.small_fall": "Something trips",
  "entity.generic.big_fall": "Something fell", "entity.generic.extinguish_fire": "Fire extinguishes", "entity.generic.splash": "Splashing", "entity.generic.swim": "Swimming",
  "item.brush.brushing.sand": "Brushing Sand", "item.brush.brushing.gravel": "Brushing Gravel", "item.brush.brushing.generic": "Brushing", "item.brush.brushing.sand.complete": "Brushing Sand completed",
  "item.brush.brushing.gravel.complete": "Brushing Gravel completed", "item.honey_bottle.drink": "Gulping", "item.honeycomb.wax_on": "Wax on", "item.axe.strip": "Axe strips", "item.hoe.till": "Hoe tills",
  "item.shovel.flatten": "Shovel flattens", "block.note_block.harp": "Note Block plays", "entity.minecart.riding": "Minecart rolls", "entity.boat.paddle_water": "Rowing", "block.respawn_anchor.charge": "Respawn Anchor is charged",
  "block.chiseled_bookshelf.insert": "Book placed", "block.chiseled_bookshelf.pickup": "Book taken", "item.book.page_turn": "Page rustles", "block.enchantment_table.use": "Enchanting Table used",
  "entity.villager.work_cartographer": "Cartographer works", "ui.cartography_table.take_result": "Map drawn", "ui.loom.take_result": "Loom used", "ui.stonecutter.take_result": "Stonecutter used",
};
const BLOCK_ACTIONS: Record<string, string> = { break: "Block broken", place: "Block placed", step: "Footsteps", hit: "Block breaking", fall: "Something fell" };

const words = (s: string) => s.replace(/_/g, " ");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const mobName = (id: string) => MOB_NAMES[id] ?? words(id).split(" ").map(cap).join(" ");

// Turns a vanilla sound event name into its English subtitle, like the subtitles.* keys of en_us.json.
export function caption(name: string): string | null {
  if (FIXED[name]) return FIXED[name];
  const p = name.split(".");
  if (p[0] === "music" || p[0] === "ambient" || p[0] === "ui") return null;
  if (p[0] === "block" && p.length === 3 && BLOCK_ACTIONS[p[2]]) return BLOCK_ACTIONS[p[2]];
  if (p[0] === "block" && p[1] === "note_block") return "Note Block plays";
  if (p[0] === "item" && p[1].startsWith("music_disc")) return "Music Disc plays";
  if (p[0] === "entity" && p.length >= 3) {
    const mob = p[1];
    const act = p[2];
    if (act === "ambient") return `${mobName(mob)} ${AMBIENT[mob] ?? "makes a noise"}`;
    const verb = ACTIONS[act];
    if (verb && verb[0] === verb[0].toUpperCase()) return verb;
    return `${mobName(mob)} ${verb ?? words(p.slice(2).join(" "))}`;
  }
  if (p[0] === "item" && p.length >= 3) return `${cap(words(p[1]))} ${words(p.slice(2).join(" "))}`;
  if (p[0] === "block" && p.length >= 3) return `${cap(words(p[1]))} ${words(p.slice(2).join(" "))}`;
  return null;
}

const lines: SubtitleLine[] = [];
export const SUBTITLE_MS = 3000;
export let subtitlesOn = false;

export function setSubtitles(on: boolean) {
  subtitlesOn = on;
  if (!on) lines.length = 0;
}

const ear = { x: 0, y: 0, z: 0, set: false };

export function addSubtitle(name: string, x?: number, y?: number, z?: number, volume = 1) {
  if (!subtitlesOn) return;
  const positional = x !== undefined && y !== undefined && z !== undefined;
  const range = 16 * Math.max(1, volume);
  if (positional && ear.set && (x! - ear.x) ** 2 + (y! - ear.y) ** 2 + (z! - ear.z) ** 2 > range * range) return;
  const text = caption(name);
  if (!text) return;
  const now = performance.now();
  let line = lines.find((l) => l.text === text);
  if (!line) {
    line = { text, at: now, x: 0, y: 0, z: 0, positional, dir: 0 };
    lines.push(line);
    if (lines.length > 12) lines.shift();
  }
  line.at = now;
  line.positional = positional;
  if (positional) {
    line.x = x!;
    line.y = y!;
    line.z = z!;
  }
}

// Vanilla SubtitleOverlay: an arrow points left or right when the sound is more than about 30 degrees off the view.
export function updateSubtitles(ctx: GameCtx) {
  const p = ctx.player.body.pos;
  ear.x = p.x;
  ear.y = p.y;
  ear.z = p.z;
  ear.set = true;
  if (!lines.length) return;
  const now = performance.now();
  const fx = -Math.sin(ctx.player.yaw), fz = -Math.cos(ctx.player.yaw);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (now - l.at > SUBTITLE_MS) {
      lines.splice(i, 1);
      continue;
    }
    if (!l.positional) {
      l.dir = 0;
      continue;
    }
    const dx = l.x - p.x, dz = l.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) {
      l.dir = 0;
      continue;
    }
    const front = (dx * fx + dz * fz) / d;
    const side = (dx * -fz + dz * fx) / d;
    l.dir = front > 0.866 ? 0 : side > 0 ? 1 : -1;
  }
}

export function subtitleLines(): readonly SubtitleLine[] {
  return lines;
}
