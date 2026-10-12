import * as THREE from "three";
import type { Dim, GameCtx, ItemStack } from "../../contracts";
import { idOf, metaOf } from "../../contracts";
import { BLOCKS } from "../../blocks/registry";
import { smeltResult } from "../../items/recipes";
import { itemSprite } from "../../textures/icons";
import { type BlockCache, Kind } from "./cache";

const COOK_TICKS = 600;
const HAY = BLOCKS.find((b) => b.name === "hay_block")?.id ?? -1;
const SPOTS: number[][] = [
  [7, 7, 6],
  [5, 7, 6, 9, 6, 5],
  [7, 9, 6, 5, 7, 5, 8, 6, 4],
  [5, 5, 6, 8, 5, 5, 5, 8, 5, 9, 8, 3],
];

const pos = (k: string) => k.split(",").map(Number) as [number, number, number];

export function createCampfires(cache: BlockCache) {
  const tracked: Record<string, Set<string>> = { overworld: new Set(), nether: new Set(), end: new Set() };
  let dim: Dim = "overworld";
  let group: THREE.Group | null = null;
  const geo = new THREE.PlaneGeometry(0.375, 0.375);
  const mats = new Map<string, THREE.Material>();
  const meshes = new Map<string, THREE.Mesh>();

  function material(item: string): THREE.Material {
    let m = mats.get(item);
    if (!m) {
      const tex = new THREE.CanvasTexture(itemSprite(item));
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      m = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
      mats.set(item, m);
    }
    return m;
  }

  function syncMeshes(ctx: GameCtx) {
    if (!group) return;
    const live = new Set<string>();
    for (const k of tracked[dim]) {
      const [x, y, z] = pos(k);
      const be = ctx.world.getBlockEntity(x, y, z);
      const facing = metaOf(ctx.world.getBlock(x, y, z)) & 3;
      be?.items?.forEach((it, i) => {
        if (!it) return;
        const mk = `${k},${i},${it.item}`;
        live.add(mk);
        if (meshes.has(mk)) return;
        const mesh = new THREE.Mesh(geo, material(it.item));
        const a = ((facing + i) * Math.PI) / 2;
        const ox = -0.3125, oz = 0.3125;
        mesh.position.set(x + 0.5 + ox * Math.cos(a) - oz * Math.sin(a), y + 0.44, z + 0.5 + ox * Math.sin(a) + oz * Math.cos(a));
        mesh.rotation.set(-Math.PI / 2, 0, -a);
        group!.add(mesh);
        meshes.set(mk, mesh);
      });
    }
    for (const [mk, mesh] of meshes) {
      if (live.has(mk)) continue;
      group.remove(mesh);
      meshes.delete(mk);
    }
  }

  function cook(ctx: GameCtx) {
    const set = tracked[dim];
    for (const k of set) {
      const [x, y, z] = pos(k);
      if (!ctx.world.isLoaded(x, z)) continue;
      const s = ctx.world.getBlock(x, y, z);
      const be = ctx.world.getBlockEntity(x, y, z);
      if (BLOCKS[idOf(s)]?.shape !== "campfire" || !be?.items?.some((i) => i)) {
        set.delete(k);
        continue;
      }
      const lit = !(metaOf(s) & 4);
      const times = (be.data ??= {}).cook as number[] | undefined ?? (be.data.cook = [0, 0, 0, 0]);
      be.items.forEach((it, i) => {
        if (!it) return;
        times[i] = lit ? (times[i] ?? 0) + 1 : Math.max(0, (times[i] ?? 0) - 2);
        if (times[i] < COOK_TICKS) return;
        const r = smeltResult(it.item, "campfire");
        be.items![i] = null;
        times[i] = 0;
        if (r) ctx.entities.dropItem({ ...r.result } as ItemStack, x + 0.5, y + 1, z + 0.5);
      });
    }
  }

  function particles(ctx: GameCtx) {
    const pp = ctx.player.body.pos;
    const t = ctx.time.tick;
    cache.each(Math.floor(pp.x), Math.floor(pp.y), Math.floor(pp.z), 32, Kind.Campfire, (x, y, z, s) => {
      if (metaOf(s) & 4) return;
      const signal = idOf(ctx.world.getBlock(x, y - 1, z)) === HAY;
      if ((t + x * 7 + z * 13) % 4 === 0) ctx.emit({ type: "particles", kind: "smoke", x: x + 0.5, y: y + 0.6 + ctx.random() * 0.4, z: z + 0.5, count: 1 });
      if (signal && t % 2 === 0) ctx.emit({ type: "particles", kind: "smoke", x: x + 0.5, y: y + 1 + ctx.random() * 6, z: z + 0.5, count: 1 });
      else if (t % 6 === 0) ctx.emit({ type: "particles", kind: "smoke", x: x + 0.5, y: y + 1.2 + ctx.random() * 2, z: z + 0.5, count: 1 });
    });
    if (t % 3 !== 0) return;
    cache.each(Math.floor(pp.x), Math.floor(pp.y), Math.floor(pp.z), 24, Kind.Candle, (x, y, z, s) => {
      const m = metaOf(s);
      const cake = BLOCKS[idOf(s)].tags?.includes("candle_cakes");
      if (cake) {
        if (m & 1) ctx.emit({ type: "particles", kind: "flame", x: x + 0.5, y: y + 0.97, z: z + 0.5, count: 1 });
        return;
      }
      if (!(m & 4)) return;
      const spots = SPOTS[m & 3];
      for (let i = 0; i < spots.length; i += 3) {
        ctx.emit({ type: "particles", kind: "flame", x: x + (spots[i] + 1) / 16, y: y + (spots[i + 2] + 1.3) / 16, z: z + (spots[i + 1] + 1) / 16, count: 1 });
      }
    });
  }

  return {
    track(x: number, y: number, z: number) {
      tracked[dim].add(`${x},${y},${z}`);
    },
    stage(ctx: GameCtx) {
      dim = ctx.world.dim;
      group = new THREE.Group();
      group.name = "campfire-items";
      ctx.renderer.scene.add(group);
    },
    unstage(ctx: GameCtx) {
      if (group) ctx.renderer.scene.remove(group);
      group = null;
      meshes.clear();
    },
    tick(ctx: GameCtx) {
      cook(ctx);
      particles(ctx);
      if (ctx.time.tick % 5 === 0) syncMeshes(ctx);
    },
    save: () => Object.fromEntries(Object.entries(tracked).map(([d, s]) => [d, [...s]])),
    load(d: unknown) {
      const o = (d ?? {}) as Record<string, string[]>;
      for (const k of Object.keys(tracked)) tracked[k] = new Set(Array.isArray(o[k]) ? o[k] : []);
    },
    dispose() {
      geo.dispose();
      for (const m of mats.values()) {
        (m as THREE.MeshLambertMaterial).map?.dispose();
        m.dispose();
      }
      mats.clear();
    },
  };
}
