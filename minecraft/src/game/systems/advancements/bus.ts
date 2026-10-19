// Advancement triggers. Modules call advTrigger() at the vanilla trigger point; this file imports nothing so any module can use it.

export type Dim3 = "overworld" | "nether" | "end";

export type AdvTrigger =
  | { t: "inventory_changed"; items: ReadonlySet<string>; armor: readonly (string | null)[] }
  | { t: "location"; dim: Dim3; biome: string; structures: readonly string[]; y: number; vehicle?: string; inLava?: boolean }
  | { t: "entered_dimension"; dim: Dim3; from: Dim3 }
  | { t: "nether_travel"; distance: number }
  | { t: "crafted"; item: string; station: string; ingredients: readonly string[] }
  | { t: "smithing"; item: string; template: string }
  | { t: "placed_block"; block: string; x: number; y: number; z: number }
  | { t: "item_used_on_block"; item: string; block: string; to?: string; x: number; y: number; z: number }
  | { t: "killed_entity"; type: string; hostile: boolean; source: string; byPlayer: boolean; killer?: string; dim?: Dim3; distance: number; projectile?: { id: number; type: string; crossbow: boolean; deflected?: boolean }; captain?: boolean; nearCatalyst?: boolean }
  | { t: "consumed_item"; item: string }
  | { t: "bred_animals"; type: string }
  | { t: "tamed"; type: string; variant?: string }
  | { t: "interact_entity"; type: string; item: string; variant?: string; baby?: boolean }
  | { t: "shot"; item: "bow" | "crossbow" | "trident" }
  | { t: "spyglass"; target: string }
  | { t: "effects_changed"; effects: readonly string[]; source?: string }
  | { t: "brewed"; item: string }
  | { t: "enchanted"; item: string; levels: number }
  | { t: "villager_trade"; y: number; type: string }
  | { t: "slept" }
  | { t: "levitation"; distance: number }
  | { t: "fall_from_height"; startY: number; endY: number }
  | { t: "lightning"; victims: readonly string[]; fire: boolean; rod: boolean }
  | { t: "target_hit"; signal: number; distance: number }
  | { t: "summoned"; type: string }
  | { t: "cured_zombie_villager" }
  | { t: "used_totem" }
  | { t: "blocked_by_shield" }
  | { t: "fished"; item: string }
  | { t: "filled_bucket"; item: string }
  | { t: "entered_block"; block: string }
  | { t: "construct_beacon"; level: number }
  | { t: "crafter_crafted"; item: string }
  | { t: "vault"; ominous: boolean }
  | { t: "avoid_vibration" }
  | { t: "allay_drop"; item: string; noteBlock: boolean }
  | { t: "brushed"; target: string; item: string }
  | { t: "respawn_dragon" }
  | { t: "piglin_distracted" }
  | { t: "mace_hit"; damage: number }
  | { t: "wind_launch"; height: number }
  | { t: "honey_slide" }
  | { t: "powder_snow_walk" }
  | { t: "jukebox"; biome: string }
  | { t: "ride_with"; vehicle: string; passenger: string }
  | { t: "silk_touch_nest"; bees: number }
  | { t: "comparator_read"; block: string }
  | { t: "container_loot"; structure: string }
  | { t: "ride_distance"; vehicle: string; dim: Dim3; distance: number; lava: boolean }
  | { t: "projectile_hit"; projectile: string; target: string }
  | { t: "projectile_kills"; crossbow: boolean; types: readonly string[] }
  | { t: "custom"; title: string };

type Listener = (t: AdvTrigger) => void;
const listeners = new Set<Listener>();

export function advTrigger(t: AdvTrigger): void {
  for (const l of listeners) {
    try {
      l(t);
    } catch (err) {
      console.error("advancement trigger", t.t, err);
    }
  }
}

export function onAdvTrigger(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
