import type { Dim } from "../contracts";
import { generateChunk } from "./index";

interface GenRequest {
  id: number;
  seed: number;
  dim: Dim;
  cx: number;
  cz: number;
}

const ctx = self as unknown as { onmessage: ((e: MessageEvent<GenRequest>) => void) | null; postMessage(msg: unknown, transfer: Transferable[]): void };

ctx.onmessage = (e) => {
  const { id, seed, dim, cx, cz } = e.data;
  try {
    const chunk = generateChunk(seed, dim, cx, cz);
    ctx.postMessage({ id, chunk }, [chunk.blocks.buffer, chunk.light.buffer, chunk.biomes.buffer, chunk.heightmap.buffer]);
  } catch (err) {
    ctx.postMessage({ id, error: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err) }, []);
  }
};
