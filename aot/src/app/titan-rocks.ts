import * as THREE from "three";
import type { Fx, GameEvent, PlayerView, World } from "./contracts";
import { toon } from "./toon";

type Rock = { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; r: number; t: number; landed: number };

const G = 24;
const MAX = 40;
const _a = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export function createRocks(scene: THREE.Scene, world: World, fx: Fx) {
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = toon({ color: 0x9a9184 });
  const rocks: Rock[] = [];
  const free: THREE.Mesh[] = [];
  let hurtT = 0;
  const held = new THREE.Mesh(geo, mat);
  held.visible = false;
  held.castShadow = true;
  scene.add(held);

  const mesh = () => {
    const m = free.pop() ?? new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.visible = true;
    scene.add(m);
    return m;
  };

  return {
    hold(pos: THREE.Vector3 | null, r: number) {
      held.visible = !!pos;
      if (!pos) return;
      held.position.copy(pos);
      held.scale.setScalar(r);
      held.rotation.y += 0.05;
    },
    throw(from: THREE.Vector3, to: THREE.Vector3, time: number, r: number) {
      if (rocks.length >= MAX) return;
      const m = mesh();
      m.position.copy(from);
      m.scale.set(r * (0.8 + Math.random() * 0.5), r * (0.7 + Math.random() * 0.4), r * (0.8 + Math.random() * 0.5));
      const vel = _a.copy(to).sub(from).divideScalar(time);
      vel.y += 0.5 * G * time;
      rocks.push({ mesh: m, vel: vel.clone(), spin: new THREE.Vector3(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3), r, t: 0, landed: -1 });
    },
    update(dt: number, player: PlayerView | null, hurt: (amount: number, from: THREE.Vector3, knock: number, up: number) => void) {
      const ev: GameEvent[] = [];
      hurtT -= dt;
      const hit = (amount: number, at: THREE.Vector3, knock: number, up: number) => {
        if (hurtT > 0) return;
        hurtT = 0.4;
        hurt(amount, at, knock, up);
      };
      for (let i = rocks.length - 1; i >= 0; i--) {
        const k = rocks[i];
        const p = k.mesh.position;
        k.t += dt;
        if (k.landed < 0) {
          k.vel.y -= G * dt;
          const step = k.vel.length() * dt;
          _d.copy(k.vel).normalize();
          const wall = world.raycast(p, _d, step + k.r * 0.5);
          if (player?.alive && p.distanceTo(player.pos) < k.r + 1.4) {
            hit(0.22, p, 18, 6);
            k.landed = 0;
          } else if (wall >= 0 || p.y < -2 || k.t > 8) {
            if (wall >= 0) p.addScaledVector(_d, Math.max(0, wall - k.r * 0.4));
            k.landed = 0;
            fx.dust(p, k.r * 3);
            ev.push({ type: "sfx", name: "stomp", at: p.clone(), volume: 0.45 });
            if (player?.alive) {
              const d = p.distanceTo(player.pos);
              if (d < k.r * 2.5 + 3.5) hit(0.14 * (1 - d / (k.r * 2.5 + 3.5)) + 0.06, p, 14, 5);
              if (d < 45) ev.push({ type: "shake", strength: 0.18 * (1 - d / 45) });
            }
          } else {
            p.addScaledVector(k.vel, dt);
            _q.setFromEuler(_e.set(k.spin.x * dt, k.spin.y * dt, k.spin.z * dt));
            k.mesh.quaternion.premultiply(_q);
          }
        } else {
          k.landed += dt;
          if (k.landed > 2.5) p.y -= dt * k.r * 0.8;
          if (k.landed > 4) {
            scene.remove(k.mesh);
            free.push(k.mesh);
            rocks.splice(i, 1);
          }
        }
      }
      return ev;
    },
    dispose() {
      for (const k of rocks) scene.remove(k.mesh);
      rocks.length = 0;
      scene.remove(held);
      geo.dispose();
      mat.dispose();
    },
  };
}

export type Rocks = ReturnType<typeof createRocks>;
