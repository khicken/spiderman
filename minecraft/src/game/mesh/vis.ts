import { FULL } from "./tables";

// Bit pairBit(a, b) is set when an open path joins section faces a and b (face order +x -x +y -y +z -z).
export const pairBit = (a: number, b: number) => 1 << (a < b ? a * 6 + b : b * 6 + a);
export const ALL_VIS = 0x7fffffff;

const SEEN = new Uint8Array(4096);
const STACK = new Int32Array(4096);

const padOf = (c: number) => (((c >> 8) + 1) * 18 + ((c >> 4) & 15) + 1) * 18 + (c & 15) + 1;

export function sectionVisibility(blocks: Uint16Array): number {
  let open = 0;
  for (let c = 0; c < 4096; c++) {
    const full = FULL[blocks[padOf(c)] & 0xfff];
    SEEN[c] = full;
    if (!full) open++;
  }
  if (open === 4096) return ALL_VIS;
  if (open === 0) return 0;
  let vis = 0;
  for (let s = 0; s < 4096; s++) {
    if (SEEN[s]) continue;
    let faces = 0;
    let sp = 0;
    STACK[sp++] = s;
    SEEN[s] = 1;
    while (sp) {
      const c = STACK[--sp];
      const x = c & 15, z = (c >> 4) & 15, y = c >> 8;
      if (x === 15) faces |= 1; else if (!SEEN[c + 1]) { SEEN[c + 1] = 1; STACK[sp++] = c + 1; }
      if (x === 0) faces |= 2; else if (!SEEN[c - 1]) { SEEN[c - 1] = 1; STACK[sp++] = c - 1; }
      if (y === 15) faces |= 4; else if (!SEEN[c + 256]) { SEEN[c + 256] = 1; STACK[sp++] = c + 256; }
      if (y === 0) faces |= 8; else if (!SEEN[c - 256]) { SEEN[c - 256] = 1; STACK[sp++] = c - 256; }
      if (z === 15) faces |= 16; else if (!SEEN[c + 16]) { SEEN[c + 16] = 1; STACK[sp++] = c + 16; }
      if (z === 0) faces |= 32; else if (!SEEN[c - 16]) { SEEN[c - 16] = 1; STACK[sp++] = c - 16; }
    }
    for (let a = 0; a < 6; a++) {
      if (!(faces & (1 << a))) continue;
      for (let b = a + 1; b < 6; b++) if (faces & (1 << b)) vis |= pairBit(a, b);
    }
  }
  return vis;
}
