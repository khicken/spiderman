import * as THREE from "three";
import type { FrameCtx, Look, World } from "./contracts";

export type BreakKind = "pot" | "crate";
export interface Breakable {
  id: string;
  kind: BreakKind;
  x: number; y: number; z: number;
  r: number; // hit radius
  h: number; // height
  alive: boolean;
  seed: number;
}

const BRK_CAP = 96;
const DEBRIS_CAP = 64;
const DROP_CAP = 64;
const DROP_MAGNET = 3.4, DROP_TAKE = 0.85, DROP_LIFE = 70;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

let rngS = 12345;
const rnd = () => { rngS = (rngS * 1664525 + 1013904223) >>> 0; return rngS / 4294967296; };

function potGeometry(): THREE.BufferGeometry {
  const pts = [[0, 0], [0.26, 0], [0.38, 0.2], [0.4, 0.38], [0.3, 0.58], [0.2, 0.66], [0.25, 0.72], [0.0, 0.72]].map((a) => new THREE.Vector2(a[0], a[1]));
  return new THREE.LatheGeometry(pts, 10);
}


export function createBreakables(scene: THREE.Scene, world: World, look: Look) {
  const list: Breakable[] = [];
  const potGeo = potGeometry();
  const crateGeo = new THREE.BoxGeometry(0.76, 0.76, 0.76).translate(0, 0.38, 0);
  const potMat = look.patch(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  const crateMat = look.patch(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  const pots = new THREE.InstancedMesh(potGeo, potMat, BRK_CAP);
  const crates = new THREE.InstancedMesh(crateGeo, crateMat, BRK_CAP);
  for (const m of [pots, crates]) { m.count = 0; m.frustumCulled = false; m.setColorAt(0, _c.set(0xffffff)); scene.add(m); }

  const debGeo = new THREE.BoxGeometry(1, 1, 1);
  const debMat = look.patch(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  const deb = new THREE.InstancedMesh(debGeo, debMat, DEBRIS_CAP);
  deb.count = 0; deb.frustumCulled = false; deb.setColorAt(0, _c.set(0xffffff));
  scene.add(deb);
  const dx = new Float32Array(DEBRIS_CAP), dy = new Float32Array(DEBRIS_CAP), dz = new Float32Array(DEBRIS_CAP);
  const dvx = new Float32Array(DEBRIS_CAP), dvy = new Float32Array(DEBRIS_CAP), dvz = new Float32Array(DEBRIS_CAP);
  const drx = new Float32Array(DEBRIS_CAP), dry = new Float32Array(DEBRIS_CAP), drz = new Float32Array(DEBRIS_CAP);
  const dsz = new Float32Array(DEBRIS_CAP), dt = new Float32Array(DEBRIS_CAP), dlife = new Float32Array(DEBRIS_CAP);
  const dcol = new Float32Array(DEBRIS_CAP * 3);
  let dn = 0;

  const gGeo = new THREE.OctahedronGeometry(0.15, 0).scale(1, 1.5, 1);
  const gMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
  const gem = new THREE.InstancedMesh(gGeo, gMat, DROP_CAP);
  gem.count = 0; gem.frustumCulled = false; gem.setColorAt(0, _c.set(0xffd25a));
  scene.add(gem);
  const gx = new Float32Array(DROP_CAP), gy = new Float32Array(DROP_CAP), gz = new Float32Array(DROP_CAP);
  const gvx = new Float32Array(DROP_CAP), gvy = new Float32Array(DROP_CAP), gvz = new Float32Array(DROP_CAP);
  const gamt = new Int16Array(DROP_CAP), gage = new Float32Array(DROP_CAP);
  const gon = new Uint8Array(DROP_CAP);
  const gids = Array.from({ length: DROP_CAP }, (_, i) => `combat-drop-${i}`);
  let gcount = 0;
  let serial = 0;

  function writeBreakables() {
    let np = 0, nc = 0;
    for (const b of list) {
      _p.set(b.x, b.y, b.z);
      _e.set(0, b.seed * 6.28, 0);
      _q.setFromEuler(_e);
      _s.setScalar(b.alive ? (b.kind === "pot" ? 0.95 + b.seed * 0.15 : 1) : 0);
      _m.compose(_p, _q, _s);
      if (b.kind === "pot") {
        pots.setMatrixAt(np, _m);
        pots.setColorAt(np, _c.setHSL(0.05 + b.seed * 0.04, 0.5, 0.42 + b.seed * 0.1));
        np++;
      } else {
        crates.setMatrixAt(nc, _m);
        crates.setColorAt(nc, _c.setHSL(0.09 + b.seed * 0.02, 0.45, 0.34 + b.seed * 0.08));
        nc++;
      }
    }
    pots.count = np; crates.count = nc;
    pots.instanceMatrix.needsUpdate = true; crates.instanceMatrix.needsUpdate = true;
    if (pots.instanceColor) pots.instanceColor.needsUpdate = true;
    if (crates.instanceColor) crates.instanceColor.needsUpdate = true;
  }

  function spawnDebris(x: number, y: number, z: number, dirx: number, dirz: number, n: number, hex: number) {
    for (let k = 0; k < n; k++) {
      const i = dn < DEBRIS_CAP ? dn++ : (rnd() * DEBRIS_CAP) | 0;
      const a = rnd() * 6.283, sp = 1.5 + rnd() * 3.2;
      dx[i] = x + (rnd() - 0.5) * 0.3; dy[i] = y + 0.15 + rnd() * 0.4; dz[i] = z + (rnd() - 0.5) * 0.3;
      dvx[i] = Math.cos(a) * sp + dirx * 2.2; dvy[i] = 2.5 + rnd() * 3.2; dvz[i] = Math.sin(a) * sp + dirz * 2.2;
      drx[i] = rnd() * 6; dry[i] = rnd() * 6; drz[i] = rnd() * 6;
      dsz[i] = 0.07 + rnd() * 0.1; dt[i] = 0; dlife[i] = 1.1 + rnd() * 0.7;
      _c.set(hex).offsetHSL(0, 0, (rnd() - 0.5) * 0.12);
      dcol[i * 3] = _c.r; dcol[i * 3 + 1] = _c.g; dcol[i * 3 + 2] = _c.b;
    }
  }

  function dropAt(x: number, y: number, z: number, amount: number) {
    let i = -1;
    for (let k = 0; k < DROP_CAP; k++) if (!gon[k]) { i = k; break; }
    if (i < 0) { // pool full: merge into the oldest drop so no value is lost
      let best = 0;
      for (let k = 1; k < DROP_CAP; k++) if (gage[k] > gage[best]) best = k;
      gamt[best] += amount;
      return;
    }
    const a = rnd() * 6.283, sp = 1.2 + rnd() * 2.4;
    gon[i] = 1; gx[i] = x; gy[i] = y; gz[i] = z; gamt[i] = amount; gage[i] = 0;
    gvx[i] = Math.cos(a) * sp; gvy[i] = 4.5 + rnd() * 2.5; gvz[i] = Math.sin(a) * sp;
    gcount++;
  }

  return {
    list,
    add(x: number, z: number, kind: BreakKind = "pot", y?: number): Breakable | null {
      if (list.length >= BRK_CAP) return null;
      const b: Breakable = {
        id: `${kind}-${serial++}`, kind, x, z, y: y ?? world.heightAt(x, z), r: kind === "pot" ? 0.42 : 0.55,
        h: kind === "pot" ? 0.75 : 0.8, alive: true, seed: rnd(),
      };
      list.push(b);
      writeBreakables();
      return b;
    },
    /** Break one. Returns the glimmer amount dropped. */
    breakIt(b: Breakable, dirx: number, dirz: number, ctx: FrameCtx | null): number {
      if (!b.alive) return 0;
      b.alive = false;
      writeBreakables();
      const pot = b.kind === "pot";
      spawnDebris(b.x, b.y, b.z, dirx, dirz, pot ? 8 : 10, pot ? 0xb8683a : 0x93673a);
      const n = pot ? (rnd() < 0.4 ? 2 : 1) : 2 + ((rnd() * 3) | 0);
      for (let k = 0; k < n; k++) dropAt(b.x, b.y + 0.4, b.z, 1);
      if (ctx) {
        _p.set(b.x, b.y + 0.4, b.z);
        ctx.fx.burst("dust", _p, pot ? 7 : 9, undefined, 2.2);
        if (!pot) ctx.fx.burst("leaf", _p, 4, undefined, 2);
      }
      return n;
    },
    respawnAll() {
      for (const b of list) b.alive = true;
      writeBreakables();
    },
    clearAll() {
      list.length = 0;
      writeBreakables();
    },
    /** Dropped glimmers from a dead enemy. `count` is split over at most 16 gems. */
    dropGlimmers(x: number, y: number, z: number, count: number) {
      const n = Math.min(count, 16);
      if (n <= 0) return;
      const base = Math.floor(count / n);
      let rem = count - base * n;
      for (let k = 0; k < n; k++) {
        dropAt(x, y, z, base + (rem-- > 0 ? 1 : 0));
      }
    },
    /** Physics, magnet, pickup. Calls take() for each collected gem. */
    update(ctx: FrameCtx, dtS: number, time: number, take: (id: string, amount: number, x: number, y: number, z: number) => void) {
      // debris
      for (let i = dn - 1; i >= 0; i--) {
        dt[i] += dtS;
        if (dt[i] >= dlife[i]) {
          const l = --dn;
          if (i !== l) {
            dx[i] = dx[l]; dy[i] = dy[l]; dz[i] = dz[l]; dvx[i] = dvx[l]; dvy[i] = dvy[l]; dvz[i] = dvz[l];
            drx[i] = drx[l]; dry[i] = dry[l]; drz[i] = drz[l]; dsz[i] = dsz[l]; dt[i] = dt[l]; dlife[i] = dlife[l];
            dcol[i * 3] = dcol[l * 3]; dcol[i * 3 + 1] = dcol[l * 3 + 1]; dcol[i * 3 + 2] = dcol[l * 3 + 2];
          }
          continue;
        }
        dvy[i] -= 16 * dtS;
        dx[i] += dvx[i] * dtS; dy[i] += dvy[i] * dtS; dz[i] += dvz[i] * dtS;
        const gnd = world.heightAt(dx[i], dz[i]) + dsz[i] * 0.5;
        if (dy[i] < gnd) { dy[i] = gnd; dvy[i] *= -0.3; dvx[i] *= 0.6; dvz[i] *= 0.6; }
      }
      deb.count = dn;
      for (let i = 0; i < dn; i++) {
        const left = dlife[i] - dt[i];
        const sc = dsz[i] * Math.min(1, left / 0.35);
        _p.set(dx[i], dy[i], dz[i]);
        _e.set(drx[i] + dt[i] * 6, dry[i] + dt[i] * 5, drz[i]);
        _q.setFromEuler(_e);
        _s.setScalar(sc);
        _m.compose(_p, _q, _s);
        deb.setMatrixAt(i, _m);
        deb.setColorAt(i, _c.setRGB(dcol[i * 3], dcol[i * 3 + 1], dcol[i * 3 + 2]));
      }
      if (dn) { deb.instanceMatrix.needsUpdate = true; if (deb.instanceColor) deb.instanceColor.needsUpdate = true; }

      // glimmer drops
      const pl = ctx.player;
      let gi = 0;
      for (let i = 0; i < DROP_CAP; i++) {
        if (!gon[i]) continue;
        gage[i] += dtS;
        let sc = 1;
        const ddx = pl.pos.x - gx[i], ddy = pl.pos.y + 0.9 - gy[i], ddz = pl.pos.z - gz[i];
        const dh = Math.hypot(ddx, ddz);
        const alive = pl.hp > 0;
        if (alive && gage[i] > 0.45 && dh < DROP_MAGNET && Math.abs(ddy) < 3) {
          const pull = 8 + (DROP_MAGNET - dh) * 7;
          const d3 = Math.hypot(dh, ddy) || 1;
          gx[i] += (ddx / d3) * pull * dtS; gy[i] += (ddy / d3) * pull * dtS; gz[i] += (ddz / d3) * pull * dtS;
          gvx[i] = gvy[i] = gvz[i] = 0;
        } else {
          gvy[i] -= 14 * dtS;
          gx[i] += gvx[i] * dtS; gy[i] += gvy[i] * dtS; gz[i] += gvz[i] * dtS;
          const gnd = world.groundAt(gx[i], gy[i] + 0.6, gz[i]) + 0.22;
          if (gy[i] < gnd) {
            gy[i] = gnd;
            if (gvy[i] < -2) gvy[i] *= -0.35; else gvy[i] = 0;
            gvx[i] *= 0.7; gvz[i] *= 0.7;
          }
        }
        if (alive && gage[i] > 0.3 && Math.hypot(pl.pos.x - gx[i], pl.pos.z - gz[i]) < DROP_TAKE && Math.abs(pl.pos.y + 0.9 - gy[i]) < 1.5) {
          take(gids[i], gamt[i], gx[i], gy[i], gz[i]);
          gon[i] = 0; gcount--;
          continue;
        }
        if (gage[i] > DROP_LIFE) { gon[i] = 0; gcount--; continue; }
        if (gage[i] > DROP_LIFE - 4) sc = Math.max(0, 0.5 + 0.5 * Math.sin(gage[i] * 18));
        _p.set(gx[i], gy[i] + Math.sin(time * 4 + i) * 0.04, gz[i]);
        _e.set(0, time * 3 + i, 0);
        _q.setFromEuler(_e);
        _s.setScalar(sc * (0.7 + Math.min(1, gamt[i] / 4) * 0.5));
        _m.compose(_p, _q, _s);
        gem.setMatrixAt(gi, _m);
        gem.setColorAt(gi, _c.set(gamt[i] > 3 ? 0xfff0a0 : 0xffd25a));
        gi++;
      }
      gem.count = gi;
      if (gi) { gem.instanceMatrix.needsUpdate = true; if (gem.instanceColor) gem.instanceColor.needsUpdate = true; }
    },
    clearDrops() {
      gon.fill(0); gcount = 0; dn = 0; deb.count = 0; gem.count = 0;
    },
    get drops() { return gcount; },
    dispose() {
      scene.remove(pots, crates, deb, gem);
      potGeo.dispose(); crateGeo.dispose(); debGeo.dispose(); gGeo.dispose();
      potMat.dispose(); crateMat.dispose(); debMat.dispose(); gMat.dispose();
      pots.dispose(); crates.dispose(); deb.dispose(); gem.dispose();
    },
  };
}
export type Breakables = ReturnType<typeof createBreakables>;
