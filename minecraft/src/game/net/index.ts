import type { Dim, EntityApi, EntitySave, GameCtx, GameEvent } from "../contracts";
import type { MirrorEntities } from "../entities";
import type { createInventory } from "../items";
import type { PlayerHandle } from "../player";
import type { Settings } from "../ui/settings";
import type { RemoteLink, World } from "../world";
import type { WorldMeta } from "../world/save";
import type { PlayerListEntry } from "./protocol";

export type Inventory = ReturnType<typeof createInventory>;

// What game.ts lends the net layer.
export interface GameInternals {
  ctx: GameCtx;
  meta: WorldMeta;
  readonly world: World;
  readonly entities: EntityApi;
  readonly dim: Dim;
  readonly phase: "loading" | "playing";
  readonly settings: Settings;
  player: PlayerHandle;
  inventory: Inventory;
  chat(text: string, color?: string): void;
  actionBar(text: string): void;
  route(e: GameEvent): void;
  systemsSave(): Record<string, unknown>;
}

// Hooks game.ts calls. A host implements the world hand-off; a client implements the remote world and mirrors.
export interface NetLink {
  readonly role: "host" | "client";
  readonly code: string;
  attach?(g: GameInternals): void;
  ctxFor?(d: Dim): GameCtx | null;
  adoptWorld?(d: Dim): { world: World; saves: EntitySave[] } | null;
  releaseWorld?(d: Dim, world: World, saves: EntitySave[]): boolean;
  remoteWorld?(d: Dim): RemoteLink;
  wrapEntities?(e: MirrorEntities): EntityApi;
  wrapInventory?(inv: Inventory): void;
  event(e: GameEvent): void;
  tick(): void;
  afterTick?(): void;
  frame(dt: number): void;
  beforeSave?(meta: WorldMeta): void;
  say(text: string): void;
  command?(line: string): string[] | null; // null runs the command locally
  players(): PlayerListEntry[];
  dispose(): void;
}

export { createHost, type LanOptions } from "./host";
export { connectClient, type ClientLink, type JoinStatus } from "./client";
export { playerName, setPlayerNameStored, servers, rememberServer, forgetServer, type ServerEntry } from "./profile";
export { newRoomCode, cleanRoomCode, validCode, MAX_PLAYERS, type PlayerListEntry } from "./protocol";
