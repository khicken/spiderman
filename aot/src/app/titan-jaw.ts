import * as THREE from "three";
import type { Fx, GameEvent, PlayerView, World } from "./contracts";
import { BN, crystal, type Rig, type Variant } from "./titan-model";

type JawT = {
  pos: THREE.Vector3; yaw: number; height: number; at: number; hit: boolean; cool: number; special: number; speed: number;
  aim: THREE.Vector3; aim2: THREE.Vector3; mark: number; hardened: boolean; hard: number; sev: number[]; nape: THREE.Vector3;
  act: string; v: Variant; rig: Rig; crystalScale: THREE.Vector3[];
};
type Tg = { move: number; jaw: number; crouch: number; lean: number; roar: number; flail: number; lookPitchAdd: number };

const WIND = 0.8;
const LOCK = 0.35;
const LUNGE = 0.45;
const REACH = 30;
const STAGGER = 2.6;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

export function createJaw<T extends JawT>(c: {
  world: World;
  fx: Fx;
  out: GameEvent[];
  rnd: () => number;
  hurt: (amount: number, from: THREE.Vector3, knock: number, up: number) => void;
  mouth: (ti: T, o: THREE.Vector3) => THREE.Vector3;
  walk: (ti: T) => void;
  bite: (ti: T) => void;
}) {
  const sfx = (name: "roar" | "bite" | "stomp" | "steamHiss" | "harden" | "titanStep", at: THREE.Vector3, volume?: number) =>
    c.out.push({ type: "sfx", name, at: at.clone(), volume });
  const kneeling = (ti: T) => ti.sev[2] > 0 || ti.sev[3] > 0;

  return {
    dress(ti: T) {
      const d = ti.v.d, b = ti.rig.bones;
      const nape = crystal();
      nape.position.set(0, d.nl * 0.75, -d.nr * 1.05);
      nape.scale.set(d.nr * 1.9, d.nl * 1.4, d.nr * 1.0);
      b[BN.neck].add(nape);
      const claws = [BN.fingL, BN.fingR].map((h) => {
        const m = crystal();
        m.position.set(0, -d.hand * 0.2, 0);
        m.scale.set(d.ar * 1.2, d.hand * 0.5, d.ar * 1.2);
        b[h].add(m);
        return m;
      });
      for (const m of [nape, ...claws]) m.castShadow = true;
      ti.rig.crystals.push(nape, ...claws);
      ti.crystalScale.push(nape.scale.clone(), ...claws.map((m) => m.scale.clone()));
      ti.hardened = true;
      ti.hard = 1;
    },

    decide(ti: T, dh: number, dy: number, fwd: number, legs: boolean) {
      if (!legs || ti.special > 0 || !c.world.inside(ti.pos.x, ti.pos.z)) return false;
      if (dh < 6 || dh > REACH + 4 || dy > ti.height * 1.4 || fwd < 0.6) return false;
      ti.mark = 0;
      c.bite(ti);
      return true;
    },

    bite(ti: T, dt: number, tg: Tg, pl: PlayerView) {
      const H = ti.height, a = ti.at;
      tg.move = 0;
      if (a < WIND) {
        tg.crouch = 0.8;
        tg.lean = 0.35;
        tg.jaw = 1.05;
        tg.roar = 1;
        if (ti.mark === 0) {
          ti.mark = 1;
          c.mouth(ti, _c);
          c.fx.steam(_c, H * 0.12, 0.8);
          sfx("roar", _c, 0.7);
        }
        if (a < LOCK) {
          _a.copy(pl.pos).sub(ti.pos).setY(0);
          const want = Math.atan2(_a.x, _a.z);
          const d = Math.atan2(Math.sin(want - ti.yaw), Math.cos(want - ti.yaw));
          ti.yaw += Math.max(-6 * dt, Math.min(6 * dt, d));
          ti.aim.copy(ti.pos);
          ti.aim2.copy(pl.pos).setY(0);
        }
        ti.speed = 0;
        return;
      }
      if (a < WIND + LUNGE) {
        if (ti.mark === 1) {
          ti.mark = 2;
          _a.copy(ti.aim2).sub(ti.aim).setY(0);
          const len = Math.min(REACH, _a.length() + H * 0.4);
          ti.aim2.copy(ti.aim).addScaledVector(_a.normalize(), len);
          ti.yaw = Math.atan2(_a.x, _a.z);
          c.fx.dust(ti.pos, H * 0.4);
          sfx("titanStep", ti.pos, 1);
        }
        const k = (a - WIND) / LUNGE;
        _b.lerpVectors(ti.aim, ti.aim2, 1 - (1 - k) * (1 - k));
        _a.copy(_b).sub(ti.pos);
        const step = _a.length();
        _c.copy(ti.pos).setY(H * 0.3);
        if (step > 1e-4 && c.world.inside(_b.x, _b.z) && c.world.raycast(_c, _a.divideScalar(step), step + H * 0.15) < 0) ti.pos.copy(_b);
        ti.speed = REACH / LUNGE;
        tg.crouch = 0;
        tg.lean = 0.7;
        tg.lookPitchAdd = -0.3;
        tg.jaw = k < 0.7 ? 1.1 : 0;
        c.mouth(ti, _c);
        if (!ti.hit && pl.alive && Math.hypot(_c.x - pl.pos.x, _c.z - pl.pos.z) < H * 0.25 + 1.5 && pl.pos.y - ti.pos.y < H * 1.1) {
          ti.hit = true;
          if ((pl.sinceDash ?? 9) > 0.3) {
            sfx("bite", _c, 1);
            c.hurt(0.45, _c, 22, 7);
          } else ti.mark = 4;
        }
        return;
      }
      ti.speed = 0;
      const missed = !ti.hit || ti.mark === 4;
      if (ti.mark < 3 || ti.mark === 4) {
        ti.mark = missed ? 3 : 5;
        c.fx.dust(ti.pos, H * 0.6);
        sfx("stomp", ti.pos, 0.8);
        if (missed) {
          c.fx.steam(ti.nape, H * 0.15, STAGGER);
          sfx("steamHiss", ti.nape, 0.9);
        }
      }
      if (ti.mark === 3) {
        tg.crouch = 0.7;
        tg.lean = 0.6;
        tg.jaw = 0.4;
        tg.flail = 0.25;
      }
      if (a > WIND + LUNGE + (ti.mark === 3 ? STAGGER : 0.5)) {
        ti.cool = ti.mark === 3 ? 0.4 : 1;
        ti.special = 1.6 + c.rnd() * 1.6;
        c.walk(ti);
      }
    },

    tick(ti: T, dt: number) {
      const open = (ti.act === "bite" && ti.mark === 3) || kneeling(ti);
      if (!open && !ti.hardened) sfx("harden", ti.nape);
      ti.hardened = !open;
      ti.hard += ((open ? 0 : 1) - ti.hard) * (1 - Math.exp(-6 * dt));
      const cr = ti.rig.crystals[0];
      cr.visible = ti.hard > 0.03;
      cr.scale.copy(ti.crystalScale[0]).multiplyScalar(ti.hard);
    },
  };
}
