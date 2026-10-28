import type { ChunkData } from "../contracts";
import { chunkIndex, idOf, metaOf, stateOf } from "../contracts";
import { blockId } from "../blocks/registry";

// Generated vaults used to store a face index (4 south, 1 west, 5 north, 0 east) in meta.
// Vaults written since always carry a boolean data.ominous, and old generated ones never did.
const OLD_FACE_TO_H: Record<number, number> = { 4: 0, 1: 1, 5: 2, 0: 3 };

export function migrateChunk(c: ChunkData): ChunkData {
  const vault = blockId("vault");
  for (const be of c.blockEntities ?? []) {
    if (be.type !== "vault" || typeof be.data?.ominous === "boolean") continue;
    const i = chunkIndex(be.x & 15, be.y, be.z & 15);
    const s = c.blocks[i];
    if (idOf(s) === vault && metaOf(s) in OLD_FACE_TO_H) c.blocks[i] = stateOf(vault, OLD_FACE_TO_H[metaOf(s)]);
    be.data = { ...be.data, ominous: false };
  }
  return c;
}
