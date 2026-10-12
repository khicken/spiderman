import { PAD, type BlockState, type MeshBuffers } from "../contracts";
import { biomeId } from "../worldgen/biomes";
import { meshInto, padIndex } from "./mesher";
import { BUFS, quadIndex } from "./writer";

const blocks = new Uint16Array(PAD * PAD * PAD);
const light = new Uint8Array(PAD * PAD * PAD).fill(0xf0);
const biomes = new Uint8Array(PAD * PAD);

export function blockGeometry(state: BlockState): MeshBuffers {
  biomes.fill(biomeId("plains"));
  const at = padIndex(0, 0, 0);
  blocks[at] = state;
  meshInto({ cx: 0, sy: 4, cz: 0, blocks, light, biomes });
  blocks[at] = 0;
  let n = 0;
  for (const b of BUFS) n += b.n;
  const pos = new Float32Array(n * 3);
  const uv = new Uint8Array(n * 4);
  const lt = new Uint8Array(n * 2);
  const col = new Uint8Array(n * 4);
  const lay = new Uint16Array(n * 2);
  let o = 0;
  for (const b of BUFS) {
    for (let i = 0; i < b.n * 3; i++) pos[o * 3 + i] = b.pos[i] - 0.5;
    uv.set(b.uv.subarray(0, b.n * 4), o * 4);
    lt.set(b.light.subarray(0, b.n * 2), o * 2);
    col.set(b.col.subarray(0, b.n * 4), o * 4);
    lay.set(b.lay.subarray(0, b.n * 2), o * 2);
    o += b.n;
    b.n = 0;
  }
  return {
    attributes: {
      position: { array: pos, itemSize: 3 },
      aUv: { array: uv, itemSize: 4 },
      aLight: { array: lt, itemSize: 2, normalized: true },
      aColor: { array: col, itemSize: 4, normalized: true },
      aLayer: { array: lay, itemSize: 2 },
    },
    index: quadIndex(n / 4),
  };
}
