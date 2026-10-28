// Dev check: how much of the Claude art the selected packs replace, by area.
import { BLOCK_TEXTURE_KEYS } from "../textures/index";
import { ITEM_TEXTURE_KEYS } from "../textures/icons";
import { MOB_SKIN_PATHS } from "../entities/pack-skins";
import { PARTICLE_PATHS } from "../render/particle-art";
import { activePacks, hasPackImage, hasPackSound, packFontDocs, packImagePaths, packSoundAsync } from "./index";
import { packGlyphs } from "./font";

export async function packCoverage(soundProbe = "block.stone.break") {
  const count = (paths: string[]) => ({ hit: paths.filter(hasPackImage).length, total: paths.length, miss: paths.filter((p) => !hasPackImage(p)).slice(0, 8) });
  const all = [...packImagePaths()];
  const buf = await packSoundAsync(soundProbe);
  return {
    active: activePacks(),
    block: count(BLOCK_TEXTURE_KEYS.filter((k) => k !== "missing").map((k) => `block/${k}`)),
    item: count(ITEM_TEXTURE_KEYS.map((k) => `item/${k}`)),
    entity: count([...new Set(Object.values(MOB_SKIN_PATHS))]),
    particle: count(PARTICLE_PATHS.map((p) => p[1])),
    gui: all.filter((p) => p.startsWith("gui/")).length,
    environment: all.filter((p) => p.startsWith("environment/")),
    font: { sheets: all.filter((p) => p.startsWith("font/")), json: packFontDocs("font/default.json").length, glyphs: packGlyphs()?.size ?? 0 },
    sound: { probe: soundProbe, defined: hasPackSound(soundProbe), buffers: buf?.length ?? 0, seconds: buf?.[0]?.buffer.duration ?? 0 },
  };
}
