import * as THREE from "three";
import type { Quality, Track } from "./contracts";
import { F_ELEV, F_TUNNEL, trackTables, type TrackTables } from "./track";
import { TEX } from "./track-mat";
import { Rib, instanced, lat, rowList, shoulderY } from "./track-rib";
import { dropLamps, setLamps } from "./render-lamps";
import { concreteTex, fenceTex, tileTex } from "./track-tex";

const JERSEY: readonly (readonly [number, number])[] = [[0, -0.3], [0, 0.08], [0, 0.08], [0.15, 0.32], [0.15, 0.32], [0.2, 1.0], [0.2, 1.0], [0.42, 1.0], [0.42, 1.0], [0.6, -0.3]];
const WBEAM_O = [0.07, 0, 0, 0.06, 0, 0, 0.07];
const WBEAM_Y = [0, 0.05, 0.12, 0.17, 0.22, 0.29, 0.34];

type Kind = "concrete" | "armco" | null;

function wallKind(tb: TrackTables, i: number): Kind {
  if (tb.flag[i] & F_TUNNEL) return null;
  if (tb.flag[i] & F_ELEV) return "concrete";
  return tb.style.wall;
}

function wallBase(tb: TrackTables, i: number, side: number) {
  return tb.flag[i] & F_ELEV ? tb.py[i] + side * tb.hw[i] * tb.ly[i] : shoulderY(tb, i, side, tb.run[i]);
}

function wallPoint(tb: TrackTables, i: number, side: number, o: number) {
  const l = lat(tb, i, side * (tb.hw[i] + tb.run[i] + o));
  return [tb.px[i] + tb.lx[i] * l, tb.pz[i] + tb.lz[i] * l] as const;
}

export function buildProps(track: Track, q: Quality, _wet: { value: number }) {
  const tb = trackTables(track);
  const group = new THREE.Group();
  const disp: { dispose(): void }[] = [];
  const n = TEX[q].ground, an = TEX[q].aniso;
  const rows = rowList(tb, track.closed, q === "low" ? 4 : 2);
  const postStep = q === "low" ? 4 : 2;

  const grime = concreteTex(n, an, true);
  grime.repeat.set(1 / 3, 1);
  const clean = concreteTex(n, an, false);
  clean.repeat.set(1 / 4, 1 / 4);
  const tiles = tileTex(n, an);
  tiles.repeat.set(1 / 3, 1 / 3);
  const fence = fenceTex();
  const mWall = new THREE.MeshStandardMaterial({ map: grime, roughness: 0.9 });
  const mConc = new THREE.MeshStandardMaterial({ map: clean, roughness: 0.92, color: 0xd8d4cc, side: THREE.DoubleSide });
  const mTile = new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.4, side: THREE.DoubleSide });
  const mSteel = new THREE.MeshStandardMaterial({ color: 0xb4b9bf, metalness: 0.85, roughness: 0.36, side: THREE.DoubleSide });
  const mPost = new THREE.MeshStandardMaterial({ color: 0x8d9298, metalness: 0.7, roughness: 0.5 });
  const mFence = new THREE.MeshStandardMaterial({ map: fence, alphaTest: 0.5, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide });
  const mTire = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.92 });
  const mLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.5, 2.8), side: THREE.DoubleSide });
  disp.push(grime, clean, tiles, fence, mWall, mConc, mTile, mSteel, mPost, mFence, mTire, mLight);
  const add = (g: THREE.BufferGeometry | null, m: THREE.Material, cast = true) => {
    if (!g) return;
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    group.add(mesh);
    disp.push(g);
  };

  // Walls, rails, posts, fences.
  const posts: THREE.Matrix4[] = [], fposts: THREE.Matrix4[] = [];
  const mtx = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const place = (x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number) => {
    qt.setFromAxisAngle(Y, yaw);
    return mtx.compose(ps.set(x, y, z), qt, sc.set(sx, sy, sz)).clone();
  };
  const yawAt = (i: number) => Math.atan2(tb.fx[i], tb.fz[i]);
  const railBases = tb.style.circuit ? [0.42, 0.82] : [0.45];
  for (const side of [1, -1]) {
    const wall = new Rib(JERSEY.length, true, side > 0);
    const rails = railBases.map(() => new Rib(WBEAM_O.length));
    const fen = new Rib(2);
    for (const k of rows) {
      const i = k % tb.M, s = k * tb.h;
      const kind = wallKind(tb, i);
      const base = wallBase(tb, i, side);
      if (kind === "concrete") {
        for (const [o, y] of JERSEY) {
          const [x, z] = wallPoint(tb, i, side, o);
          wall.v(x, base + y, z, s / 3, 1 - Math.max(0, y));
        }
        wall.row();
      } else wall.brk();
      if (kind === "armco") {
        rails.forEach((r, ri) => {
          const ord = side > 0 ? [...WBEAM_O.keys()] : [...WBEAM_O.keys()].reverse();
          for (const p of ord) {
            const [x, z] = wallPoint(tb, i, side, WBEAM_O[p]);
            r.v(x, base + railBases[ri] + WBEAM_Y[p], z, s, WBEAM_Y[p]);
          }
          r.row();
        });
        if (k % postStep === 0) {
          const [x, z] = wallPoint(tb, i, side, 0.16);
          const top = railBases[railBases.length - 1] + 0.36;
          posts.push(place(x, base - 0.3 + (top + 0.3) / 2, z, yawAt(i), 0.09, top + 0.3, 0.14));
        }
      } else rails.forEach((r) => r.brk());
      const fenced = kind && tb.style.fence && (tb.style.urban || tb.run[i] < 6);
      if (fenced) {
        const top = kind === "concrete" ? 1.0 : railBases[railBases.length - 1] + 0.34;
        const [x, z] = wallPoint(tb, i, side, kind === "concrete" ? 0.3 : 0.22);
        const ord = side > 0 ? [top + 3, top] : [top, top + 3];
        for (const y of ord) fen.v(x, base + y, z, s, y);
        fen.row();
        if (k % 4 === 0) fposts.push(place(x, base + top + 1.55, z, yawAt(i), 0.07, 3.2, 0.07));
      } else fen.brk();
    }
    add(wall.geo(), mWall);
    for (const r of rails) add(r.geo(), mSteel);
    add(fen.geo(), mFence, false);
  }
  const box = new THREE.BoxGeometry(1, 1, 1);
  disp.push(box);
  if (posts.length) group.add(instanced(box, mPost, posts));
  if (fposts.length) group.add(instanced(box, mPost, fposts, false));

  // Tire walls in front of the outside wall of tight corners.
  if (tb.style.tires) {
    const tires: THREE.Matrix4[] = [];
    const tg = new THREE.CylinderGeometry(0.31, 0.31, 0.24, q === "low" ? 10 : 16);
    disp.push(tg);
    for (let s = 0; s < track.length; s += 0.64) {
      const i = Math.min(tb.M - 1, Math.round(s / tb.h));
      const c = tb.curv[i];
      if (Math.abs(c) < 1 / 45 || tb.run[i] > 3 || wallKind(tb, i) === null) continue;
      const side = c > 0 ? -1 : 1;
      const [x, z] = wallPoint(tb, i, side, -0.33);
      const base = wallBase(tb, i, side);
      for (let h = 0; h < 3; h++) tires.push(place(x, base + 0.12 + h * 0.245, z, 0, 1, 1, 1));
    }
    if (tires.length) group.add(instanced(tg, mTire, tires));
  }

  // Tunnels: tiled tube, concrete shell, portals, ceiling light strips.
  const tunnelRuns: [number, number][] = [];
  for (let a = 0; a < rows.length; a++) {
    if (!(tb.flag[rows[a] % tb.M] & F_TUNNEL)) continue;
    let b = a;
    while (b + 1 < rows.length && tb.flag[rows[b + 1] % tb.M] & F_TUNNEL) b++;
    tunnelRuns.push([a, b]);
    a = b;
  }
  const prof = (W: number, H: number) => [[W, -0.4 - H], [W, 4.0], [W * 0.75, 5.0 + H], [W * 0.35, 5.7 + H], [0, 5.9 + H], [-W * 0.35, 5.7 + H], [-W * 0.75, 5.0 + H], [-W, 4.0], [-W, -0.4 - H]] as const;
  const tubeIn = new Rib(9), tubeOut = new Rib(9), portal = new Rib(2), lights = new Rib(2);
  const pt = (i: number, l: number, y: number) => [tb.px[i] + tb.lx[i] * l, tb.py[i] + y, tb.pz[i] + tb.lz[i] * l] as const;
  const tl: number[] = [];
  const tcol = track.map.id === "tokyo" ? [1, 0.6, 0.28] : [1, 0.88, 0.72];
  for (const [a, b] of tunnelRuns) {
    for (let r = a; r <= b; r += 3) {
      const p = pt(rows[r] % tb.M, 0, 5.2);
      tl.push(p[0], p[1], p[2], 16, tcol[0], tcol[1], tcol[2], 45);
    }
    tubeIn.brk();
    tubeOut.brk();
    for (let r = Math.max(0, a - 1); r <= Math.min(rows.length - 1, b + 1); r++) {
      const i = rows[r] % tb.M, s = rows[r] * tb.h, W = tb.hw[i] + 0.1;
      for (const [rib, pr] of [[tubeIn, prof(W, 0)], [tubeOut, prof(W + 0.8, 0.8)]] as const) {
        let v = 0;
        pr.forEach(([l, y], k) => {
          if (k) v += Math.hypot(l - pr[k - 1][0], y - pr[k - 1][1]);
          const p = pt(i, l, y);
          rib.v(p[0], p[1], p[2], s, v);
        });
      }
      tubeIn.row();
      tubeOut.row();
      for (const lx of [W * 0.42, -W * 0.42]) {
        if (rows[r] % 8 < 6) {
          lights.brk();
          for (const [ll, k] of [[lx + 0.14, 0], [lx - 0.14, 1]] as const) { const p = pt(i, ll, 5.55); lights.v(p[0], p[1], p[2], k, 0); }
          lights.row(false);
          const j = rows[Math.min(rows.length - 1, r + 1)] % tb.M;
          for (const [ll, k] of [[lx + 0.14, 0], [lx - 0.14, 1]] as const) { const p = pt(j, ll, 5.55); lights.v(p[0], p[1], p[2], k, 1); }
          lights.row();
        }
      }
      if (r === Math.max(0, a - 1) || r === Math.min(rows.length - 1, b + 1)) {
        portal.brk();
        const pi = prof(W, 0), po = prof(W + 0.8, 0.8);
        for (let k = 0; k < pi.length; k++) {
          const p0 = pt(i, pi[k][0], pi[k][1]), p1 = pt(i, po[k][0], po[k][1]);
          portal.v(p0[0], p0[1], p0[2], 0, 0);
          portal.v(p1[0], p1[1], p1[2], 1, 0);
          portal.row();
        }
      }
    }
  }
  const tunnelLamps = new Float32Array(tl);
  setLamps("tunnel", tunnelLamps, false);
  disp.push({ dispose: () => dropLamps("tunnel", tunnelLamps) });
  add(tubeIn.geo(), mTile);
  add(tubeOut.geo(), mConc);
  add(portal.geo(), mConc);
  add(lights.geo(false), mLight, false);

  // Viaducts: deck slab and hammerhead piers.
  const deck = new Rib(10, true);
  const cols: THREE.Matrix4[] = [], caps: THREE.Matrix4[] = [];
  let lastPier = -1e9;
  for (const k of rows) {
    const i = k % tb.M, s = k * tb.h;
    if (!(tb.flag[i] & F_ELEV)) { deck.brk(); continue; }
    const hw = tb.hw[i], E = hw + 0.65, T = 1.7;
    const segs = [[E, -T], [E, 0], [E, 0], [hw, 0], [-hw, 0], [-E, 0], [-E, 0], [-E, -T], [-E, -T], [E, -T]] as const;
    for (const [l, dy] of segs) {
      const x = tb.px[i] + tb.lx[i] * l, z = tb.pz[i] + tb.lz[i] * l;
      deck.v(x, tb.py[i] + tb.ly[i] * l + dy, z, s / 4, (dy + l) / 4);
    }
    deck.row();
    const inside = tb.flag[(i + 15) % tb.M] & F_ELEV && tb.flag[(i - 15 + tb.M) % tb.M] & F_ELEV;
    if (inside && s - lastPier >= 30) {
      lastPier = s;
      const yaw = yawAt(i), bottom = tb.py[i] - T;
      const offs = E > 8 ? [E * 0.5, -E * 0.5] : [0];
      for (const o of offs) {
        const x = tb.px[i] + tb.lx[i] * o, z = tb.pz[i] + tb.lz[i] * o;
        const H = bottom - track.heightAt(x, z) + 1.5;
        if (H > 2) cols.push(place(x, bottom - H / 2, z, yaw, 1.7, H, 1.7));
      }
      caps.push(place(tb.px[i], bottom - 0.5, tb.pz[i], yaw, E * 1.7, 1.0, 1.8));
    }
  }
  add(deck.geo(), mConc);
  if (cols.length) group.add(instanced(box, mConc, cols));
  if (caps.length) group.add(instanced(box, mConc, caps));

  return {
    group,
    dispose: () => {
      for (const d of disp) d.dispose();
      group.traverse((o) => (o as THREE.InstancedMesh).isInstancedMesh && (o as THREE.InstancedMesh).dispose());
    },
  };
}
