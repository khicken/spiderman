import * as THREE from "three";
import { ALLY_HALF, createFlares, createKit, type Pose, type Soldier } from "./allies-model";
import type { Allies, Blade, Fx, GameEvent, SquadLead, SquadOrder, TitanPart, Titans, TitanView, World } from "./contracts";

const MAX = 8;
const BASE = 5;
const NAMES = ["Petra", "Oluo", "Eld", "Gunther", "Nifa", "Moblit", "Thomas", "Mina", "Nac", "Mylius", "Ness", "Siss", "Lynne", "Henning", "Abel", "Keiji"];
const SLOTS: [number, number, number][] = [[-5, 2, -6], [5, 2, -6], [-10, 3, -11], [10, 3, -11], [0, 4, -15], [-14, 3, -3]];
const NEAR = 30;
const CALL_GAP = 8;
const G = 9.8;

type Hook = { on: boolean; p: THREE.Vector3; titan: TitanView | null; part: TitanPart; age: number };
type Ally = {
  name: string;
  s: Soldier;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  mode: "fly" | "held" | "dead";
  grounded: boolean;
  target: TitanView | null;
  part: TitanPart;
  run: number;
  cd: number;
  slash: number;
  hooks: [Hook, Hook];
  hookT: number;
  gasT: number;
  acc: number;
  skip: number;
  phase: number;
  yaw: number;
  heldT: number;
  heldSide: "armL" | "armR";
  heldBy: TitanView | null;
};

export function createAllies(scene: THREE.Scene, world: World, titans: Titans, fx: Fx): Allies {
  const kit = createKit(scene);
  const flares = createFlares(scene);
  const out: GameEvent[] = [];
  const seen = new Set<number>();
  const hook = (): Hook => ({ on: false, p: new THREE.Vector3(), titan: null, part: "nape", age: 0 });
  const squad: Ally[] = Array.from({ length: MAX }, (_, i) => ({
    name: "", s: kit.build(i), pos: new THREE.Vector3(), vel: new THREE.Vector3(), mode: "dead", grounded: false, target: null, part: "nape",
    run: 0, cd: 0, slash: 0, hooks: [hook(), hook()], hookT: 0, gasT: 0, acc: 0, skip: i, phase: (i / MAX) * Math.PI * 2, yaw: 0, heldT: 0, heldSide: "armL", heldBy: null,
  }));
  let order: SquadOrder = "attack";
  let size = BASE;
  let lastWave = 0;
  let callT = 0;
  let spotT = 0;
  let pickT = 0;
  let nameI = 0;
  let time = 0;
  let lead: SquadLead | null = null;
  const blade: Blade = { pos: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 0, charge: 0, radius: 2 };
  const pose: Pose = { anim: "stand", t: 0, k: 0, vel: new THREE.Vector3(), yaw: 0 };
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), goal = new THREE.Vector3(), acc = new THREE.Vector3();
  const down = new THREE.Vector3(0, -1, 0);
  const rnd = (a: number, b: number) => a + (b - a) * Math.random();
  const alive = () => squad.filter((a) => a.mode !== "dead");

  const say = (text: string, who: string, force = false) => {
    if (!force && callT > 0) return;
    callT = CALL_GAP;
    out.push({ type: "radio", who, text });
  };

  const wallPoint = (i: number, o: THREE.Vector3) => {
    const a = Math.atan2(world.spawn.z, world.spawn.x) + (i - 2.5) * 0.012;
    const r = Math.hypot(world.spawn.x, world.spawn.z);
    return o.set(Math.cos(a) * r, world.spawn.y, Math.sin(a) * r);
  };

  const enlist = (a: Ally, at: THREE.Vector3) => {
    a.name = NAMES[nameI++ % NAMES.length];
    a.mode = "fly";
    a.pos.copy(at);
    a.vel.set(0, 0, 0);
    a.target = null;
    a.cd = rnd(2, 5);
    a.run = a.slash = 0;
    a.heldBy = null;
    a.hooks[0].on = a.hooks[1].on = false;
    a.s.root.visible = true;
    a.yaw = Math.atan2(-at.x, -at.z);
  };
  squad.forEach((a, i) => (i < BASE ? enlist(a, wallPoint(i, v1)) : a.s.hide()));

  const reinforce = (wave: number) => {
    flares.fire(wallPoint(-15, v1));
    out.push({ type: "sfx", name: "gasBurst", at: v1.clone(), volume: 0.6 });
    const n = alive().length;
    const add = wave <= 1 ? 0 : Math.min(size + 1 - n, Math.max(1, size - n));
    if (!add) return say("Squad, move out!", "Command", true);
    let k = 0;
    for (const a of squad) if (a.mode === "dead" && k < add) enlist(a, wallPoint(k++, v2));
    say(`${add} soldier${add > 1 ? "s" : ""} inbound from the wall!`, "Command", true);
  };

  const clock = (p: THREE.Vector3, yaw: number) => {
    let b = Math.atan2(p.x - lead!.pos.x, p.z - lead!.pos.z) - yaw;
    b = Math.atan2(Math.sin(b), Math.cos(b));
    const h = Math.round((-b / (Math.PI * 2)) * 12 + 12) % 12;
    return h === 0 ? 12 : h;
  };

  const pick = () => {
    const near: TitanView[] = [];
    for (const ti of titans.list()) if (ti.alive && ti.pos.distanceTo(lead!.pos) < 90) near.push(ti);
    near.sort((a, b) => a.pos.distanceToSquared(lead!.pos) - b.pos.distanceToSquared(lead!.pos));
    const locked = lead!.lock?.titan.alive ? lead!.lock.titan : null;
    const counts = new Map<number, number>();
    let i = 0;
    for (const a of squad) {
      if (a.mode !== "fly") continue;
      const t = order === "regroup" || !near.length ? null : locked ?? near[i++ % Math.min(2, near.length)];
      if (t !== a.target) {
        a.target = t;
        a.run = 0;
      }
      if (!t) continue;
      const k = counts.get(t.id) ?? 0;
      counts.set(t.id, k + 1);
      const legs = t.kind === "female" || (k !== 0 && k !== 2);
      if (legs) {
        const leg: TitanPart = k % 4 === 3 ? "legR" : "legL";
        const alt: TitanPart = leg === "legL" ? "legR" : "legL";
        a.part = titans.partPos(t, leg, v1) ? leg : titans.partPos(t, alt, v1) ? alt : t.kind === "female" ? "armL" : "nape";
        if (a.part.startsWith("leg") && a.run === 0 && Math.random() < 0.08) say("I've got the legs!", a.name);
      } else a.part = "nape";
    }
  };

  const filter = (events: readonly GameEvent[], at: THREE.Vector3) => {
    const near = lead!.pos.distanceTo(at) < NEAR;
    for (const e of events) {
      if (e.type === "sfx") out.push(e);
      else if (near && (e.type === "hitstop" || e.type === "shake" || e.type === "impact")) out.push(e);
    }
  };

  const strike = (a: Ally, t: TitanView) => {
    const nape = a.part === "nape";
    blade.pos.copy(a.pos);
    blade.dir.copy(a.vel).normalize();
    blade.speed = nape ? 13 : 22;
    blade.charge = nape ? 0.3 : 0.5;
    const r = titans.strike(blade, { titan: t, part: a.part });
    filter(r.events, a.pos);
    if (lead!.pos.distanceTo(a.pos) < 120) {
      v1.set(-blade.dir.z, 0, blade.dir.x).normalize();
      v2.copy(a.pos).addScaledVector(v1, -1.6).y -= 0.6;
      v3.copy(a.pos).addScaledVector(v1, 1.6).y += 0.6;
      fx.slash(v2, goal.copy(a.pos).addScaledVector(blade.dir, 1.4), v3);
    }
    if (r.killed) {
      say(Math.random() < 0.5 ? "Got one!" : "Nape cut, it's down!", a.name);
      for (const b of squad) if (b.target === t) b.target = null;
    } else if (!nape && !titans.partPos(t, a.part, v1)) say("Hamstrung it! Go for the nape!", a.name);
    a.vel.y += 9;
    a.vel.addScaledVector(blade.dir, -4);
  };

  const rehook = (a: Ally, dist: number) => {
    const t = a.target;
    for (let w = 0; w < 2; w++) {
      const h = a.hooks[w];
      h.age = 0;
      if (t && t.alive && a.pos.distanceTo(t.pos) < t.height + 40 && titans.partPos(t, w ? a.part : "nape", h.p)) {
        h.on = true;
        h.titan = t;
        h.part = w ? a.part : "nape";
        continue;
      }
      h.titan = null;
      v1.copy(goal).sub(a.pos);
      v1.y = 0;
      v1.normalize().multiplyScalar(dist > 4 ? 1 : 0.2);
      const sx = w ? 0.45 : -0.45, x = v1.x;
      v1.x += sx * v1.z;
      v1.z -= sx * x;
      v1.y = 0.9;
      v1.normalize();
      const d = world.raycast(a.pos, v1, 70);
      h.on = d > 2;
      if (h.on) h.p.copy(a.pos).addScaledVector(v1, d);
    }
  };

  const grab = (a: Ally, t: TitanView) => {
    if (t.kind === "crawler" || squad.some((b) => b.heldBy === t)) return;
    for (const side of ["armL", "armR"] as const) {
      if (!titans.partPos(t, side, v1) || v1.distanceTo(a.pos) > t.height * 0.12 + 2.5) continue;
      a.mode = "held";
      a.heldBy = t;
      a.heldSide = side;
      a.heldT = 0;
      a.run = 0;
      a.hooks[0].on = a.hooks[1].on = false;
      out.push({ type: "sfx", name: "grabbed", at: a.pos.clone() });
      say("It's got me! Cut that arm!", a.name, true);
      return;
    }
  };

  const held = (a: Ally, dt: number) => {
    const t = a.heldBy!;
    a.heldT += dt;
    if (!t.alive || !titans.partPos(t, a.heldSide, v1)) {
      a.mode = "fly";
      a.heldBy = null;
      a.vel.set(0, 6, 0);
      a.cd = 3;
      out.push({ type: "feat", name: "save", kind: t.kind });
      return say("Thanks for the save!", a.name, true);
    }
    const H = t.height;
    v2.set(t.pos.x + Math.sin(t.yaw) * H * 0.1, t.pos.y + H * 0.84, t.pos.z + Math.cos(t.yaw) * H * 0.1);
    v1.lerp(v3.set(t.pos.x + Math.sin(t.yaw) * H * 0.18, t.pos.y + H * 0.6, t.pos.z + Math.cos(t.yaw) * H * 0.18), 0.6);
    a.pos.copy(v1).lerp(v2, THREE.MathUtils.smoothstep(a.heldT, 2.2, 3.2));
    a.vel.set(0, 0, 0);
    if (a.heldT < 3.3) return;
    a.mode = "dead";
    a.heldBy = null;
    a.target = null;
    a.s.hide();
    fx.blood(a.pos, v1.set(Math.sin(t.yaw), 0.4, Math.cos(t.yaw)), 1.4);
    out.push({ type: "sfx", name: "hurt", at: a.pos.clone() }, { type: "sfx", name: "bite", at: a.pos.clone() });
    if (lead!.pos.distanceTo(a.pos) < NEAR * 2) out.push({ type: "shake", strength: 0.25 });
    callT = CALL_GAP;
    out.push({ type: "toast", title: "Squad member lost", text: `${a.name} was eaten` });
  };

  const step = (a: Ally, dt: number, i: number, yaw: number, near: boolean) => {
    const L = lead!;
    const t = a.target && a.target.alive ? a.target : null;
    let speed = 26;
    let perch = false;
    a.cd -= dt;
    a.slash = Math.max(0, a.slash - dt);
    if (t && titans.partPos(t, a.part, v3)) {
      if (a.run > 0) {
        a.run -= dt;
        goal.copy(v3);
        if (a.part === "nape") goal.y += 0.6;
        speed = 34;
        if (a.pos.distanceTo(goal) < 2.8) {
          a.run = 0;
          a.slash = 0.45;
          a.cd = rnd(6, 9);
          if (Math.random() < 0.7) strike(a, t);
          else a.vel.y += 8;
        } else if (Math.random() < dt * (t.kind === "female" ? 0.5 : 0.25)) grab(a, t);
      } else {
        const ang = a.phase + time * 0.45;
        const r = t.height * 0.55 + 7;
        goal.set(t.pos.x + Math.cos(ang) * r, a.part === "nape" ? v3.y + 3 : Math.max(v3.y + 2, t.pos.y + 3), t.pos.z + Math.sin(ang) * r);
        if (a.cd <= 0 && a.pos.distanceTo(goal) < 14) a.run = 2;
      }
    } else {
      const fast = L.vel.lengthSq() > 16;
      const hy = fast ? Math.atan2(L.vel.x, L.vel.z) : yaw;
      const [sx, sy, sz] = SLOTS[i];
      goal.set(sx, sy, sz).applyAxisAngle(THREE.Object3D.DEFAULT_UP, hy).add(L.pos);
      if (!fast) {
        v1.set(goal.x, goal.y + 25, goal.z);
        const d = world.raycast(v1, down, 80);
        if (d > 0) goal.y = v1.y - d + ALLY_HALF;
        perch = true;
      }
    }

    v1.copy(goal).sub(a.pos);
    const dist = v1.length();
    const resting = perch && dist < 2 && a.grounded;
    a.hookT -= dt;
    if (resting || a.mode !== "fly") a.hooks[0].on = a.hooks[1].on = false;
    else if (a.hookT <= 0) {
      a.hookT = rnd(0.9, 1.6);
      if (dist > 3) rehook(a, dist);
    }
    for (const h of a.hooks) {
      if (!h.on) continue;
      h.age += dt;
      if (h.titan && !titans.partPos(h.titan, h.part, h.p)) h.on = false;
    }

    acc.set(0, 0, 0);
    if (!resting) {
      v1.normalize().multiplyScalar(Math.min(speed, dist * 1.8));
      acc.copy(v1).sub(a.vel).multiplyScalar(4);
      if (acc.length() > 38) acc.setLength(38);
      for (const h of a.hooks) if (h.on) acc.add(v2.copy(h.p).sub(a.pos).setLength(3));
      acc.y += G * (perch && dist < 4 ? 0.6 : 0.92);
    }
    a.vel.addScaledVector(acc, dt);
    a.vel.y -= G * dt;
    a.vel.multiplyScalar(1 - Math.min(0.5, (resting ? 8 : 0.3) * dt));
    a.pos.addScaledVector(a.vel, dt);
    a.grounded = world.collide(a.pos, a.vel, 0.35, ALLY_HALF * 2).grounded;
    titans.pushOut(a.pos, 0.4, a.vel);

    a.gasT -= dt;
    if (near && !resting && a.gasT <= 0 && acc.lengthSq() > 120) {
      a.gasT = a.run > 0 ? 0.08 : 0.2;
      fx.gas(v2.copy(a.pos).addScaledVector(acc, -0.01), v3.copy(acc).normalize().negate(), a.run > 0 ? 0.5 : 0.25);
    }
  };

  const draw = (a: Ally) => {
    const hs = Math.hypot(a.vel.x, a.vel.z);
    if (a.mode === "held" && a.heldBy) a.yaw = a.heldBy.yaw + Math.PI;
    else if (hs > 1.5) a.yaw = Math.atan2(a.vel.x, a.vel.z);
    else if (a.target) a.yaw = Math.atan2(a.target.pos.x - a.pos.x, a.target.pos.z - a.pos.z);
    pose.t = time + a.phase;
    pose.yaw = a.yaw;
    pose.vel.copy(a.vel);
    pose.k = 1 - a.slash / 0.45;
    pose.anim = a.mode === "held" ? "held" : a.slash > 0 ? "slash" : a.grounded ? (hs > 1.5 ? "run" : "stand") : "air";
    a.s.root.position.copy(a.pos);
    a.s.pose(pose);
    v1.copy(a.pos).y -= 0.05;
    a.s.drawWires([a.hooks[0].on, a.hooks[1].on], [a.hooks[0].p, a.hooks[1].p], v1, time);
  };
  squad.forEach((a) => a.mode !== "dead" && draw(a));

  const command = (o: SquadOrder) => {
    order = o;
    for (const a of squad) a.run = 0;
    pickT = 0;
    const ev: GameEvent[] = [{ type: "radio", who: "You", text: o === "attack" ? "Attack my target!" : "Regroup on me!" }];
    return ev;
  };

  const api: Allies & { readonly members: readonly Ally[] } = {
    members: squad,
    update(dt, _t, l, yaw) {
      out.length = 0;
      lead = l;
      if (dt <= 0) return out;
      time += dt;
      callT -= dt;
      flares.update(dt);
      if (titans.wave !== lastWave) {
        lastWave = titans.wave;
        if (lastWave > 0) reinforce(lastWave);
      }
      spotT -= dt;
      if (spotT <= 0) {
        spotT = 1;
        for (const ti of titans.list()) {
          if (!ti.alive || seen.has(ti.id) || ti.pos.distanceTo(l.pos) > 90) continue;
          seen.add(ti.id);
          if (alive().length) say(`Titan at ${clock(ti.pos, yaw)} o'clock, ${ti.height.toFixed(0)} m class!`, alive()[0].name);
          break;
        }
      }
      pickT -= dt;
      if (pickT <= 0) {
        pickT = 0.5;
        pick();
      }
      squad.forEach((a, i) => {
        if (a.mode === "dead") return;
        a.acc += dt;
        const far = a.pos.distanceTo(l.pos) > 120;
        if (far && ++a.skip % 3) return;
        const step_dt = Math.min(0.1, a.acc);
        a.acc = 0;
        if (a.mode === "held") held(a, step_dt);
        else step(a, step_dt, i, yaw, !far && a.pos.distanceTo(l.pos) < 90);
        if (a.s.root.visible) draw(a);
      });
      return out;
    },
    order: command,
    toggle: () => command(order === "attack" ? "regroup" : "attack"),
    grow() {
      out.length = 0;
      size = Math.min(MAX - 1, size + 1);
      const a = squad.find((b) => b.mode === "dead");
      if (a) enlist(a, wallPoint(0, v2));
      say("Another soldier joins your squad!", "Command", true);
      return out.slice();
    },
    hud() {
      return { alive: alive().length, max: size + 1, order };
    },
    dispose() {
      kit.dispose();
      flares.dispose();
    },
  };
  return api;
}
