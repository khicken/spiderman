import * as THREE from "three";
import type { GameEvent, Input } from "./contracts";
import type { Fx } from "./fx";
import { createScout, FOOT, type ScoutPose } from "./scout";
import type { Titan, Titans } from "./titans";
import { raycast, type World } from "./world";

const G = 20;
const RUN = 9;
const JUMP = 8;
const RANGE = 100;
const HOOK_SPEED = 260;
const REEL = 34;
const BOOST = 36;
const MAX_SPEED = 80;
const HALF = 0.32;
const HEAD = 0.85;
const MAX_BLADES = 8;
const UP = new THREE.Vector3(0, 1, 0);

type Hook = {
  state: "idle" | "fly" | "on" | "back";
  t: number;
  dur: number;
  len: number;
  miss: boolean;
  point: THREE.Vector3;
  titan: Titan | null;
  obj: THREE.Object3D | null;
  local: THREE.Vector3;
  end: THREE.Vector3;
};

export function createPlayer(scene: THREE.Scene, world: World, titans: Titans, fx: Fx) {
  const scout = createScout();
  scene.add(scout.root);
  const pos = world.spawn.clone();
  const vel = new THREE.Vector3();
  const facing = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
  let mode: "ground" | "air" | "held" | "dead" = "ground";
  let health = 1;
  let gas = 1;
  let blades = MAX_BLADES;
  let sharp = 1;
  let slashT = 0;
  let slashCd = 0;
  let burstCd = 0;
  let reloadT = 0;
  let deadT = 0;
  let hurtT = 10;
  let phase = 0;
  let supplyT = 0;
  let inSupply = false;
  let boosting = false;
  const pending: GameEvent[] = [];

  const hooks: Hook[] = [0, 1].map(() => ({ state: "idle", t: 0, dur: 0, len: 0, miss: false, point: new THREE.Vector3(), titan: null, obj: null, local: new THREE.Vector3(), end: new THREE.Vector3() }));
  const cableGeo = new THREE.CylinderGeometry(0.02, 0.02, 1, 5).translate(0, 0.5, 0);
  const cableMat = new THREE.MeshStandardMaterial({ color: "#2b2b2b", roughness: 0.6, metalness: 0.5 });
  const headGeo = new THREE.ConeGeometry(0.07, 0.22, 6);
  const cables = hooks.map(() => {
    const c = new THREE.Mesh(cableGeo, cableMat);
    const h = new THREE.Mesh(headGeo, cableMat);
    c.visible = h.visible = false;
    c.frustumCulled = false;
    scene.add(c, h);
    return { c, h };
  });

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const from = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  const turn = new THREE.Quaternion();

  const anchor = (h: Hook, out: THREE.Vector3) => (h.obj ? out.copy(h.local).applyMatrix4(h.obj.matrixWorld) : out.copy(h.point));

  const sfx = (name: Extract<GameEvent, { type: "sfx" }>["name"], volume?: number) => pending.push({ type: "sfx", name, volume });

  const release = (h: Hook) => {
    if (h.state === "idle" || h.state === "back") return;
    h.state = "back";
    h.t = 0;
    h.titan = null;
    h.obj = null;
  };

  const fire = (side: number, inp: Input, lock: Titan | null) => {
    const h = hooks[side];
    dir.copy(inp.look).applyAxisAngle(UP, side ? -0.03 : 0.03);
    const reachT = RANGE + inp.camPos.distanceTo(pos);
    const tw = raycast(world, inp.camPos, dir, reachT, nrm);
    const tt = titans.raycast(inp.camPos, dir, reachT);
    h.titan = null;
    h.obj = null;
    h.miss = false;
    // Locked hooks find the titan's body when the line from the player is clear.
    let assist = lock && titans.nape(lock) && tt?.titan !== lock ? lock.m.spheres[side ? 2 : 3] : null;
    if (assist) {
      tmp.copy(assist.world).sub(pos);
      const d = tmp.length();
      if (d > RANGE || raycast(world, pos, tmp.divideScalar(d), d - 2) >= 0) assist = null;
    }
    if (assist && lock) {
      h.point.copy(assist.world);
      h.titan = lock;
      h.obj = assist.obj;
    } else if (tt && (tw < 0 || tt.t < tw)) {
      h.point.copy(inp.camPos).addScaledVector(dir, tt.t);
      h.titan = tt.titan;
      h.obj = tt.sphere.obj;
    } else if (tw >= 0) h.point.copy(inp.camPos).addScaledVector(dir, tw);
    else h.miss = true;
    if (!h.miss && h.point.distanceTo(pos) > RANGE) {
      h.miss = true;
      h.titan = null;
      h.obj = null;
    }
    if (h.miss) h.point.copy(pos).addScaledVector(dir, RANGE * 0.6);
    if (h.obj) {
      h.obj.updateMatrixWorld();
      h.local.copy(h.point).applyMatrix4(inv.copy(h.obj.matrixWorld).invert());
    }
    h.state = "fly";
    h.t = 0;
    h.dur = Math.max(0.05, h.point.distanceTo(pos) / HOOK_SPEED);
    sfx("hook");
  };
  const collide = () => {
    let grounded = false;
    if (pos.y - FOOT < 0) {
      pos.y = FOOT;
      if (vel.y < 0) vel.y = 0;
      grounded = true;
    }
    for (const b of world.near(pos.x, pos.z, 3)) {
      const ox = Math.min(pos.x + HALF - b.minX, b.maxX - (pos.x - HALF));
      const oy = Math.min(pos.y + HEAD - b.minY, b.maxY - (pos.y - FOOT));
      const oz = Math.min(pos.z + HALF - b.minZ, b.maxZ - (pos.z - HALF));
      if (ox <= 0 || oy <= 0 || oz <= 0) continue;
      if (oy <= ox && oy <= oz) {
        if (pos.y > (b.minY + b.maxY) / 2) {
          pos.y += b.maxY - (pos.y - FOOT);
          if (vel.y < 0) vel.y = 0;
          grounded = true;
        } else {
          pos.y -= pos.y + HEAD - b.minY;
          if (vel.y > 0) vel.y = 0;
        }
      } else if (ox <= oz) {
        const sgn = pos.x > (b.minX + b.maxX) / 2 ? 1 : -1;
        pos.x += sgn * ox;
        if (vel.x * sgn < 0) vel.x = 0;
      } else {
        const sgn = pos.z > (b.minZ + b.maxZ) / 2 ? 1 : -1;
        pos.z += sgn * oz;
        if (vel.z * sgn < 0) vel.z = 0;
      }
    }
    titans.pushOut(pos, 0.5, vel);
    return grounded;
  };

  const die = () => {
    mode = "dead";
    deadT = 0;
    health = 0;
    hooks.forEach(release);
    pending.push({ type: "toast", title: "You died", text: "Respawning at a supply depot" }, { type: "sfx", name: "death" });
  };

  const api = {
    pos,
    vel,
    get mode() {
      return mode;
    },
    get alive() {
      return mode !== "dead";
    },
    setVisible(on: boolean) {
      scout.root.visible = on;
    },
    hud() {
      return {
        health,
        gas,
        blades,
        sharp,
        supply: inSupply,
        dead: mode === "dead",
        hooks: [hooks[0].state === "on", hooks[1].state === "on"] as [boolean, boolean],
      };
    },
    damage(amount: number) {
      if (mode === "dead") return;
      health -= amount;
      hurtT = 0;
      if (health <= 0) die();
    },
    respawn() {
      let best = world.supplies[0];
      for (const s of world.supplies) if (s.distanceTo(pos) < best.distanceTo(pos)) best = s;
      pos.set(best.x, FOOT, best.z + 4);
      vel.set(0, 0, 0);
      health = 1;
      gas = 1;
      blades = Math.max(blades, 4);
      sharp = 1;
      mode = "ground";
    },
    update(dt: number, inp: Input, lock: Titan | null, playing: boolean): GameEvent[] {
      const out = pending.splice(0);
      slashCd -= dt;
      burstCd -= dt;
      reloadT -= dt;
      slashT = Math.max(0, slashT - dt / 0.3);
      hurtT += dt;
      boosting = false;

      for (const h of hooks) if (h.titan && titans.gone(h.titan)) release(h);

      const grip = titans.held();
      if (mode === "dead") {
        deadT += dt;
        vel.y -= G * dt;
        pos.addScaledVector(vel, dt);
        collide();
        vel.multiplyScalar(Math.exp(-3 * dt));
        if (deadT > 3) api.respawn();
      } else if (grip) {
        if (mode !== "held") hooks.forEach(release);
        mode = "held";
        pos.copy(grip);
        vel.set(0, 0, 0);
        if (playing && inp.pressed.has("slash") && slashCd <= 0) {
          slashCd = 0.1;
          slashT = 1;
          const r = titans.slash(pos, 1, 0, sharp);
          out.push(...r.events);
          sharp = Math.max(0, sharp - 0.04);
        }
      } else {
        if (mode === "held") {
          mode = "air";
          vel.set(Math.random() * 10 - 5, 12, Math.random() * 10 - 5);
        }
        if (playing) {
          (["hookL", "hookR"] as const).forEach((a, side) => {
            if (inp.pressed.has(a)) fire(side, inp, lock);
            if (inp.released.has(a) && hooks[side].state !== "idle") {
              release(hooks[side]);
              sfx("retract", 0.5);
            }
          });

          if (inp.pressed.has("jump")) {
            if (mode === "ground") {
              vel.y = JUMP;
              mode = "air";
            } else if (gas > 0.05 && burstCd <= 0) {
              vel.addScaledVector(inp.look, 9).y += 6;
              gas -= 0.05;
              burstCd = 0.35;
              sfx("burst");
              fx.burst(tmp.copy(pos).addScaledVector(inp.look, -0.6), 12, { size: 0.4, grow: 5, life: 0.8, speed: 3, rise: 0 });
            }
          }
          boosting = inp.held.has("boost") && gas > 0;

          if (inp.pressed.has("reload") && blades > 0 && sharp < 1 && reloadT <= 0) {
            blades--;
            sharp = 1;
            reloadT = 0.5;
            sfx("reload");
            out.push({ type: "toast", title: "Blades swapped", text: `${blades} sets left` });
          }

          if (inp.pressed.has("slash") && slashCd <= 0 && reloadT <= 0) {
            slashCd = 0.4;
            if (sharp <= 0) {
              sfx("dull");
              out.push({ type: "toast", title: blades ? "Blades dull" : "No blades left", text: blades ? "Press R to swap" : "Find a supply depot" });
            } else {
              slashT = 1;
              const speed = vel.length();
              tmp.copy(vel);
              if (speed < 4) tmp.copy(inp.look);
              tmp.normalize();
              const r = titans.slash(tmp2.copy(pos).addScaledVector(tmp, 1.6), 2.6 + speed * 0.04, speed, sharp);
              out.push(...r.events);
              if (r.hit) sharp = Math.max(0, sharp - 0.15);
              else sfx("slash");
            }
          }
        }

        for (const h of hooks) {
          if (h.state === "fly") {
            h.t += dt;
            if (h.t >= h.dur) {
              if (h.miss) {
                h.state = "back";
                h.t = 0;
                sfx("hookMiss");
              } else {
                h.state = "on";
                h.len = anchor(h, tmp).distanceTo(pos);
                sfx("hookHit");
              }
            }
          } else if (h.state === "back") {
            h.t += dt;
            if (h.t > 0.15) h.state = "idle";
          }
        }

        const on = hooks.filter((h) => h.state === "on");
        const N = 4;
        const hs = dt / N;
        let grounded = mode === "ground";
        for (let i = 0; i < N; i++) {
          if (grounded && !on.length && !boosting) {
            tmp.copy(inp.wish).multiplyScalar(RUN);
            vel.x += (tmp.x - vel.x) * (1 - Math.exp(-10 * hs));
            vel.z += (tmp.z - vel.z) * (1 - Math.exp(-10 * hs));
            vel.y -= G * hs;
          } else {
            vel.y -= G * hs;
            if (on.length) {
              tmp.set(0, 0, 0);
              for (const h of on) tmp.add(anchor(h, tmp2));
              tmp.divideScalar(on.length).sub(pos);
              const d = tmp.length();
              if (d > 2.5) vel.addScaledVector(tmp.divideScalar(d), REEL * (on.length === 2 ? 1.25 : 1) * hs);
              tmp.copy(inp.wish);
              vel.addScaledVector(tmp, 9 * hs);
            } else {
              const along = vel.x * inp.wish.x + vel.z * inp.wish.z;
              if (along < 14) vel.addScaledVector(inp.wish, 7 * hs);
            }
            if (boosting) vel.addScaledVector(inp.look, BOOST * hs);
            vel.multiplyScalar(Math.exp(-0.06 * hs));
          }
          if (vel.length() > MAX_SPEED) vel.setLength(MAX_SPEED);
          pos.addScaledVector(vel, hs);
          for (const h of on) {
            anchor(h, tmp2);
            tmp.copy(pos).sub(tmp2);
            const d = tmp.length();
            if (d > h.len && d > 1e-3) {
              tmp.divideScalar(d);
              pos.copy(tmp2).addScaledVector(tmp, h.len);
              const radial = vel.dot(tmp);
              if (radial > 0) vel.addScaledVector(tmp, -radial);
            }
            h.len = Math.max(1.5, Math.min(h.len, d));
          }
          grounded = collide();
        }
        if (grounded && vel.y <= 0.1 && !on.length) {
          if (mode === "air" && vel.y < -0.1) sfx("land", 0.6);
          mode = "ground";
        } else mode = "air";
      }

      if (boosting) {
        gas = Math.max(0, gas - 0.11 * dt);
        if (Math.random() < 0.8) fx.burst(tmp.copy(pos).addScaledVector(inp.look, -0.7).addScaledVector(UP, -0.3), 1, { size: 0.3, grow: 5, life: 0.6, speed: 1.5, rise: 0.2 });
      }

      inSupply = mode !== "dead" && pos.y < 8 && world.supplies.some((s) => Math.hypot(s.x - pos.x, s.z - pos.z) < 8);
      if (inSupply) {
        const was = gas < 0.99 || blades < MAX_BLADES || sharp < 1 || health < 1;
        gas = Math.min(1, gas + 0.4 * dt);
        health = Math.min(1, health + 0.15 * dt);
        supplyT += dt;
        if (supplyT > 0.5) {
          supplyT = 0;
          if (blades < MAX_BLADES) blades++;
          else if (sharp < 1) sharp = 1;
        }
        if (was && gas >= 0.99 && blades >= MAX_BLADES && sharp >= 1 && health >= 1) sfx("refill");
      } else if (hurtT > 6 && mode !== "dead") health = Math.min(1, health + 0.01 * dt);

      const flat = Math.hypot(vel.x, vel.z);
      let pose: ScoutPose = "idle";
      let climb = 0;
      if (mode === "dead") pose = "dead";
      else if (mode === "held") pose = "held";
      else if (mode === "ground") {
        if (flat > 1) {
          pose = "run";
          phase += (flat / 2.4) * dt * Math.PI;
          facing.slerp(turn.setFromAxisAngle(UP, Math.atan2(vel.x, vel.z)), 1 - Math.exp(-12 * dt));
        }
      } else {
        pose = hooks.some((h) => h.state === "on") ? "hooked" : "air";
        if (flat > 2) facing.slerp(turn.setFromAxisAngle(UP, Math.atan2(vel.x, vel.z)), 1 - Math.exp(-6 * dt));
        climb = THREE.MathUtils.clamp(Math.atan2(flat, Math.max(1, Math.abs(vel.y))) * 0.5, 0, 0.9);
      }
      phase += dt;
      scout.root.position.copy(pos);
      scout.root.quaternion.copy(facing);
      scout.animate(pose, dt, { phase, speed: vel.length(), slash: slashT, climb });
      scout.root.updateMatrixWorld(true);

      hooks.forEach((h, i) => {
        const { c, h: head } = cables[i];
        if (h.state === "idle") {
          c.visible = head.visible = false;
          return;
        }
        scout.launcher[i].getWorldPosition(from);
        if (h.state === "on") anchor(h, h.end);
        else if (h.state === "fly") h.end.copy(from).lerp(anchor(h, tmp), Math.min(1, h.t / h.dur));
        else h.end.lerp(from, Math.min(1, h.t / 0.15));
        tmp.copy(h.end).sub(from);
        const len = tmp.length();
        c.visible = head.visible = len > 0.05;
        if (!c.visible) return;
        tmp.divideScalar(len);
        c.position.copy(from);
        c.quaternion.setFromUnitVectors(UP, tmp);
        c.scale.set(1, len, 1);
        head.position.copy(h.end);
        head.quaternion.copy(c.quaternion);
      });

      return out;
    },
    dispose() {
      cableGeo.dispose();
      headGeo.dispose();
      cableMat.dispose();
    },
  };
  return api;
}

export type Player = ReturnType<typeof createPlayer>;
