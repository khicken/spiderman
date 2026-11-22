import * as THREE from "three";
import type { FrameCtx, GameEvent, Prop, Quality, V3, World } from "./contracts";
import { BEACON_COLOR, CLIFFS, PLAYER } from "./contracts";
import type { BeaconTower } from "./landmark-beacon";
import type { Emit, SiteEnv, TrialHandle } from "./landmark-kit";
import { Mesher, PAL, clamp, glowMat, groundMin, haloSprite, lerp, rng } from "./landmark-kit";

export const CLIFF_TRIAL_TOTAL = 6;
const TIME_LIMIT = 75;
const RING_R = 4.5;
const HIT_R = 5.6;
const BRAZIER_R = 6;
const RING_STAMINA = 0.25;
const UPDRAFT_SPEED = 6;
const UPDRAFT_R = 6.5;
const UPDRAFT_H = 40;
const FLARE_T = 3;
const TAU = Math.PI * 2;

export interface Updraft { x: number; z: number; r: number }
const updrafts: Updraft[] = [];
/** Filled when the trial is built. Same columns `updraftAt` tests. */
export const CLIFF_UPDRAFTS: readonly Updraft[] = updrafts;

export interface CliffRing { x: number; y: number; z: number; nx: number; ny: number; nz: number }
export interface CliffPlan { rings: CliffRing[]; brazier: V3; edge: V3; updrafts: Updraft[] }

export function planCliffTrial(world: World, front: V3): CliffPlan {
  const fx = front.x, fz = front.z, top = front.y;

  let bx = fx + 40, bz = fz + 150, best = Infinity;
  for (let x = fx + 8; x <= fx + 110; x += 4) {
    for (let z = fz + 80; z <= fz + 200; z += 4) {
      const y = world.heightAt(x, z);
      if (y < 1.2 || y > 3.5) continue;
      let ok = true;
      for (let k = 0; k < 6 && ok; k++) {
        const dx = k < 2 ? (k ? -6 : 6) : k < 4 ? 0 : (k === 4 ? 6 : -6);
        const dz = k < 2 ? 0 : k < 4 ? (k === 2 ? 6 : -6) : (k === 4 ? 6 : -6);
        const q = world.heightAt(x + dx, z + dz);
        if (q < 0.4 || Math.abs(q - y) > 1.8) ok = false;
      }
      if (!ok) continue;
      const s = Math.abs(Math.hypot(x - fx, z - fz) - 150);
      if (s < best) { best = s; bx = x; bz = z; }
    }
  }
  if (best === Infinity) {
    const ux = 0.45, uz = 0.89;
    for (let d = 40; d < 420; d += 4) {
      const y = world.heightAt(fx + ux * d, fz + uz * d);
      if (y > 0.8 && y < 4) { bx = fx + ux * d; bz = fz + uz * d; }
    }
  }
  const by = world.heightAt(bx, bz);

  const clen = Math.hypot(CLIFFS.x1 - CLIFFS.x0, CLIFFS.z1 - CLIFFS.z0);
  const nx = (CLIFFS.z1 - CLIFFS.z0) / clen, nz = -(CLIFFS.x1 - CLIFFS.x0) / clen;
  let dx = nx + 0.45 * -nz, dz = nz + 0.45 * nx;
  const dl = Math.hypot(dx, dz);
  dx /= dl; dz /= dl;
  let ex = fx, ez = fz;
  for (let d = 0; d < 260; d += 2) {
    const x = fx + dx * d, z = fz + dz * d;
    if (world.heightAt(x, z) < top - 8) break;
    ex = x; ez = z;
  }

  const N = 48;
  const px = new Float64Array(N + 1), pz = new Float64Array(N + 1), cum = new Float64Array(N + 1);
  const mx = (ex + bx) / 2, mz = (ez + bz) / 2;
  let total = 0;
  for (let sag = 60; sag <= 130; sag += 10) {
    const cx = mx + nx * sag * 2, cz = mz + nz * sag * 2;
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      px[i] = u * u * ex + 2 * u * t * cx + t * t * bx;
      pz[i] = u * u * ez + 2 * u * t * cz + t * t * bz;
      cum[i] = i ? cum[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]) : 0;
    }
    total = cum[N];
    if (total >= 236) break;
  }

  const s0 = 6;
  const sp = clamp((total - s0 - 50) / (CLIFF_TRIAL_TOTAL - 1), 18, 22);
  const at = (s: number, out: number[]) => {
    let i = 1;
    while (i < N && cum[i] < s) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const t = clamp((s - cum[i - 1]) / seg, 0, 1);
    out[0] = lerp(px[i - 1], px[i], t);
    out[1] = lerp(pz[i - 1], pz[i], t);
    out[2] = (px[i] - px[i - 1]) / seg;
    out[3] = (pz[i] - pz[i - 1]) / seg;
  };

  // the lip can sit up to 8 m below the summit; launch height is the lip's ground plus a jump
  const yTop = world.heightAt(ex, ez) + 1.5;
  const tmp = [0, 0, 0, 0];
  const rings: CliffRing[] = [];
  // A straight glide drops 0.235 m per metre (glideSink / glideFwd); a steered, curving glide measures ~0.3. Rings sit on
  // that line so holding forward threads them; a ring below the line is fine (drop out of the glide), above is not.
  const GLIDE_DROP = 0.3;
  const slope = -GLIDE_DROP;
  for (let i = 0; i < CLIFF_TRIAL_TOTAL; i++) {
    const s = s0 + i * sp;
    at(s, tmp);
    const x = tmp[0], z = tmp[1];
    const y = Math.max(yTop - 2 - s * GLIDE_DROP, Math.max(0, world.heightAt(x, z)) + 7);
    const hl = Math.hypot(tmp[2], tmp[3]) || 1;
    let tx = tmp[2] / hl, tz = tmp[3] / hl, ty = slope;
    const tl = Math.hypot(tx, ty, tz);
    tx /= tl; ty /= tl; tz /= tl;
    rings.push({ x, y, z, nx: tx, ny: ty, nz: tz });
  }

  const ups: Updraft[] = [];
  const lx = -dz, lz = dx;
  const spec: [number, number][] = [[10, 8], [22, -7], [34, 4]];
  for (const [k, lat] of spec) ups.push({ x: ex - dx * k + lx * lat, z: ez - dz * k + lz * lat, r: UPDRAFT_R });

  return { rings, brazier: { x: bx, y: by, z: bz }, edge: { x: ex, y: top, z: ez }, updrafts: ups };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _v = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const cDim = new THREE.Color("#5a4f44");
const cNextA = new THREE.Color("#8a5a2a");
const cNextB = new THREE.Color(BEACON_COLOR[0]).lerp(new THREE.Color("#ffffff"), 0.35);
const cLit = new THREE.Color(PAL.emberHi).lerp(new THREE.Color("#fff3c4"), 0.4);
const cBurnt = new THREE.Color("#3a322b");
const _c = new THREE.Color();

function stripeTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  const r = rng(31);
  for (let i = 0; i < 14; i++) {
    const x = r() * 64, w = 1.5 + r() * 3.5, y0 = r() * 128, len = 40 + r() * 70;
    const gr = g.createLinearGradient(0, y0, 0, y0 + len);
    gr.addColorStop(0, "rgba(255,255,255,0)");
    gr.addColorStop(0.5, `rgba(255,255,255,${0.35 + r() * 0.5})`);
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    for (const o of [-128, 0, 128]) g.fillRect(x - w / 2, y0 + o, w, len);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1.4);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildCliffTrial(env: SiteEnv, tower: BeaconTower, sky: THREE.Group): TrialHandle & { updraftAt(x: number, y: number, z: number): number } {
  void sky;
  const { world, look, group } = env;
  const plan = planCliffTrial(world, tower.front);
  const { rings, brazier } = plan;
  const owner = "landmarks:cliff-trial";
  const topY = tower.gy;
  const flameColor = BEACON_COLOR[0];

  updrafts.length = 0;
  for (const u of plan.updrafts) updrafts.push(u);
  const upBase: number[] = plan.updrafts.map((u) => world.heightAt(u.x, u.z));

  const torus = new THREE.TorusGeometry(RING_R, 0.38, 6, 24).toNonIndexed();
  const lantern = new THREE.IcosahedronGeometry(0.8, 0);
  const tPos = torus.attributes.position as THREE.BufferAttribute;
  const lPos = lantern.attributes.position as THREE.BufferAttribute;
  const perRing = tPos.count + 4 * lPos.count;
  const ringPos = new Float32Array(CLIFF_TRIAL_TOTAL * perRing * 3);
  const ringCol = new Float32Array(CLIFF_TRIAL_TOTAL * perRing * 3);
  const gain = new Float32Array(CLIFF_TRIAL_TOTAL * perRing);
  for (let i = 0; i < CLIFF_TRIAL_TOTAL; i++) {
    const r = rings[i];
    _q.setFromUnitVectors(_z, _v.set(r.nx, r.ny, r.nz));
    _m.compose(_p.set(r.x, r.y, r.z), _q, _s);
    let o = i * perRing;
    for (let k = 0; k < tPos.count; k++, o++) {
      _v.fromBufferAttribute(tPos, k).applyMatrix4(_m);
      ringPos.set([_v.x, _v.y, _v.z], o * 3);
      gain[o] = 1;
    }
    for (let l = 0; l < 4; l++) {
      const a = l * (TAU / 4) + Math.PI / 4;
      for (let k = 0; k < lPos.count; k++, o++) {
        _v.fromBufferAttribute(lPos, k);
        _v.x += Math.cos(a) * RING_R;
        _v.y += Math.sin(a) * RING_R;
        _v.applyMatrix4(_m);
        ringPos.set([_v.x, _v.y, _v.z], o * 3);
        gain[o] = 1.3;
      }
    }
  }
  torus.dispose();
  lantern.dispose();
  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute("position", new THREE.BufferAttribute(ringPos, 3));
  const colAttr = new THREE.BufferAttribute(ringCol, 3);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  ringGeo.setAttribute("color", colAttr);
  ringGeo.computeBoundingSphere();
  env.own(ringGeo);
  const ringMat = env.own(new THREE.MeshBasicMaterial({ vertexColors: true }));
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.name = "cliff-trial-rings";
  ringMesh.matrixAutoUpdate = false;
  ringMesh.updateMatrix();

  const ringsG = new THREE.Group();
  ringsG.name = "cliff-trial-rings-group";
  ringsG.add(ringMesh);
  const halos: THREE.Sprite[] = [];
  for (let i = 0; i < CLIFF_TRIAL_TOTAL; i++) {
    const h = haloSprite(env.glow, flameColor, 16);
    env.own(h.material);
    h.position.set(rings[i].x, rings[i].y, rings[i].z);
    h.visible = false;
    ringsG.add(h);
    halos.push(h);
  }

  const cylSeg = 10, cylRows = 4;
  let upPos: number[] = [], upUv: number[] = [], upCol: number[] = [];
  for (let i = 0; i < plan.updrafts.length; i++) {
    const u = plan.updrafts[i];
    const g = new THREE.CylinderGeometry(u.r * 1.15, u.r * 0.85, UPDRAFT_H, cylSeg, cylRows, true).toNonIndexed();
    const pa = g.attributes.position as THREE.BufferAttribute;
    const ua = g.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < pa.count; k++) {
      const y = pa.getY(k);
      const t = y / UPDRAFT_H + 0.5;
      upPos.push(pa.getX(k) + u.x, y + UPDRAFT_H / 2 + upBase[i] - 1, pa.getZ(k) + u.z);
      upUv.push(ua.getX(k) + i * 0.37, ua.getY(k));
      const f = Math.pow(Math.sin(Math.PI * clamp(t, 0, 1)), 0.8);
      upCol.push(f, f, f);
    }
    g.dispose();
  }
  const upGeo = new THREE.BufferGeometry();
  upGeo.setAttribute("position", new THREE.Float32BufferAttribute(upPos, 3));
  upGeo.setAttribute("uv", new THREE.Float32BufferAttribute(upUv, 2));
  upGeo.setAttribute("color", new THREE.Float32BufferAttribute(upCol, 3));
  upGeo.computeBoundingSphere();
  upPos = upUv = upCol = [];
  env.own(upGeo);
  const stripes = env.own(stripeTexture());
  const upMat = env.own(new THREE.MeshBasicMaterial({
    map: stripes, color: "#ffd9a0", vertexColors: true, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, fog: false,
  }));
  const upMesh = new THREE.Mesh(upGeo, upMat);
  upMesh.name = "cliff-trial-updrafts";
  upMesh.frustumCulled = false;
  upMesh.matrixAutoUpdate = false;
  upMesh.updateMatrix();

  const bx = brazier.x, bz = brazier.z;
  const gb = groundMin(world, bx, bz, 1.6, 1.6);
  const bm = new Mesher(77);
  bm.cyl(bx, gb - 0.6, bz, 2.1, 1.7, 1.2, PAL.rockLo, 8, Math.PI / 8);
  bm.cyl(bx, gb + 0.55, bz, 1.2, 1.0, 1.2, PAL.rock, 8, Math.PI / 8);
  bm.cyl(bx, gb + 1.7, bz, 0.95, 1.5, 0.7, PAL.ashLo, 10);
  bm.cyl(bx, gb + 2.3, bz, 1.55, 1.55, 0.14, PAL.goldLo, 10, 0, { ao: 0 });
  bm.ball(bx, gb + 2.3, bz, 1.2, PAL.ink, 0.25, 1);
  for (let k = 0; k < 3; k++) {
    const a = k * (TAU / 3) + 0.5;
    bm.beam(bx + Math.cos(a) * 1.7, gb + 0.3, bz + Math.sin(a) * 1.7, bx + Math.cos(a) * 1.0, gb + 1.9, bz + Math.sin(a) * 1.0, 0.26, PAL.woodLo);
  }
  bm.beam(bx + 2.3, gb - 0.2, bz, bx + 2.3, gb + 7.5, bz, 0.22, PAL.woodLo);
  bm.box(bx + 2.3, gb + 4.3, bz - 0.05, 0.05, 3.0, 1.3, PAL.cloth, 0, { ao: 0 });
  const bMesh = bm.build(look, undefined, "cliff-trial-brazier");
  env.own(bMesh.geometry);
  world.addBox({ minX: bx - 1.3, maxX: bx + 1.3, minZ: bz - 1.3, maxZ: bz + 1.3, minY: gb - 0.6, maxY: gb + 2.0, tag: "solid", owner: owner + "-brazier" });

  const flameGeo = env.own(new THREE.ConeGeometry(1, 1, 7, 1).translate(0, 0.5, 0));
  const flame = new THREE.Mesh(flameGeo, glowMat(look, flameColor, 1.6));
  flame.position.set(bx, gb + 2.35, bz);
  flame.visible = false;
  const bHalo = haloSprite(env.glow, flameColor, 9);
  env.own(bHalo.material);
  bHalo.position.set(bx, gb + 3.2, bz);
  bHalo.visible = false;
  const flamePos: V3 = { x: bx, y: gb + 2.6, z: bz };

  const brazierG = new THREE.Group();
  brazierG.name = "cliff-trial-brazier-group";
  brazierG.add(bMesh, flame, bHalo);

  ringsG.visible = brazierG.visible = upMesh.visible = false;
  group.add(ringsG, upMesh, brazierG);

  const props: Prop[] = [];
  let active = false;
  let timeLeft = TIME_LIMIT;
  let progress = 0;
  let leftTop = false;
  let solvedFlag = false;
  let lit = false;
  let flareT = 0;
  let shown = false;
  let havePrev = false;
  let pvx = 0, pvy = 0, pvz = 0;

  const paintRing = (i: number, c: THREE.Color) => {
    const a = i * perRing;
    for (let k = 0; k < perRing; k++) {
      const gk = gain[a + k], o = (a + k) * 3;
      ringCol[o] = c.r * gk;
      ringCol[o + 1] = c.g * gk;
      ringCol[o + 2] = c.b * gk;
    }
    colAttr.needsUpdate = true;
  };

  const refreshRings = () => {
    for (let i = 0; i < CLIFF_TRIAL_TOTAL; i++) {
      const h = halos[i];
      if (solvedFlag) {
        paintRing(i, cBurnt);
        h.visible = false;
      } else if (i < progress) {
        paintRing(i, cLit);
        h.visible = true;
        h.scale.set(14, 14, 1);
        h.material.opacity = 0.75;
      } else if (active && i === progress) {
        paintRing(i, cNextB);
        h.visible = true;
      } else {
        paintRing(i, cDim);
        h.visible = false;
      }
    }
  };

  const setLit = (on: boolean) => {
    lit = on;
    flame.visible = on;
    bHalo.visible = on;
  };

  const reset = () => {
    active = false;
    timeLeft = TIME_LIMIT;
    progress = 0;
    leftTop = false;
    havePrev = false;
    if (solvedFlag) {
      setLit(true);
    } else {
      setLit(false);
      flareT = 0;
    }
    refreshRings();
  };

  const setShown = (on: boolean) => {
    if (shown === on) return;
    shown = on;
    ringsG.visible = on;
    brazierG.visible = on;
    upMesh.visible = on;
  };

  const animate = (dt: number, time: number) => {
    stripes.offset.y -= dt * 0.55;
    upMat.opacity = 0.42 + 0.08 * Math.sin(time * 1.7);
    if (active && progress < CLIFF_TRIAL_TOTAL) {
      const k = 0.5 + 0.5 * Math.sin(time * 6);
      paintRing(progress, _c.copy(cNextA).lerp(cNextB, k));
      const h = halos[progress];
      h.visible = true;
      const sz = 12 + 6 * k;
      h.scale.set(sz, sz, 1);
      h.material.opacity = 0.45 + 0.45 * k;
    }
    if (lit) {
      if (flareT > 0) flareT = Math.max(0, flareT - dt);
      const f = flareT / FLARE_T;
      const flick = 1 + 0.07 * Math.sin(time * 9) + 0.05 * Math.sin(time * 17.3);
      const s = flick * (1 + 1.7 * f * f);
      flame.scale.set(1.05 * s, 3.2 * s, 1.05 * s);
      const hs = (9 + 14 * f) * flick;
      bHalo.scale.set(hs, hs, 1);
      bHalo.material.opacity = 0.7 + 0.3 * f;
    }
  };

  const fail = (emit: Emit) => {
    emit({ type: "trialFail", beacon: 0 });
    reset();
  };

  const trial: TrialHandle & { updraftAt(x: number, y: number, z: number): number } = {
    beacon: 0,
    get active() { return active; },
    props,
    get timeLeft() { return active ? Math.max(0, timeLeft) : null; },
    canStart() { return null; },
    start(ctx: FrameCtx, emit: Emit) {
      if (active || solvedFlag) return;
      active = true;
      timeLeft = TIME_LIMIT;
      progress = 0;
      leftTop = false;
      const p = ctx.player.pos;
      pvx = p.x; pvy = p.y; pvz = p.z;
      havePrev = true;
      refreshRings();
      emit({ type: "trialStart", beacon: 0 });
    },
    update(ctx: FrameCtx, emit: Emit, near: boolean) {
      if (!near && !active) {
        setShown(false);
        return;
      }
      setShown(true);
      animate(ctx.dt, ctx.time);
      if (!active) return;

      const pl = ctx.player;
      const p = pl.pos;
      timeLeft -= ctx.dt;
      if (timeLeft <= 0) {
        fail(emit);
        return;
      }

      if (progress < CLIFF_TRIAL_TOTAL) {
        const r = rings[progress];
        const d1 = (p.x - r.x) * r.nx + (p.y - r.y) * r.ny + (p.z - r.z) * r.nz;
        if (havePrev) {
          const d0 = (pvx - r.x) * r.nx + (pvy - r.y) * r.ny + (pvz - r.z) * r.nz;
          if (d0 < 0 && d1 >= 0) {
            const t = d0 / (d0 - d1);
            const hx = pvx + (p.x - pvx) * t - r.x, hy = pvy + (p.y - pvy) * t - r.y, hz = pvz + (p.z - pvz) * t - r.z;
            if (hx * hx + hy * hy + hz * hz <= HIT_R * HIT_R) {
              progress++;
              leftTop = true;
              // each ring refills some stamina so the glide can reach the brazier
              pl.stamina = Math.min(PLAYER.staminaMax, pl.stamina + RING_STAMINA);
              refreshRings();
              ctx.fx.burst("spark", r, 14);
              emit({ type: "trialProgress", beacon: 0, value: progress, total: CLIFF_TRIAL_TOTAL });
            }
          }
        }
      }
      pvx = p.x; pvy = p.y; pvz = p.z;
      havePrev = true;

      if (!leftTop && !pl.grounded && p.y < topY - 4) leftTop = true;
      if (!leftTop) return;

      if (pl.mode === "swim" || pl.mode === "dead") {
        fail(emit);
        return;
      }
      if (!pl.grounded) return;
      if (progress < CLIFF_TRIAL_TOTAL) {
        fail(emit);
        return;
      }
      const dx = p.x - bx, dz = p.z - bz;
      if (dx * dx + dz * dz <= BRAZIER_R * BRAZIER_R && Math.abs(p.y - gb) < 5) {
        emit({ type: "trialDone", beacon: 0 });
        active = false;
        solvedFlag = true;
        progress = 0;
        setLit(true);
        flareT = FLARE_T;
        refreshRings();
        ctx.fx.burst("beacon", flamePos, 24);
      }
    },
    handle(e: GameEvent) {
      if (!active) return;
      if (e.type === "died" || e.type === "respawned" || (e.type === "trialFail" && e.beacon === 0)) reset();
    },
    abort() {
      reset();
    },
    solved(animated: boolean) {
      solvedFlag = true;
      active = false;
      progress = 0;
      setLit(true);
      flareT = animated ? FLARE_T : 0;
      refreshRings();
    },
    setQuality(_q: Quality) {},
    updraftAt(x: number, y: number, z: number): number {
      for (let i = 0; i < updrafts.length; i++) {
        const u = updrafts[i];
        const dx = x - u.x, dz = z - u.z;
        if (dx * dx + dz * dz > u.r * u.r) continue;
        const b = upBase[i];
        if (y > b - 2 && y < b + UPDRAFT_H) return UPDRAFT_SPEED;
      }
      return 0;
    },
  };

  refreshRings();
  return trial;
}
