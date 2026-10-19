import type { MeshInput, MeshOutput } from "../contracts";
import { GFX, meshSection } from "./mesher";

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; input: MeshInput; fancyLeaves?: boolean }>) => void) | null;
  postMessage(msg: unknown, transfer: Transferable[]): void;
};

scope.onmessage = (e) => {
  const { id, input } = e.data;
  GFX.fancyLeaves = e.data.fancyLeaves ?? true;
  const out: MeshOutput = meshSection(input);
  const transfer: Transferable[] = [];
  for (const b of [out.opaque, out.cutout, out.translucent]) {
    if (!b) continue;
    for (const a of Object.values(b.attributes)) transfer.push(a.array.buffer as ArrayBuffer);
    transfer.push(b.index.buffer as ArrayBuffer);
  }
  scope.postMessage({ id, out }, transfer);
};
