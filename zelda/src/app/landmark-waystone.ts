import type { V3 } from "./contracts";
import { PROLOGUE } from "./contracts";
import type { Emit, SiteEnv } from "./landmark-kit";
import { Mesher, PAL, glowMat, haloSprite, solidBox } from "./landmark-kit";

export interface WaystoneDef { id: string; name: string; x: number; z: number }

/** What the waystone needs from landmarks.ts: has this stone been found, and mark it found (returns true the first time). */
export interface WaystoneState {
  isFound(id: string): boolean;
  find(id: string): boolean;
}

export interface WaystoneHandle { id: string; pos: V3; setFound(on: boolean): void }

/** A rune stone on a round plinth. Dim until touched; then it glows, rests, saves and becomes a fast travel target. */
export function buildWaystone(env: SiteEnv, def: WaystoneDef, st: WaystoneState): WaystoneHandle {
  const { world, look, group } = env;
  const gy = world.heightAt(def.x, def.z);
  const owner = `landmarks:${def.id}`;
  const stone = new Mesher(300 + def.x * 0.13 + def.z * 0.07);
  const glyph = new Mesher(301);
  stone.cyl(def.x, gy - 0.5, def.z, 1.9, 1.75, 0.8, PAL.rockLo, 8, 0.2);
  stone.cyl(def.x, gy + 0.2, def.z, 1.5, 1.35, 0.25, PAL.rock, 8, 0.2);
  stone.box(def.x, gy + 0.45, def.z, 0.9, 2.6, 0.5, PAL.rockHi, 0.2);
  stone.box(def.x, gy + 3.0, def.z, 0.7, 0.35, 0.4, PAL.rock, 0.2);
  stone.box(def.x, gy + 0.45, def.z, 1.0, 0.3, 0.6, PAL.rockLo, 0.2, { ao: 0 });
  // glyph: a vertical bar with a ring, facing south (+z)
  glyph.boxc(def.x + 0.0, gy + 1.7, def.z + 0.27, 0.12, 1.1, 0.04, PAL.rune, 0.2, { ao: 0 });
  glyph.boxc(def.x, gy + 2.0, def.z + 0.27, 0.5, 0.1, 0.04, PAL.rune, 0.2, { ao: 0 });
  glyph.boxc(def.x, gy + 1.3, def.z + 0.27, 0.34, 0.1, 0.04, PAL.rune, 0.2, { ao: 0 });
  const sm = stone.build(look, undefined, "waystone");
  const dim = glowMat(look, PAL.rune, 0.25);
  const lit = glowMat(look, PAL.goldHi, 1.3);
  const gm = glyph.build(look, dim, "waystone-glyph");
  env.own(sm.geometry); env.own(gm.geometry);
  group.add(sm, gm);
  // plinth collider is a flat disc (low, wide); the slab is thin so it can never be climbed
  solidBox(world, null, owner + "-base", def.x, def.z, 3.0, 3.0, gy + 0.45, PAL.rock, "solid", { y0: gy - 0.5 });
  world.addBox({ minX: def.x - 0.45, maxX: def.x + 0.45, minZ: def.z - 0.25, maxZ: def.z + 0.25, minY: gy + 0.4, maxY: gy + 3.4, tag: "decor", owner: owner + "-slab" });

  const halo = haloSprite(env.glow, PAL.goldHi, 9);
  halo.position.set(def.x, gy + 2.2, def.z);
  group.add(halo);

  let found = st.isFound(def.id);
  let emit: Emit = () => {};
  const apply = () => {
    gm.material = found ? lit : dim;
    halo.visible = found;
  };
  apply();

  env.reg.interact({
    id: `waystone-${def.id}`, x: def.x, y: gy + 0.5, z: def.z, r: 3.6,
    label: () => (found ? "Rest" : "Touch"),
    use: () => {
      const pos = { x: def.x, y: gy + 0.5, z: def.z + 2.2 };
      if (!found) {
        found = true;
        const first = st.find(def.id);
        apply();
        emit({ type: "waystone", id: def.id, first });
      } else emit({ type: "waystone", id: def.id, first: false });
      emit({ type: "rest", pos });
    },
  });
  if (def.id === ORIEL_AT) buildOriel(env, def, gy, () => {
    // walking up to Oriel activates the stone, so her lines play without hunting for the prompt
    if (found) return;
    found = true;
    const first = st.find(def.id);
    apply();
    emit({ type: "waystone", id: def.id, first });
    emit({ type: "rest", pos: { x: def.x, y: gy + 0.5, z: def.z + 2.2 } });
  });
  env.reg.anim((c) => {
    emit = c.emit;
    if (!found) return;
    const dx = c.px - def.x, dz = c.pz - def.z;
    if (dx * dx + dz * dz > 120 * 120) return;
    const k = 9 + Math.sin(c.time * 1.5 + def.x) * 0.7;
    halo.scale.set(k, k, 1);
  });
  return {
    id: def.id,
    pos: { x: def.x, y: gy + 0.5, z: def.z + 2.2 },
    setFound(on) { found = on; apply(); },
  };
}

/** The waystone where Oriel the Ferrier waits (DESIGN-V2 4:40). */
export const ORIEL_AT = "ws-glade";
const ORIEL_ZONE_R = 6;

/** Oriel: a cloaked ferrier with a lantern staff, beside the stone and facing the Glade. Static; Tallow's line system speaks for her. */
function buildOriel(env: SiteEnv, def: WaystoneDef, gy: number, onMeet: () => void) {
  const { world, look, group } = env;
  const ox = def.x + 2.4, oz = def.z + 1.2;
  const og = world.heightAt(ox, oz);
  const yaw = Math.atan2(PROLOGUE.glade.x - ox, PROLOGUE.glade.z - oz);
  const fx = Math.sin(yaw), fz = Math.cos(yaw); // facing
  const rx = Math.cos(yaw), rz = -Math.sin(yaw); // her right
  const body = new Mesher(311);
  body.cone(ox, og, oz, 0.62, 1.55, PAL.gloamLo, 9, yaw);
  body.cyl(ox, og + 0.95, oz, 0.42, 0.3, 0.5, PAL.gloam, 9, yaw);
  body.cone(ox, og + 1.35, oz, 0.36, 0.95, PAL.gloam, 8, yaw); // hood
  body.ball(ox + fx * 0.06, og + 1.62, oz + fz * 0.06, 0.2, PAL.parchment, 1.1);
  body.cyl(ox - fx * 0.05, og + 1.0, oz - fz * 0.05, 0.44, 0.44, 0.08, PAL.cloth, 9, yaw, { ao: 0 }); // sash
  const sx = ox + rx * 0.55, sz = oz + rz * 0.55;
  body.beam(sx, og, sz, sx + fx * 0.15, og + 2.35, sz + fz * 0.15, 0.06, PAL.woodLo);
  body.beam(sx + fx * 0.15, og + 2.35, sz + fz * 0.15, sx + fx * 0.45, og + 2.3, sz + fz * 0.45, 0.05, PAL.woodLo);
  const lx = sx + fx * 0.45, lz = sz + fz * 0.45, ly = og + 1.95;
  const lamp = new Mesher(312);
  lamp.boxc(lx, ly, lz, 0.2, 0.26, 0.2, PAL.emberHi, yaw, { ao: 0, jit: 0 });
  const mb = body.build(look, undefined, "oriel");
  const ml = lamp.build(look, glowMat(look, PAL.emberHi, 1.6), "oriel-lantern");
  env.own(mb.geometry); env.own(ml.geometry);
  ml.castShadow = false;
  group.add(mb, ml);
  const glow = haloSprite(env.glow, PAL.ember, 2.6);
  glow.position.set(lx, ly, lz);
  group.add(glow);
  world.addBox({ minX: ox - 0.45, maxX: ox + 0.45, minZ: oz - 0.45, maxZ: oz + 0.45, minY: og, maxY: og + 1.9, tag: "decor", owner: `landmarks:${def.id}-oriel` });
  env.reg.zone({ id: `${def.id}-oriel`, x: ox, y: og, z: oz, r: ORIEL_ZONE_R, onEnter: onMeet });
  env.reg.anim((c) => {
    const k = 2.6 + Math.sin(c.time * 3.3) * 0.18;
    glow.scale.set(k, k, 1);
  });
  void gy;
}
