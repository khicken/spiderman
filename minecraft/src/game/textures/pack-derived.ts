import { packImage, packTile } from "../packs";
import { crop, newImg, resize, type Img } from "../packs/img";

// Our chests are block faces; vanilla draws them from one entity sheet (lid at uv 0,0 and base at uv 0,19, both 14 wide and deep).
const CHESTS: Record<string, string> = { chest: "normal", trapped_chest: "trapped", ender_chest: "ender" };

function stack(parts: Img[]): Img {
  const w = parts[0].w;
  const out = newImg(w, parts.reduce((n, p) => n + p.h, 0));
  let y = 0;
  for (const p of parts) {
    out.data.set(p.data, y * w * 4);
    y += p.h;
  }
  return out;
}

function chestFace(sheet: Img, face: string): Img | null {
  const k = sheet.w / 64;
  const c = (x: number, y: number, w: number, h: number) => crop(sheet, Math.round(x * k), Math.round(y * k), Math.round(w * k), Math.round(h * k));
  let img: Img;
  if (face === "top") img = c(14, 0, 14, 14);
  else if (face === "side") img = stack([c(0, 14, 14, 5), c(0, 33, 14, 10)]);
  else if (face === "front") {
    img = stack([c(14, 14, 14, 5), c(14, 33, 14, 10)]);
    const knob = c(1, 1, 2, 4);
    const ox = Math.round(6 * k), oy = Math.round(2 * k);
    for (let y = 0; y < knob.h; y++)
      for (let x = 0; x < knob.w; x++) {
        const s = (y * knob.w + x) * 4;
        if (knob.data[s + 3] < 128) continue;
        img.data.set(knob.data.subarray(s, s + 4), ((oy + y) * img.w + ox + x) * 4);
      }
  } else return null;
  const size = Math.max(16, Math.round(16 * k));
  return resize(img, size, size);
}

export function packBlockTile(key: string): Img | null {
  const direct = packTile(`block/${key}`);
  if (direct) return direct;
  const m = /^(chest|trapped_chest|ender_chest)_(top|side|front)$/.exec(key);
  if (!m) return null;
  const sheet = packImage(`entity/chest/${CHESTS[m[1]]}`);
  return sheet ? chestFace(sheet, m[2]) : null;
}
