import * as THREE from "three";
import type { AudioApi, Dim, EntitySave, GameCtx, GameEvent, RendererApi } from "../contracts";
import { createEntities, type MirrorEntities, type PlayerPicker } from "../entities";
import { BEHAVIORS } from "../mechanics";
import { createWorld, type KeepCenter, type World } from "../world";
import { loadEntities, saveEntities } from "../world/save";

// A dimension the host does not stand in but another player does. It ticks blocks and mobs with no renderer.
export interface DimState {
  dim: Dim;
  world: World;
  entities: MirrorEntities;
  sub: GameCtx & { playerFor?: PlayerPicker };
  emptySince: number;
  bes?: { tick(c: GameCtx): void; trackBlockEntity(x: number, y: number, z: number): void };
}

const noop = () => {};

function stubRenderer(): RendererApi {
  const scene = new THREE.Scene();
  return {
    scene,
    camera: new THREE.PerspectiveCamera(),
    renderer: null as unknown as THREE.WebGLRenderer,
    setDim: noop,
    setTime: noop,
    setWeather: noop,
    setRenderDistance: noop,
    setOptions: noop,
    setOutline: noop,
    setBreak: noop,
    setUnderwater: noop,
    setEffects: noop,
    setVisionFog: noop,
    addParticles: noop,
    meshQueue: () => 0,
    render: noop,
    resize: noop,
    dispose: noop,
  };
}

const silentAudio: AudioApi = { play: noop, setListener: noop, setVolume: noop, setMusic: noop, playRecord: noop, stopRecord: noop, dispose: noop };

export interface DimOpts {
  base: GameCtx;
  seed: number;
  worldId: string;
  ctxFor: (d: Dim) => GameCtx | null;
  emit: (d: Dim, e: GameEvent) => void;
}

export function openDim(o: DimOpts, dim: Dim, world?: World, saves?: EntitySave[]): DimState {
  const sub = Object.create(o.base) as DimState["sub"];
  sub.renderer = stubRenderer();
  sub.audio = silentAudio;
  sub.emit = (e: GameEvent) => o.emit(dim, e);
  const w = world ?? createWorld({ seed: o.seed, dim, worldId: o.worldId, behaviors: BEHAVIORS, getCtx: () => o.ctxFor(dim) ?? sub });
  sub.world = w;
  const entities = createEntities(() => sub);
  sub.entities = entities;
  const st: DimState = { dim, world: w, entities, sub, emptySince: 0 };
  if (saves) entities.load(saves);
  else
    void loadEntities(o.worldId, dim)
      .then((list) => {
        if (list.length && sub.entities === entities) entities.load(list);
      })
      .catch(() => {});
  return st;
}

export function tickDim(st: DimState, focus: KeepCenter, others: KeepCenter[]) {
  st.world.keep(others);
  st.world.update(focus.cx * 16 + 8, focus.cz * 16 + 8, focus.r);
  st.world.tick(st.sub);
  st.entities.tick(st.sub);
}

export async function closeDim(st: DimState, worldId: string, dispose = true) {
  const saves = st.entities.save();
  await Promise.all([st.world.save(), saveEntities(worldId, st.dim, saves)]).catch(() => {});
  if (!dispose) return;
  st.entities.dispose();
  st.world.dispose();
}
