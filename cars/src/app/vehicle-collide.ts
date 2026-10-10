import * as THREE from "three";
import type { CarSpec, GameEvent, GroundHit, Track, Vehicle, VehicleState } from "./contracts";

type V3 = THREE.Vector3;
export interface Body {
  readonly car: number;
  readonly mass: number;
  readonly halfL: number;
  readonly halfW: number;
  readonly height: number;
  basis(): readonly [V3, V3, V3]; // left, up, forward in world space
  impulse(at: V3, j: V3): void;
  invMass(at: V3, n: V3): number;
  pointVel(at: V3, out: V3): V3;
}
type Car = Vehicle & Body;

const _p = new THREE.Vector3();
const _p0 = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v0 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _j = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _az = new THREE.Vector3();
const _bx = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _d = new THREE.Vector3();
const AXES = [_ax, _az, _bx, _bz];

const corner = { slide: 0, at: new THREE.Vector3() };
// Box corners against the ground plane under the car: roof and floor contact for rollovers, jumps and bottoming out.
export function bodyCorners(b: Body, s: VehicleState, g: GroundHit, spec: CarSpec) {
  const [x, y, z] = b.basis();
  const n = g.normal;
  corner.slide = 0;
  const lo = spec.body.rideH - spec.cgH;
  const hi = spec.body.height - spec.cgH;
  for (let k = 0; k < 8; k++) {
    const cx = k & 1 ? b.halfW : -b.halfW;
    const cy = k & 2 ? hi : lo;
    const cz = k & 4 ? b.halfL * 0.92 : -b.halfL * 0.92;
    _p.copy(s.pos).addScaledVector(x, cx).addScaledVector(y, cy).addScaledVector(z, cz);
    const dist = n.x * (_p.x - s.pos.x) + n.y * (_p.y - g.y) + n.z * (_p.z - s.pos.z);
    if (dist >= 0) continue;
    s.pos.addScaledVector(n, -dist * 0.5);
    b.pointVel(_p, _v);
    const vn = _v.dot(n);
    if (vn >= 0) continue;
    const jn = (-1.15 * vn) / b.invMass(_p, n);
    b.impulse(_p, _j.copy(n).multiplyScalar(jn));
    _t.copy(_v).addScaledVector(n, -vn);
    const vt = _t.length();
    if (vt > 0.01) {
      _t.multiplyScalar(-1 / vt);
      // Scrape friction acts on the centerline: a floor corner grounding at speed must not yaw the car round.
      _v0.copy(_p).addScaledVector(x, -cx);
      const jt = Math.min((cy > 0 ? 0.6 : 0.3) * jn, vt / b.invMass(_v0, _t));
      b.impulse(_v0, _j.copy(_t).multiplyScalar(jt));
      if (vt > corner.slide) {
        corner.slide = vt;
        corner.at.copy(_p);
      }
    }
  }
  return corner;
}

const wall = { speed: 0, slide: 0, contact: false, at: new THREE.Vector3() };
// Three circles along the body against the track barriers. The barrier moves a point; we turn that into a rigid body impulse.
export function hitBarriers(b: Body, s: VehicleState, track: Track, hint: number) {
  const [, , z] = b.basis();
  wall.speed = wall.slide = 0;
  wall.contact = false;
  const r = b.halfW;
  const reach = b.halfL - r * 0.9;
  for (let k = -1; k <= 1; k++) {
    _p0.copy(s.pos).addScaledVector(z, k * reach);
    _p.copy(_p0);
    b.pointVel(_p0, _v0);
    _v.copy(_v0);
    const hit = track.barrier(_p, _v, r, hint);
    _d.subVectors(_p, _p0);
    const push = _d.length();
    if (push < 1e-5 && hit <= 0) continue;
    wall.contact = true;
    s.pos.add(_d);
    _j.subVectors(_v, _v0);
    const dv = _j.length();
    if (dv > 1e-4) {
      // Applied halfway to the center: a point impulse at the bumper spins the car like a pinball.
      _az.lerpVectors(s.pos, _p0, 1);
      _n.copy(_j).multiplyScalar(1 / dv);
      _j.copy(_n).multiplyScalar(dv / b.invMass(_az, _n));
      b.impulse(_az, _j);
    }
    if (hit > wall.speed) {
      wall.speed = hit;
      wall.at.copy(_p0);
    }
    if (push > 1e-5) {
      _n.copy(_d).multiplyScalar(1 / push);
      const tang = _t.copy(_v0).addScaledVector(_n, -_v0.dot(_n)).length();
      if (tang > wall.slide) {
        wall.slide = tang;
        if (hit <= wall.speed) wall.at.copy(_p0).addScaledVector(_n, -r);
      }
    }
  }
  return wall;
}

function flat(src: V3, out: V3) {
  out.set(src.x, 0, src.z);
  const l = out.length();
  return l > 1e-6 ? out.multiplyScalar(1 / l) : out.set(1, 0, 0);
}

// Oriented box against box on the ground plane (2D SAT) with a height check. Impulse with restitution and friction.
export function collideCars(cars: Vehicle[]): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < cars.length; i++) {
    const A = cars[i] as Car;
    for (let k = i + 1; k < cars.length; k++) {
      const B = cars[k] as Car;
      const pa = A.state.pos;
      const pb = B.state.pos;
      _d.subVectors(pb, pa);
      if (Math.abs(_d.y) > 1.6) continue;
      const reach = Math.hypot(A.halfL, A.halfW) + Math.hypot(B.halfL, B.halfW);
      if (_d.x * _d.x + _d.z * _d.z > reach * reach) continue;
      const [ax, , az] = A.basis();
      flat(ax, _ax);
      flat(az, _az);
      const [bx, , bz] = B.basis();
      flat(bx, _bx);
      flat(bz, _bz);
      _d.y = 0;
      let best = Infinity;
      let ra = 0;
      for (const u of AXES) {
        const ea = A.halfL * Math.abs(_az.dot(u)) + A.halfW * Math.abs(_ax.dot(u));
        const eb = B.halfL * Math.abs(_bz.dot(u)) + B.halfW * Math.abs(_bx.dot(u));
        const dd = _d.dot(u);
        const o = ea + eb - Math.abs(dd);
        if (o <= 0) {
          best = -1;
          break;
        }
        if (o < best) {
          best = o;
          ra = ea;
          _n.copy(u).multiplyScalar(dd < 0 ? -1 : 1);
        }
      }
      if (best <= 0) continue;
      // Contact at the middle of the overlap, on the tangent axis too.
      _t.set(-_n.z, 0, _n.x);
      const ta = pa.x * _t.x + pa.z * _t.z;
      const tb = pb.x * _t.x + pb.z * _t.z;
      const ea = A.halfL * Math.abs(_az.dot(_t)) + A.halfW * Math.abs(_ax.dot(_t));
      const eb = B.halfL * Math.abs(_bz.dot(_t)) + B.halfW * Math.abs(_bx.dot(_t));
      const mid = (Math.max(ta - ea, tb - eb) + Math.min(ta + ea, tb + eb)) / 2;
      const along = ra - best / 2;
      _p.set(pa.x + _n.x * along, (pa.y + pb.y) / 2, pa.z + _n.z * along);
      const off = mid - (_p.x * _t.x + _p.z * _t.z);
      _p.addScaledVector(_t, off);
      const ma = A.mass;
      const mb = B.mass;
      pa.addScaledVector(_n, (-best * 0.8 * mb) / (ma + mb));
      pb.addScaledVector(_n, (best * 0.8 * ma) / (ma + mb));
      B.pointVel(_p, _v);
      A.pointVel(_p, _v0);
      _v.sub(_v0);
      const vn = _v.dot(_n);
      if (vn >= 0) continue;
      const jn = (-1.25 * vn) / (A.invMass(_p, _n) + B.invMass(_p, _n));
      _j.copy(_n).multiplyScalar(jn);
      B.impulse(_p, _j);
      A.impulse(_p, _j.negate());
      _t.copy(_v).addScaledVector(_n, -vn);
      const vt = _t.length();
      if (vt > 0.01) {
        _t.multiplyScalar(1 / vt);
        const jt = Math.min(0.35 * jn, vt / (A.invMass(_p, _t) + B.invMass(_p, _t)));
        _j.copy(_t).multiplyScalar(jt);
        A.impulse(_p, _j);
        B.impulse(_p, _j.negate());
      }
      if (-vn > 1.5) {
        out.push({ type: "impact", at: _p.clone(), speed: -vn, car: A.car });
        out.push({ type: "impact", at: _p.clone(), speed: -vn, car: B.car });
      }
    }
  }
  return out;
}
