import * as THREE from "three";
import type { CreateNature, Fx, GameEvent, Look, Nature, Quality, QualityPreset, World } from "./contracts";
import { PLAYER_SPAWN, QUALITY } from "./contracts";
import { GrassSystem } from "./nature-grass";
import { LifeSystem } from "./nature-life";
import { PropSystem } from "./nature-props";
import { TreeSystem } from "./nature-trees";
import { makePlaceEnv } from "./nature-util";

const REFRESH_DIST = 4;
const REFRESH_YAW = 0.4;
const GRASS_BUDGET_MS = 2.2;

export const createNature: CreateNature = (scene: THREE.Scene, world: World, look: Look, quality: Quality): Nature => {
  let q: QualityPreset = QUALITY[quality];
  const group = new THREE.Group();
  group.name = "nature";
  scene.add(group);

  const env = makePlaceEnv(world);
  const trees = new TreeSystem(group, look);
  const props = new PropSystem(group, look);
  trees.place(env);
  props.place(env);
  trees.build();
  props.build();
  const grass = new GrassSystem(group, look, world, q);
  const life = new LifeSystem(group, look, world, q);

  const fwd = new THREE.Vector3();
  let fx: Fx | null = null;
  let now = 0;
  let lastX = 1e9, lastZ = 1e9, lastYaw = 1e9;
  let disposed = false;
  const burstPos = { x: 0, y: 0, z: 0 };

  const sy = world.heightAt(PLAYER_SPAWN.x, PLAYER_SPAWN.z);
  grass.prewarm(PLAYER_SPAWN.x, PLAYER_SPAWN.z, 60);
  void sy;

  const refresh = (cx: number, cz: number, dx: number, dz: number) => {
    trees.refresh(cx, cz, dx, dz, q);
    props.refresh(cx, cz, dx, dz, q);
    lastX = cx; lastZ = cz; lastYaw = Math.atan2(dz, dx);
  };

  return {
    group,

    update(ctx) {
      if (disposed) return;
      fx = ctx.fx;
      now = ctx.time;
      const cam = ctx.camera;
      cam.getWorldDirection(fwd);
      const l = Math.hypot(fwd.x, fwd.z) || 1;
      const dx = fwd.x / l, dz = fwd.z / l;
      const cx = cam.position.x, cz = cam.position.z;
      let dyaw = Math.abs(Math.atan2(dz, dx) - lastYaw);
      if (dyaw > Math.PI) dyaw = Math.PI * 2 - dyaw;
      if (Math.hypot(cx - lastX, cz - lastZ) > REFRESH_DIST || dyaw > REFRESH_YAW) refresh(cx, cz, dx, dz);
      grass.update(cx, cz, dx, dz, ctx.time, GRASS_BUDGET_MS);
      const p = ctx.player.pos;
      life.update(ctx.dt, ctx.time, cx, cz, dx, dz, p.x, p.y, p.z, ctx.env.daylight, ctx.env.rain);
    },

    handle(events: readonly GameEvent[]) {
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (e.type === "swing" || e.type === "spin") {
          const spin = e.type === "spin";
          const n = grass.cut(e.pos.x, e.pos.z, spin ? 3.4 : 2.3, now);
          life.scatter(e.pos.x, e.pos.z, 9);
          if (n > 0 && fx) {
            burstPos.x = e.pos.x; burstPos.y = e.pos.y + 0.5; burstPos.z = e.pos.z;
            fx.burst("leaf", burstPos, Math.min(spin ? 14 : 8, 3 + (n >> 4)));
          }
        } else if (e.type === "land" && e.speed > 6) {
          life.scatter(e.pos.x, e.pos.z, 10);
        } else if (e.type === "arrowHit" && e.on === "ground") {
          life.scatter(e.pos.x, e.pos.z, 7);
        }
      }
    },

    setQuality(nq: Quality) {
      q = QUALITY[nq];
      grass.setQuality(q);
      life.setQuality(q);
      lastX = 1e9;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      trees.dispose(world);
      props.dispose(world);
      grass.dispose();
      life.dispose();
      scene.remove(group);
    },
  };
};
