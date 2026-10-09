import * as THREE from "three";
import type { City } from "./city";
import { BOUNDS, onLand } from "./city-geo";
import { softDot } from "./city-textures";
import type { GameEvent, Input } from "./contracts";
import { R, insideAny, type Player } from "./player";
import type { Fade } from "./interiors-fade";

export const SURFACE = -0.6;
const SWIM_FLOOR = -1.45;
const RECOVER_IDLE = 4;
const FOAM = 320;
const RINGS = 12;

export function riverFloor(x: number, z: number) {
  return onLand(x, z) ? 0 : SWIM_FLOOR;
}

const inBounds = (x: number, z: number) => x > BOUNDS.minX + 4 && x < BOUNDS.maxX - 4 && z > BOUNDS.minZ + 4 && z < BOUNDS.maxZ - 4;

export function createWater(scene: THREE.Scene, city: City) {
  const pos = new Float32Array(FOAM * 3);
  const col = new Float32Array(FOAM * 3);
  const vel = new Float32Array(FOAM * 3);
  const life = new Float32Array(FOAM);
  const maxLife = new Float32Array(FOAM).fill(1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const dot = softDot();
  const foam = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size: 0.32, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  foam.frustumCulled = false;
  foam.visible = false;
  let next = 0;
  let alive = 0;

  const ringTex = ringTexture();
  const ringMat = new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const rings = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), ringMat, RINGS);
  rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rings.setColorAt(0, new THREE.Color(0, 0, 0));
  rings.frustumCulled = false;
  rings.count = 0;
  const ring = Array.from({ length: RINGS }, () => ({ x: 0, z: 0, t: 1, dur: 1, size: 1, k: 0 }));
  let ringNext = 0;
  scene.add(foam, rings);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  const c = new THREE.Color();

  const puff = (x: number, y: number, z: number, vx: number, vy: number, vz: number, t: number) => {
    const i = next;
    next = (next + 1) % FOAM;
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    vel[i * 3] = vx;
    vel[i * 3 + 1] = vy;
    vel[i * 3 + 2] = vz;
    life[i] = t;
    maxLife[i] = t;
  };
  const ripple = (x: number, z: number, size: number, dur: number, k: number) => {
    const r = ring[ringNext];
    ringNext = (ringNext + 1) % RINGS;
    r.x = x;
    r.z = z;
    r.size = size;
    r.dur = dur;
    r.k = k;
    r.t = 0;
  };

  const splash = (p: THREE.Vector3, k: number) => {
    const n = Math.round(30 + 90 * k);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const core = i < n * 0.45;
      const sp = core ? Math.random() * 1.2 : (1.5 + Math.random() * 3) * (0.5 + k);
      const up = core ? (6 + Math.random() * 8) * (0.5 + k) : (2 + Math.random() * 5) * (0.4 + k);
      const rad = core ? 0.25 : 0.6;
      puff(p.x + Math.cos(a) * rad, SURFACE + 0.1, p.z + Math.sin(a) * rad, Math.cos(a) * sp, up, Math.sin(a) * sp, 0.5 + Math.random() * 0.6);
    }
    ripple(p.x, p.z, 3 + 5 * k, 1.4, 1);
    ripple(p.x, p.z, 1.5 + 3 * k, 1.0, 0.8);
  };

  let was = false;
  let lastVy = 0;
  let wakeT = 0;
  let ringT = 0;
  let idle = 0;
  let recovered = false;
  const events: GameEvent[] = [];
  const shore = new THREE.Vector3();
  const face = new THREE.Vector3();

  const recoverTo = (p: THREE.Vector3) => {
    for (let r = 4; r < 1200; r += 4) {
      const n = Math.max(16, Math.round(r / 3));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const dx = Math.cos(a), dz = Math.sin(a);
        const x = p.x + dx * (r + 4), z = p.z + dz * (r + 4);
        if (!onLand(p.x + dx * r, p.z + dz * r) || !onLand(x, z) || !inBounds(x, z) || insideAny(city, x, 1, z, 0.6)) continue;
        face.set(dx, 0, dz);
        return shore.set(x, R + 0.05, z);
      }
    }
    face.set(0, 0, 1);
    return shore.set(p.x, R + 0.05, p.z);
  };

  return {
    update(dt: number, input: Input, player: Player, fade: Fade) {
      events.length = 0;
      if (recovered) {
        recovered = false;
        events.push({ type: "toast", title: "Back on dry land" });
      }
      const p = player.pos;
      const swim = player.swimming;
      if (swim && !was) {
        const k = THREE.MathUtils.clamp(-lastVy / 30, 0.1, 1);
        splash(p, k);
        events.push({ type: "sfx", name: "land", volume: 0.5 + 0.5 * k });
        if (k > 0.5) events.push({ type: "sfx", name: "whoosh", volume: 0.5 * k }, { type: "shake", strength: 0.2 * k });
        idle = 0;
      } else if (!swim && was && player.vel.y > 4) {
        splash(p, 0.3);
        events.push({ type: "sfx", name: "whoosh", volume: 0.4 });
      }
      was = swim;
      lastVy = player.vel.y;

      if (swim) {
        const flat = Math.hypot(player.vel.x, player.vel.z);
        wakeT -= dt;
        ringT -= dt;
        if (flat > 1 && wakeT <= 0) {
          wakeT = 0.05;
          const fx = player.vel.x / flat;
          const fz = player.vel.z / flat;
          for (const s of [-1, 1]) {
            const sx = -fz * s;
            const sz = fx * s;
            puff(p.x + fx * 0.6 + sx * 0.3, SURFACE + 0.05, p.z + fz * 0.6 + sz * 0.3, sx * 1.6 - fx * 0.5, 0.8 + Math.random(), sz * 1.6 - fz * 0.5, 0.9);
          }
          puff(p.x - fx * 0.8, SURFACE + 0.14, p.z - fz * 0.8, (Math.random() - 0.5) * 0.6, 0.3, (Math.random() - 0.5) * 0.6, 1.4);
        }
        if (ringT <= 0) {
          ringT = flat > 1 ? 0.35 : 1.1;
          ripple(p.x, p.z, flat > 1 ? 1.8 : 1.3, flat > 1 ? 1.2 : 1.6, flat > 1 ? 0.55 : 0.4);
        }
        const active = input.wish.lengthSq() > 0 || input.held.size > 0;
        idle = active ? 0 : idle + dt;
        if (idle > RECOVER_IDLE && !fade.busy) {
          idle = 0;
          const to = recoverTo(p).clone();
          const dir = face.clone();
          fade.run(() => {
            player.teleport(to);
            player.face(dir);
            recovered = true;
          });
        }
      } else idle = 0;

      alive = 0;
      for (let i = 0; i < FOAM; i++) {
        if (life[i] <= 0) {
          col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0;
          continue;
        }
        alive++;
        life[i] -= dt;
        const j = i * 3;
        vel[j + 1] -= 14 * dt;
        pos[j] += vel[j] * dt;
        pos[j + 1] += vel[j + 1] * dt;
        pos[j + 2] += vel[j + 2] * dt;
        if (pos[j + 1] < SURFACE + 0.14) {
          pos[j + 1] = SURFACE + 0.14;
          vel[j] *= 0.9;
          vel[j + 1] = 0;
          vel[j + 2] *= 0.9;
        }
        const a = Math.max(0, life[i] / maxLife[i]);
        const b = 0.7 * a * (a > 0.85 ? (1 - a) / 0.15 : 1);
        col[j] = b;
        col[j + 1] = b;
        col[j + 2] = b;
      }
      foam.visible = alive > 0;
      if (alive > 0) {
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
      }

      let n = 0;
      for (const r of ring) {
        if (r.t >= 1) continue;
        r.t = Math.min(1, r.t + dt / r.dur);
        const e = 1 - (1 - r.t) * (1 - r.t);
        const s = 0.4 + r.size * e;
        m4.compose(v3.set(r.x, SURFACE + 0.02, r.z), q, s3.set(s, 1, s));
        rings.setMatrixAt(n, m4);
        rings.setColorAt(n, c.setScalar(0.45 * r.k * (1 - r.t) * (1 - r.t)));
        n++;
      }
      rings.count = n;
      if (n) {
        rings.instanceMatrix.needsUpdate = true;
        if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
      }
      return events;
    },
    dispose() {
      scene.remove(foam, rings);
      geo.dispose();
      (foam.material as THREE.Material).dispose();
      dot.dispose();
      rings.geometry.dispose();
      ringMat.dispose();
      ringTex.dispose();
    },
  };
}

export type Water = ReturnType<typeof createWater>;

function ringTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,255,255,0)");
  gr.addColorStop(0.72, "rgba(255,255,255,0)");
  gr.addColorStop(0.86, "rgba(255,255,255,1)");
  gr.addColorStop(0.93, "rgba(255,255,255,0.35)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
