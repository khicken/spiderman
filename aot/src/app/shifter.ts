import * as THREE from "three";
import type { Blade, CameraRig, Fx, GameEvent, Input, Player, PlayerView, ShiftHud, Titans, TitanView, World } from "./contracts";
import { newPose, pose } from "./titan-anim";
import { BN, buildVariant, makeRig, type Rig, type Variant } from "./titan-model";

const H = 15;
const KILLS = 5;
const TIME = 25;
const WALK = 10;
const PUNCH = 0.75;
const HIT_AT = 0.32;
const GROW = 0.6;
const FADE = 3;

const ease = (x: number, to: number, k: number, dt: number) => x + (to - x) * (1 - Math.exp(-k * dt));

export function createShifter(scene: THREE.Scene, world: World, titans: Titans, fx: Fx) {
  let meter = 0;
  let active = false;
  let hp = 1;
  let lastKills = 0;
  let yaw = 0;
  let punchT = -1;
  let side = 0;
  let hit = false;
  let growT = 0;
  let fadeT = 0;
  let v: Variant | null = null;
  let rig: Rig | null = null;
  const p = newPose(0.37);
  const pos = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const cam = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const center = new THREE.Vector3();
  const view: PlayerView = { pos: new THREE.Vector3(), vel, alive: true, grounded: true };
  const blade: Blade = { pos: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 60, charge: 0.9, radius: 2 };
  const out: GameEvent[] = [];

  const body = () => {
    if (!rig) {
      v = buildVariant({ body: "muscular", face: "grin", hair: "long", hairColor: 0x2a1d14, skin: 0xd99a7e, seed: 77 });
      rig = makeRig(v, new THREE.Color(1, 0.94, 0.9));
      scene.add(rig.group);
    }
    return rig;
  };

  const place = (dt: number) => {
    const r = rig!;
    r.group.position.copy(pos);
    r.group.rotation.y = yaw;
    r.group.scale.setScalar(H * (growT < GROW ? 0.3 + 0.7 * THREE.MathUtils.smootherstep(growT, 0, GROW) : 1));
    p.t += dt;
    pose(r, v!.d, p, 0);
  };

  const nape = (o: THREE.Vector3) => o.set(0, v!.d.nl * 0.6, -v!.d.nr * 1.6).applyMatrix4(rig!.bones[BN.neck].matrixWorld);

  const punch = () => {
    rig!.bones[side ? BN.handR : BN.handL].getWorldPosition(v1);
    let best: TitanView | null = null;
    let bestD = Infinity;
    for (const ti of titans.list()) {
      if (!ti.alive) continue;
      center.set(ti.pos.x, ti.pos.y + ti.height * 0.75, ti.pos.z);
      const d = center.distanceTo(v1) - ti.height * 0.35;
      if (d < H * 0.25 && d < bestD) {
        bestD = d;
        best = ti;
      }
    }
    out.push({ type: "shake", strength: 0.5 }, { type: "sfx", name: "swat", at: v1.clone() });
    fx.dust(v1, 3);
    if (!best || !titans.partPos(best, "nape", blade.pos)) return;
    blade.dir.copy(fwd);
    const r = titans.strike(blade, { titan: best, part: "nape" });
    out.push(...r.events, { type: "sfx", name: "stomp", at: v1.clone() }, { type: "hitstop", duration: 0.08 });
  };

  const exit = (player: Player, cameraRig: CameraRig) => {
    active = false;
    meter = 0;
    fadeT = FADE;
    nape(player.pos);
    player.vel.set(-Math.sin(yaw) * 6, 12, -Math.cos(yaw) * 6);
    cameraRig.cinematic(null);
    fx.steam(player.pos, 2, 1);
    fx.steamFollow(() => (fadeT > 0 ? center.copy(pos).setY(H * 0.3) : null), H * 0.2, FADE);
    out.push(
      { type: "sfx", name: "steamHiss" }, { type: "sfx", name: "escape" }, { type: "shake", strength: 0.6 },
      { type: "callout", text: hp <= 0 ? "Body broken. Back to ODM gear" : "Power spent. Back to ODM gear" },
    );
  };

  return {
    view,
    get active() {
      return active;
    },
    start(player: Player, camYaw: number): GameEvent[] {
      if (active || fadeT > 0) return [];
      if (meter < 1) return [{ type: "callout", text: `Titan power ${Math.round(meter * 100)}%. Kill titans to fill it` }];
      if (!player.alive || player.mode === "held") return [];
      body().group.visible = true;
      active = true;
      hp = 1;
      growT = 0;
      punchT = -1;
      yaw = camYaw;
      pos.set(player.pos.x, 0, player.pos.z);
      vel.set(0, 0, 0);
      Object.assign(p, newPose(0.37));
      fx.steam(v1.copy(pos).setY(H * 0.2), H * 0.3, 1.5);
      fx.dust(pos, H * 0.8);
      return [
        { type: "sfx", name: "lightning" }, { type: "sfx", name: "roar", volume: 1 }, { type: "impact", kind: "kill" }, { type: "shake", strength: 1.2 },
        { type: "banner", jp: "巨人化", en: "Titan shift", text: "Move to walk, E to punch" },
      ];
    },
    damage(amount: number): GameEvent[] {
      hp -= amount * 0.4;
      return [{ type: "sfx", name: "titanHurt", at: view.pos.clone() }];
    },
    update(dt: number, input: Input, player: Player, cameraRig: CameraRig): GameEvent[] {
      out.length = 0;
      if (dt <= 0) return out;
      if (!active) {
        if (titans.kills > lastKills && meter < 1) {
          meter = Math.min(1, meter + (titans.kills - lastKills) / KILLS);
          if (meter >= 1) out.push({ type: "toast", title: "Titan power ready", text: "Press T to bite your hand" }, { type: "sfx", name: "lightning", volume: 0.4 });
        }
        lastKills = titans.kills;
        if (fadeT > 0 && rig) {
          fadeT -= dt;
          p.kneel = ease(p.kneel, 1, 2, dt);
          p.lean = ease(p.lean, 0.6, 2, dt);
          p.walk = ease(p.walk, 0, 4, dt);
          p.ikW[0] = p.ikW[1] = 0;
          pos.y = -H * 0.5 * Math.max(0, 1 - fadeT / FADE - 0.4);
          place(dt);
          if (fadeT <= 0) rig.group.visible = false;
        }
        return out;
      }
      lastKills = titans.kills;
      growT += dt;
      meter -= dt / TIME;

      const slow = punchT >= 0 ? 0.3 : 1;
      vel.x = ease(vel.x, input.wish.x * WALK * slow, 4, dt);
      vel.z = ease(vel.z, input.wish.z * WALK * slow, 4, dt);
      pos.addScaledVector(vel, dt);
      world.pushTitan(pos, H * 0.13, H * 0.55);
      pos.y = 0;
      const want = input.wish.lengthSq() > 0.01 && punchT < 0 ? Math.atan2(input.wish.x, input.wish.z) : punchT >= 0 ? cameraRig.yaw : yaw;
      yaw += Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw)) * (1 - Math.exp(-6 * dt));
      fwd.set(Math.sin(yaw), 0, Math.cos(yaw));

      const sp = Math.hypot(vel.x, vel.z);
      p.walk = ease(p.walk, Math.min(1, sp / WALK), 5, dt);
      p.phase += (sp * dt * Math.PI * 2) / (1.7 * v!.d.hipY * H);
      p.jaw = ease(p.jaw, punchT >= 0 || growT < 1.2 ? 0.5 : 0.05, 8, dt);
      p.roar = ease(p.roar, growT < 1.2 ? 1 : 0, 6, dt);

      if (input.pressed.has("attack") && punchT < 0 && growT > GROW) {
        punchT = 0;
        hit = false;
        side = 1 - side;
        out.push({ type: "sfx", name: "roar", volume: 0.4 });
      }
      for (let i = 0; i < 2; i++) p.ikW[i] = ease(p.ikW[i], 0, 6, dt);
      p.twist = ease(p.twist, 0, 6, dt);
      if (punchT >= 0) {
        punchT += dt;
        const s = side ? -1 : 1;
        const wind = punchT < HIT_AT * 0.6;
        aim.copy(pos).addScaledVector(fwd, H * (wind ? -0.1 : 0.6)).add(v1.set(fwd.z * s, 0, -fwd.x * s).multiplyScalar(H * (wind ? 0.25 : 0.05)));
        aim.y = H * (wind ? 0.75 : 0.7);
        p.ik[side].copy(aim);
        p.ikW[side] = 1;
        p.curl[side] = 1;
        p.twist = ease(p.twist, wind ? -s * 0.5 : s * 0.6, 14, dt);
        if (!hit && punchT >= HIT_AT) {
          hit = true;
          place(0);
          punch();
        }
        if (punchT >= PUNCH) punchT = -1;
      }
      place(dt);

      if (titans.held()) out.push(...titans.struggle());
      view.pos.set(pos.x, H * 0.6, pos.z);
      nape(player.pos);
      player.vel.set(0, 0, 0);

      const cy = cameraRig.yaw, cp = cameraRig.pitch;
      aim.set(pos.x, H * 0.92, pos.z);
      v1.set(Math.sin(cy) * Math.cos(cp), Math.sin(cp), Math.cos(cy) * Math.cos(cp));
      cam.copy(aim).addScaledVector(v1, -H * 1.5);
      cam.y = Math.max(2, cam.y + 3);
      v1.copy(cam).sub(aim);
      const len = v1.length();
      const d = world.raycast(aim, v1.divideScalar(len), len);
      if (d >= 0) {
        cam.copy(aim).addScaledVector(v1, Math.max(2, d - 1));
        cam.y += (len - d) * 0.6;
      }
      v1.set(Math.sin(cy), Math.sin(cp), Math.cos(cy)).multiplyScalar(20).add(aim);
      cameraRig.cinematic(cam, v1, 72);

      if (meter <= 0 || hp <= 0) exit(player, cameraRig);
      return out;
    },
    hud(): ShiftHud {
      return { meter: Math.max(0, meter), active, hp: Math.max(0, hp) };
    },
    dispose() {
      if (!rig || !v) return;
      scene.remove(rig.group);
      rig.mat.dispose();
      rig.mesh.skeleton.dispose();
      v.geo.dispose();
      for (const g of Object.values(v.limbs)) g.dispose();
    },
  };
}
