import * as THREE from "three";
import type { CarModel, Controls, Entrant, GroundHit, Track, TrackFrame, VehicleSnap } from "./contracts";
import type { CarFrame } from "./net-wire";
import type { VehicleBody } from "./vehicle";

export type NetRacer = { e: Entrant; v: VehicleBody; m: CarModel; c: Controls; remote: boolean };

const TAU = Math.PI * 2;
const right = new THREE.Vector3();
const local = new THREE.Vector3();

const hit: GroundHit = { y: 0, normal: new THREE.Vector3(0, 1, 0), surface: "asphalt", grip: 1, s: 0, lateral: 0, onRoad: true, tunnel: false };
const tf: TrackFrame = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3(), width: 0, runoff: 0 };

export function hideRemote(r: NetRacer) {
  if (!r.m.group.visible) return;
  r.m.group.visible = false;
  r.v.state.pos.y -= 1000;
  r.v.state.vel.set(0, 0, 0);
}

// Remote cars are not simulated: the pose comes from the wire, the rest is derived so they look and sound driven.
// own: this car's snap with the sampled pose written over it. lead: ms the pose lags real time.
export function applyRemote(r: NetRacer, own: VehicleSnap, f: CarFrame, track: Track, dt: number, lead: number) {
  const g = track.ground(own[0], own[1], own[2], own[19], hit);
  own[19] = g.s;
  r.v.load(own);
  r.m.group.visible = true;
  animate(r.v, f, g, dt);
  // race progress uses the present, not the drawn past, so both screens agree on who leads
  track.frame(g.s, tf);
  r.v.state.s = track.wrap(g.s + r.v.state.vel.dot(tf.fwd) * lead / 1000);
}

function animate(v: VehicleBody, f: CarFrame, g: GroundHit, dt: number) {
  const st = v.state;
  const sp = v.spec;
  const c = f.controls;
  const e = f.engine;
  const R = sp.body.wheelR;
  st.rpm = e.rpm > 0 ? e.rpm : sp.engine.idle;
  st.gear = e.gear;
  st.limiter = e.limiter;
  st.shifting = e.shifting;
  st.throttle = c.throttle;
  st.brake = c.brake;
  st.boost += ((sp.engine.aspiration === "na" || sp.engine.aspiration === "electric" ? 0 : c.throttle * Math.min(1, st.rpm / sp.engine.redline)) - st.boost) * Math.min(1, dt * 4);
  st.s = g.s;
  st.lateral = g.lateral;
  st.onRoad = g.onRoad;
  st.tunnel = g.tunnel;
  const air = st.pos.y - sp.cgH - g.y > 0.45;
  st.airborne = air;

  right.set(1, 0, 0).applyQuaternion(st.quat);
  const slide = Math.abs(st.vel.dot(right));
  const speed = Math.abs(st.speed);
  const lock = c.handbrake > 0.5 && speed > 3;
  const rearSkid = Math.min(1, Math.max(0, (slide - 1.5) / 4) + (lock ? 0.6 : 0));
  const frontSkid = Math.min(1, Math.max(0, (slide - 2.5) / 5) + (c.brake > 0.9 && speed > 20 ? 0.2 : 0));
  const a = sp.body.wheelbase * (1 - sp.frontW);
  const rr = sp.body.wheelbase * sp.frontW;
  const k = Math.min(1, dt * 12);
  for (let i = 0; i < 4; i++) {
    const w = st.wheels[i];
    const front = i < 2;
    const omega = !front && lock ? 0 : st.speed / R;
    w.omega = omega;
    w.spin = (w.spin + omega * dt) % TAU;
    w.steer += ((front ? c.steer * sp.steerLock : 0) - w.steer) * k;
    w.contact = !air;
    w.compress += ((air ? 0 : 0.45) - w.compress) * k;
    w.skid = air ? 0 : front ? frontSkid : rearSkid;
    w.surface = g.surface;
    const tr = front ? sp.body.trackF : sp.body.trackR;
    local.set(i % 2 === 0 ? tr / 2 : -tr / 2, -sp.cgH, front ? a : -rr).applyQuaternion(st.quat);
    w.pos.copy(st.pos).add(local);
  }
}
