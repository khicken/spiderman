import { newImg, resize, type Img } from "./img";

const ART = [
  "................",
  ".oooooooooooooo.",
  ".oooooooooooooo.",
  ".ooooooOOoooooo.",
  ".oooOooOOooOooo.",
  ".ooooOoOOoOoooo.",
  ".oooooOccOooooo.",
  ".oOOOOcccccOOOo.",
  ".oOOOOcccccOOOo.",
  ".oooooOccOooooo.",
  ".ooooOoOOoOoooo.",
  ".oooOooOOooOooo.",
  ".ooooooOOoooooo.",
  ".oooooooooooooo.",
  ".dddddddddddddd.",
  "................",
];
const PAL: Record<string, number> = { o: 0xd97757, O: 0xfaf0e2, c: 0xffffff, d: 0xa8553a };

// Claude Texture Pack icon: an orange tile with a cream starburst, 16x16 art scaled to size.
export function claudeIcon(size = 64): Img {
  const img = newImg(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const c = PAL[ART[y][x]];
      if (c === undefined) continue;
      const i = (y * 16 + x) * 4;
      img.data[i] = c >> 16;
      img.data[i + 1] = (c >> 8) & 255;
      img.data[i + 2] = c & 255;
      img.data[i + 3] = 255;
    }
  return resize(img, size, size);
}
