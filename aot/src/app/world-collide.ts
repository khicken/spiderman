import * as THREE from "three";

// Local frame: world = center + lx * (c, s) + lz * (-s, c) on the xz plane.
// roof: 0 flat, 1 gable with the ridge on local x, 2 gable with the ridge on local z, 3 pyramid.
export type Shape = { cx: number; cz: number; c: number; s: number; hx: number; hz: number; y0: number; y1: number; rh: number; roof: number; on: boolean; stamp: number };

export function shape(cx: number, cz: number, yaw: number, hx: number, hz: number, y0: number, y1: number, rh = 0, roof = 0): Shape {
  return { cx, cz, c: Math.cos(yaw), s: Math.sin(yaw), hx, hz, y0, y1, rh, roof: rh > 0 ? roof : 0, on: true, stamp: 0 };
}

function topAt(sh: Shape, lx: number, lz: number) {
  if (sh.roof === 0) return sh.y1;
  const fx = 1 - Math.abs(lx) / sh.hx;
  const fz = 1 - Math.abs(lz) / sh.hz;
  return sh.y1 + sh.rh * (sh.roof === 1 ? fz : sh.roof === 2 ? fx : Math.min(fx, fz));
}

const CELL = 16;
const HALF = 1400;
const N = Math.ceil((HALF * 2) / CELL);

export type Hit = { grounded: boolean; wall: THREE.Vector3 | null };

export function createCollider(shapes: Shape[]) {
  const counts = new Int32Array(N * N + 1);
  const cellsOf = (sh: Shape, f: (i: number) => void) => {
    const ex = Math.abs(sh.c) * sh.hx + Math.abs(sh.s) * sh.hz;
    const ez = Math.abs(sh.s) * sh.hx + Math.abs(sh.c) * sh.hz;
    const x0 = Math.max(0, Math.floor((sh.cx - ex + HALF) / CELL)), x1 = Math.min(N - 1, Math.floor((sh.cx + ex + HALF) / CELL));
    const z0 = Math.max(0, Math.floor((sh.cz - ez + HALF) / CELL)), z1 = Math.min(N - 1, Math.floor((sh.cz + ez + HALF) / CELL));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) f(z * N + x);
  };
  for (const sh of shapes) cellsOf(sh, (i) => counts[i + 1]++);
  for (let i = 1; i <= N * N; i++) counts[i] += counts[i - 1];
  const items = new Int32Array(counts[N * N]);
  const fill = counts.slice();
  shapes.forEach((sh, k) => cellsOf(sh, (i) => (items[fill[i]++] = k)));

  const dyn: Shape[] = [];
  let stamp = 1;
  const res: Hit = { grounded: false, wall: null };
  const wall = new THREE.Vector3();
  const tmpN = new THREE.Vector3();

  const P = new Float64Array(40);
  let pn = 0;
  const add = (a: number, b: number, c: number, d: number) => {
    P[pn++] = a; P[pn++] = b; P[pn++] = c; P[pn++] = d;
  };
  const rayShape = (sh: Shape, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, out: THREE.Vector3 | null) => {
    const rx = ox - sh.cx, rz = oz - sh.cz;
    const lx = rx * sh.c + rz * sh.s, lz = -rx * sh.s + rz * sh.c;
    const ldx = dx * sh.c + dz * sh.s, ldz = -dx * sh.s + dz * sh.c;
    const top = sh.y1 + sh.rh;
    pn = 0;
    add(1, 0, 0, sh.hx); add(-1, 0, 0, sh.hx); add(0, 0, 1, sh.hz); add(0, 0, -1, sh.hz);
    add(0, -1, 0, -sh.y0); add(0, 1, 0, top);
    if (sh.roof === 1 || sh.roof === 3) { const k = sh.rh / sh.hz; add(0, 1, k, top); add(0, 1, -k, top); }
    if (sh.roof === 2 || sh.roof === 3) { const k = sh.rh / sh.hx; add(k, 1, 0, top); add(-k, 1, 0, top); }
    let tE = 0, tL = maxT, ip = -1;
    for (let i = 0; i < pn; i += 4) {
      const den = P[i] * ldx + P[i + 1] * dy + P[i + 2] * ldz;
      const num = P[i + 3] - (P[i] * lx + P[i + 1] * oy + P[i + 2] * lz);
      if (Math.abs(den) < 1e-9) {
        if (num < 0) return -1;
        continue;
      }
      const t = num / den;
      if (den < 0) {
        if (t > tE) { tE = t; ip = i; }
      } else if (t < tL) tL = t;
      if (tE > tL) return -1;
    }
    if (ip < 0) return -1;
    if (out) {
      tmpN.set(P[ip], P[ip + 1], P[ip + 2]).normalize();
      out.set(tmpN.x * sh.c - tmpN.z * sh.s, tmpN.y, tmpN.x * sh.s + tmpN.z * sh.c);
    }
    return tE;
  };

  const raycast = (o: THREE.Vector3, d: THREE.Vector3, maxT: number, normal?: THREE.Vector3) => {
    stamp++;
    let best = -1;
    if (d.y < -1e-6 && o.y > 0) {
      const t = -o.y / d.y;
      if (t <= maxT) {
        best = t;
        normal?.set(0, 1, 0);
      }
    }
    const lim = best >= 0 ? best : maxT;
    const gx = (o.x + HALF) / CELL;
    const gz = (o.z + HALF) / CELL;
    let cx = Math.floor(gx), cz = Math.floor(gz);
    const sx = d.x > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
    const tdx = Math.abs(d.x) > 1e-9 ? CELL / Math.abs(d.x) : Infinity;
    const tdz = Math.abs(d.z) > 1e-9 ? CELL / Math.abs(d.z) : Infinity;
    let tmx = Math.abs(d.x) > 1e-9 ? ((d.x > 0 ? cx + 1 - gx : gx - cx) * CELL) / Math.abs(d.x) : Infinity;
    let tmz = Math.abs(d.z) > 1e-9 ? ((d.z > 0 ? cz + 1 - gz : gz - cz) * CELL) / Math.abs(d.z) : Infinity;
    let tCell = 0;
    let limit = lim;
    for (let step = 0; step < 4000 && tCell <= limit; step++) {
      if (cx >= 0 && cz >= 0 && cx < N && cz < N) {
        const ci = cz * N + cx;
        for (let k = counts[ci]; k < counts[ci + 1]; k++) {
          const sh = shapes[items[k]];
          if (!sh.on || sh.stamp === stamp) continue;
          sh.stamp = stamp;
          const t = rayShape(sh, o.x, o.y, o.z, d.x, d.y, d.z, limit, tmpRay);
          if (t >= 0 && (best < 0 || t < best)) {
            best = t;
            limit = t;
            normal?.copy(tmpRay);
          }
        }
      } else if ((cx < 0 && sx < 0) || (cz < 0 && sz < 0) || (cx >= N && sx > 0) || (cz >= N && sz > 0)) break;
      if (tmx < tmz) { tCell = tmx; tmx += tdx; cx += sx; }
      else { tCell = tmz; tmz += tdz; cz += sz; }
    }
    for (let k = 0; k < dyn.length; k++) {
      const t = rayShape(dyn[k], o.x, o.y, o.z, d.x, d.y, d.z, limit, tmpRay);
      if (t >= 0 && (best < 0 || t < best)) {
        best = t;
        limit = t;
        normal?.copy(tmpRay);
      }
    }
    return best;
  };
  const tmpRay = new THREE.Vector3();

  const forNear = (x: number, z: number, r: number, f: (sh: Shape) => void) => {
    stamp++;
    const x0 = Math.max(0, Math.floor((x - r + HALF) / CELL)), x1 = Math.min(N - 1, Math.floor((x + r + HALF) / CELL));
    const z0 = Math.max(0, Math.floor((z - r + HALF) / CELL)), z1 = Math.min(N - 1, Math.floor((z + r + HALF) / CELL));
    for (let gz = z0; gz <= z1; gz++)
      for (let gx = x0; gx <= x1; gx++) {
        const ci = gz * N + gx;
        for (let k = counts[ci]; k < counts[ci + 1]; k++) {
          const sh = shapes[items[k]];
          if (!sh.on || sh.stamp === stamp) continue;
          sh.stamp = stamp;
          f(sh);
        }
      }
  };

  let cPos = new THREE.Vector3();
  let cVel = cPos;
  let cR = 0, cH = 0;

  const collideShape = (sh: Shape) => {
    const rx = cPos.x - sh.cx, rz = cPos.z - sh.cz;
    const lx = rx * sh.c + rz * sh.s, lz = -rx * sh.s + rz * sh.c;
    const qx = Math.max(-sh.hx, Math.min(sh.hx, lx)), qz = Math.max(-sh.hz, Math.min(sh.hz, lz));
    const ddx = lx - qx, ddz = lz - qz;
    const d2 = ddx * ddx + ddz * ddz;
    if (d2 >= cR * cR) return;
    const feet = cPos.y - cH / 2, head = cPos.y + cH / 2;
    const top = topAt(sh, qx, qz);
    if (feet >= top || head <= sh.y0) return;
    let nx: number, nz: number, side: number;
    if (d2 > 1e-10) {
      const dist = Math.sqrt(d2);
      nx = ddx / dist; nz = ddz / dist; side = cR - dist;
    } else {
      const ex = sh.hx - Math.abs(lx), ez = sh.hz - Math.abs(lz);
      if (ex < ez) { nx = lx >= 0 ? 1 : -1; nz = 0; side = ex + cR; }
      else { nx = 0; nz = lz >= 0 ? 1 : -1; side = ez + cR; }
    }
    const up = top - feet;
    const down = head - sh.y0;
    if (up <= Math.max(0.8, side) && cVel.y <= 4) {
      cPos.y += up;
      if (cVel.y < 0) cVel.y = 0;
      res.grounded = true;
    } else if (sh.y0 > 0 && down < side && cVel.y > -2) {
      cPos.y -= down;
      if (cVel.y > 0) cVel.y = 0;
    } else {
      const wx = nx * sh.c - nz * sh.s, wz = nx * sh.s + nz * sh.c;
      cPos.x += wx * side;
      cPos.z += wz * side;
      const vn = cVel.x * wx + cVel.z * wz;
      if (vn < 0) {
        cVel.x -= wx * vn;
        cVel.z -= wz * vn;
      }
      res.wall = wall.set(wx, 0, wz);
    }
  };

  const collide = (pos: THREE.Vector3, vel: THREE.Vector3, radius: number, height: number): Hit => {
    res.grounded = false;
    res.wall = null;
    cPos = pos; cVel = vel; cR = radius; cH = height;
    forNear(pos.x, pos.z, radius + 1, collideShape);
    for (let k = 0; k < dyn.length; k++) collideShape(dyn[k]);
    if (pos.y - height / 2 <= 0) {
      pos.y = height / 2;
      if (vel.y < 0) vel.y = 0;
      res.grounded = true;
    }
    return res;
  };

  let tPos = new THREE.Vector3();
  let tR = 0, tStep = 0;
  const pushShape = (sh: Shape) => {
    if (sh.y0 > 0 || sh.y1 + sh.rh <= tStep) return;
    const rx = tPos.x - sh.cx, rz = tPos.z - sh.cz;
    const lx = rx * sh.c + rz * sh.s, lz = -rx * sh.s + rz * sh.c;
    const qx = Math.max(-sh.hx, Math.min(sh.hx, lx)), qz = Math.max(-sh.hz, Math.min(sh.hz, lz));
    const ddx = lx - qx, ddz = lz - qz;
    const d2 = ddx * ddx + ddz * ddz;
    if (d2 >= tR * tR) return;
    let nx: number, nz: number, side: number;
    if (d2 > 1e-10) {
      const dist = Math.sqrt(d2);
      nx = ddx / dist; nz = ddz / dist; side = tR - dist;
    } else {
      const ex = sh.hx - Math.abs(lx), ez = sh.hz - Math.abs(lz);
      if (ex < ez) { nx = lx >= 0 ? 1 : -1; nz = 0; side = ex + tR; }
      else { nx = 0; nz = lz >= 0 ? 1 : -1; side = ez + tR; }
    }
    tPos.x += (nx * sh.c - nz * sh.s) * side;
    tPos.z += (nx * sh.s + nz * sh.c) * side;
  };
  const pushTitan = (pos: THREE.Vector3, radius: number, maxStep: number) => {
    tPos = pos; tR = radius; tStep = maxStep;
    forNear(pos.x, pos.z, radius + 1, pushShape);
  };

  return { raycast, collide, pushTitan, addDynamic: (sh: Shape) => dyn.push(sh) };
}
