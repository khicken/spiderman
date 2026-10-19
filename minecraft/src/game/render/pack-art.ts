import { activePacks, packImage, packTile } from "../packs";
import { resize, type Img } from "../packs/img";

export interface Art {
  data: Uint8Array;
  w: number;
  h: number;
}

const toArt = (img: Img): Art => ({ data: new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.length), w: img.w, h: img.h });

// Pack image at its own size, or the Claude art.
export function artOr(path: string, claude: () => Art): Art {
  const img = activePacks().length ? packImage(path) : null;
  return img ? toArt(img) : claude();
}

// Pack image scaled to a fixed size (for layers of a texture array).
export function tileOr(path: string, w: number, h: number): Art | null {
  const img = activePacks().length ? packTile(path) : null;
  return img ? toArt(resize(img, w, h)) : null;
}
