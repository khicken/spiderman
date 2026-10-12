import type { Dim, GameCtx, GameEvent, HudState } from "../contracts";
import { createBlocksA } from "./blocks-a";
import { createBlocksB } from "./blocks-b";
import { createVillagers } from "./villagers";
import { createBrewing } from "./brewing";
import { createEnd } from "./end";
import { createAdvancements } from "./advancements";
import { createDecor } from "./decor";
import { createSpawners } from "../loot/spawners";

// One game-wide system. It outlives dimension changes: stage() runs after each new world, renderer and entities exist.
export interface SystemPart {
  name: string;
  tick?(ctx: GameCtx): void;
  frame?(ctx: GameCtx, dt: number): void;
  onEvent?(ctx: GameCtx, e: GameEvent): void;
  stage?(ctx: GameCtx): void;
  unstage?(ctx: GameCtx): void;
  save?(): unknown;
  load?(data: unknown): void;
  dispose?(): void;
  respawn?(ctx: GameCtx): { dim: Dim; x: number; y: number; z: number } | null;
  bossBars?(ctx: GameCtx): HudState["bossBars"];
}

export function createSystems(getCtx: () => GameCtx) {
  const parts: SystemPart[] = [createBlocksA(), createBlocksB(), createVillagers(), createBrewing(), createEnd(), createAdvancements(), createDecor(), createSpawners()];
  const run = (f: (p: SystemPart) => void) => {
    for (const p of parts) {
      try {
        f(p);
      } catch (err) {
        console.error(`system ${p.name}`, err);
      }
    }
  };
  return {
    parts,
    tick: () => run((p) => p.tick?.(getCtx())),
    frame: (dt: number) => run((p) => p.frame?.(getCtx(), dt)),
    onEvent: (e: GameEvent) => run((p) => p.onEvent?.(getCtx(), e)),
    stage: () => run((p) => p.stage?.(getCtx())),
    unstage: () => run((p) => p.unstage?.(getCtx())),
    save(): Record<string, unknown> {
      const out: Record<string, unknown> = {};
      run((p) => {
        if (p.save) out[p.name] = p.save();
      });
      return out;
    },
    load(data: unknown) {
      const d = (data ?? {}) as Record<string, unknown>;
      run((p) => p.load?.(d[p.name]));
    },
    dispose: () => run((p) => p.dispose?.()),
    bossBars(out: HudState["bossBars"]) {
      run((p) => {
        if (p.bossBars) out.push(...p.bossBars(getCtx()));
      });
    },
    respawn(): { dim: Dim; x: number; y: number; z: number } | null {
      let out: { dim: Dim; x: number; y: number; z: number } | null = null;
      run((p) => {
        if (!out && p.respawn) out = p.respawn(getCtx());
      });
      return out;
    },
  };
}

export type Systems = ReturnType<typeof createSystems>;
