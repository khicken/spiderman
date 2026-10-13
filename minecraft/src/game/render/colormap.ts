import { BIOMES } from "../worldgen/biomes";
import { activePacks, packImage, type Img } from "../packs";
import { resize } from "../packs/img";

const ORIGINAL = BIOMES.map((b) => [b.grassColor, b.foliageColor] as const);
const FIXED = /badlands|swamp|cherry/;

function sample(map: Img, temp: number, downfall: number): number {
  const t = Math.max(0, Math.min(1, temp));
  const d = Math.max(0, Math.min(1, downfall)) * t;
  const x = Math.min(255, Math.floor((1 - t) * 255)), y = Math.min(255, Math.floor((1 - d) * 255));
  const i = (y * 256 + x) * 4;
  return (map.data[i] << 16) | (map.data[i + 1] << 8) | map.data[i + 2];
}

// Vanilla biome tint: colormap/grass.png and foliage.png indexed by temperature and downfall. Returns true if colors changed.
export function applyColormaps(): boolean {
  const on = activePacks().length > 0;
  const g = on ? packImage("colormap/grass") : null, f = on ? packImage("colormap/foliage") : null;
  const grass = g ? resize(g, 256, 256) : null, foliage = f ? resize(f, 256, 256) : null;
  let changed = false;
  BIOMES.forEach((b, i) => {
    let gc = ORIGINAL[i][0], fc = ORIGINAL[i][1];
    if (b.dim === "overworld" && !FIXED.test(b.name)) {
      if (grass) {
        gc = sample(grass, b.temperature, b.downfall);
        if (b.name === "dark_forest") gc = (((gc & 0xfefefe) + 0x28340a) >> 1) & 0xffffff;
      }
      if (foliage) fc = sample(foliage, b.temperature, b.downfall);
    }
    if (gc !== b.grassColor || fc !== b.foliageColor) changed = true;
    b.grassColor = gc;
    b.foliageColor = fc;
  });
  return changed;
}
