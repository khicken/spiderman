import * as THREE from "three";
import { LANDMARKS } from "./contracts";
import {
  Mesher, PAL, clamp, glowMat, groundMin, haloSprite, lerp, rng, smooth, solidBox,
  type SiteEnv, type SiteInfo,
} from "./landmark-kit";

// Gloam Spire: the summit arena of Mt. Cinder. Tower, rim pillars, paving, the violet barrier dome, and the lantern path
// that climbs the mountain. Everything animated is a pre-built object; per-frame code only mutates numbers.

export interface SpireHandle {
  info: SiteInfo;
  arena: { x: number; y: number; z: number; r: number };
  barrierDown: boolean;
  /** Crack-and-fall (about 2.5 s). Colliders are removed at once; `false` snaps to the down state. */
  dropBarrier(animated: boolean): void;
  lightPath(on: boolean): void;
  bossAwake(on: boolean): void;
  flare(): void;
  defeated(on: boolean): void;
}

const TAU = Math.PI * 2;
const BARRIER_R = 38;
const BARRIER_N = 64;
const DROP_TIME = 2.5;
const FRAG_N = 48;
const POST_N = 20;
const VIOLET = "#9a6fc1";
const GOLD = "#e8c766";

type Lam = THREE.MeshLambertMaterial;

function hexTexture(): THREE.CanvasTexture {
  const R = 64, W = 3 * R, H = Math.round(Math.sqrt(3) * R);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, W, H);
  g.lineJoin = "round";
  for (let i = -1; i <= 2; i++) {
    for (let j = -1; j <= 2; j++) {
      const cx = i * 1.5 * R, cy = j * H + (i & 1 ? H / 2 : 0);
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3;
        const px = cx + Math.cos(a) * R * 0.94, py = cy + Math.sin(a) * R * 0.94;
        if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
      g.fillStyle = "rgba(255,255,255,0.28)";
      g.fill();
      g.strokeStyle = "rgba(255,255,255,1)";
      g.lineWidth = 3.5;
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(14, 6);
  return t;
}

export function buildSpire(env: SiteEnv): SpireHandle {
  const { world, look, group, reg } = env;
  const L = LANDMARKS.find((l) => l.id === "spire")!;
  const cx = L.x, cz = L.z;
  const gy = world.heightAt(cx, cz);
  const rnd = rng(9137);
  const rotRadial = (a: number) => -a - Math.PI / 2; // local +z faces the arena center, local x runs along the tangent

  const stone = new Mesher(11);
  const violet = new Mesher(12); // static glow: runes, braziers, eye slit, sigil; flips to gold when defeated
  const crystal = new Mesher(13);
  const rim = new Mesher(14);
  const cracks = new Mesher(15);

  // ---- tower ---------------------------------------------------------------------------------------------------------
  const tz = cz - 26;
  const tb = world.heightAt(cx, tz);
  const t0 = groundMin(world, cx, tz, 6, 6) - 0.8;
  solidBox(world, stone, "landmarks:spire-base", cx, tz, 12, 12, tb + 8, PAL.gloamLo, "solid", { y0: t0 });
  solidBox(world, stone, "landmarks:spire-base2", cx, tz, 10, 10, tb + 14, PAL.gloam, "solid", { y0: tb + 8 });
  // plinth trim and corner studs
  stone.box(cx, tb + 8, tz, 12.6, 0.7, 12.6, PAL.gloamLo);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    stone.box(cx + sx * 6, t0, tz + sz * 6, 1.6, tb + 6.5 - t0, 1.6, PAL.gloam);
    stone.cone(cx + sx * 6, tb + 6.5, tz + sz * 6, 0.9, 1.6, PAL.gloamHi, 4, Math.PI / 4);
  }
  // skirt and shaft tiers (hex section, a vertex faces south)
  stone.cyl(cx, tb + 14, tz, 6.0, 5.2, 2.6, PAL.gloamLo, 6);
  const tiers: [number, number, number, number, string][] = [
    [16.6, 26, 5.2, 4.6, PAL.gloam], [26, 34, 4.6, 4.0, PAL.gloamLo],
    [35.4, 44, 3.8, 3.0, PAL.gloam], [44, 52, 3.0, 2.4, PAL.gloamLo],
  ];
  for (const [y0, y1, rb, rt, c] of tiers) stone.cyl(cx, tb + y0, tz, rb, rt, y1 - y0, c, 6);
  stone.cyl(cx, tb + 34, tz, 5.4, 4.3, 1.4, PAL.gloamHi, 6, 0, { jit: 0.02 }); // mid collar
  stone.cyl(cx, tb + 52, tz, 3.7, 3.0, 1.0, PAL.gloam, 6);
  const shaftR = (y: number) => {
    for (const [y0, y1, rb, rt] of tiers) if (y >= y0 && y <= y1) return lerp(rb, rt, (y - y0) / (y1 - y0));
    return 4;
  };
  for (const y of [20, 40, 48]) violet.cyl(cx, tb + y, tz, shaftR(y) + 0.1, shaftR(y) + 0.1, 0.28, VIOLET, 6, 0, { jit: 0, ao: 0 });
  // eye slit facing south at 30 m
  const eyeZ = tz + shaftR(30) + 0.3;
  stone.box(cx, tb + 27.6, eyeZ, 3.4, 4.8, 2.2, PAL.gloamLo);
  stone.prism(cx, tb + 32.4, eyeZ, 3.8, 1.3, 2.2, PAL.gloamHi);
  stone.box(cx, tb + 27.2, eyeZ, 4.0, 0.5, 2.4, PAL.gloamHi);
  violet.box(cx, tb + 28.3, eyeZ + 1.12, 0.7, 3.6, 0.2, "#d8bcf2", 0, { jit: 0, ao: 0 });
  violet.box(cx, tb + 29.7, eyeZ + 1.14, 2.2, 0.35, 0.16, VIOLET, 0, { jit: 0, ao: 0 });
  // buttresses: four long, four short, leaning into the shaft
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, long = (k & 1) === 0;
    const r0 = long ? 11 : 9.2, r1 = long ? 5.0 : 5.4, h1 = long ? 22 : 15;
    const dx = Math.cos(a), dz = Math.sin(a);
    const bx = cx + dx * r0, bz = tz + dz * r0;
    stone.beam(bx, t0, bz, cx + dx * r1, tb + h1, tz + dz * r1, long ? 2.2 : 1.7, long ? PAL.gloam : PAL.gloamLo);
    stone.box(bx, t0, bz, long ? 3.2 : 2.6, tb + 1.4 - t0, long ? 3.2 : 2.6, PAL.gloamLo);
    if (long) {
      world.addBox({ minX: bx - 1.4, maxX: bx + 1.4, minZ: bz - 1.4, maxZ: bz + 1.4, minY: t0, maxY: tb + 7, tag: "solid", owner: `landmarks:spire-buttress-${k}` });
      stone.box(bx, tb + 1.4, bz, 2.4, 5.6, 2.4, PAL.gloam);
    }
  }
  // broken crown: ragged spikes around the floating heart
  for (let k = 0; k < 6; k++) {
    const a = k * Math.PI / 3 + 0.25;
    const broken = k === 2 || k === 5;
    const tipH = broken ? 55.6 + rnd() : 58.5 + rnd() * 3.2;
    const spread = 3.3 + rnd() * 1.1;
    stone.beam(cx + Math.cos(a) * 2.3, tb + 52.8, tz + Math.sin(a) * 2.3, cx + Math.cos(a) * spread, tb + tipH, tz + Math.sin(a) * spread, broken ? 1.5 : 1.1, PAL.gloam);
    if (broken) stone.ball(cx + Math.cos(a) * 4.4, tb + 52.8, tz + Math.sin(a) * 4.4, 0.8, PAL.gloamHi, 0.7, 0);
  }
  stone.cone(cx, tb + 52.8, tz, 1.2, 1.4, PAL.gloamHi, 6);

  // ledge on the tower base (south side) for a glimmer cluster
  reg.cluster({ x: cx + 3.6, y: tb + 14.9, z: tz + 3.4, n: 5, spread: 1.3 });

  // ---- arena ---------------------------------------------------------------------------------------------------------
  // paving rings, broken
  const paveRing = (r: number, n: number, wRad: number, color: string) => {
    for (let i = 0; i < n; i++) {
      if (rnd() < 0.24) continue;
      const a = (i + rnd() * 0.2) / n * TAU;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const arc = TAU * r / n * 0.9;
      const gh = world.heightAt(x, z);
      const tilt = rnd() < 0.2 ? (rnd() - 0.5) * 0.12 : 0;
      stone.box(x, gh - 0.3, z, arc, 0.5 + rnd() * 0.15, wRad * (0.85 + rnd() * 0.15), color, rotRadial(a), { rx: tilt, rz: tilt * 0.6, ao: 0.05 });
      if (rnd() < 0.16) violet.box(x, gh + 0.2, z, arc * 0.3, 0.05, wRad * 0.5, VIOLET, rotRadial(a), { jit: 0, ao: 0 });
    }
  };
  paveRing(19, 30, 3.4, PAL.gloam);
  paveRing(23.5, 38, 3.0, PAL.gloamLo);
  violet.torus(cx, gy + 0.14, cz, 9, 0.11, VIOLET, Math.PI / 2, 0, 0, 72, 4);
  violet.torus(cx, gy + 0.14, cz, 4.2, 0.09, VIOLET, Math.PI / 2, 0, 0, 48, 4);
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    violet.box(cx + Math.cos(a) * 6.6, gy + 0.1, cz + Math.sin(a) * 6.6, 4.2, 0.05, 0.12, VIOLET, rotRadial(a) + Math.PI / 2, { jit: 0, ao: 0 });
  }

  // eight pillars
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 2 + (22.5 + i * 45) * Math.PI / 180;
    const x = cx + Math.cos(a) * 28, z = cz + Math.sin(a) * 28;
    const g0 = groundMin(world, x, z, 1.5, 1.5);
    const top = world.heightAt(x, z) + 12 + ((i * 7) % 5) * 1.0;
    const owner = `landmarks:spire-pillar-${i}`;
    stone.cyl(x, g0 - 0.6, z, 2.3, 1.9, 1.9 + (world.heightAt(x, z) - g0 + 0.6), PAL.gloamLo, 8);
    stone.cyl(x, world.heightAt(x, z) + 1.3, z, 1.55, 1.3, top - 0.9 - (world.heightAt(x, z) + 1.3), i & 1 ? PAL.gloam : PAL.gloamLo, 8);
    stone.cyl(x, top - 6, z, 1.62, 1.62, 0.5, PAL.gloamHi, 8, 0, { jit: 0.02 });
    world.addBox({ minX: x - 1.6, maxX: x + 1.6, minZ: z - 1.6, maxZ: z + 1.6, minY: g0 - 0.6, maxY: top - 0.9, tag: "climbable", owner });
    stone.box(x, top - 0.9, z, 4.4, 0.9, 4.4, PAL.gloam);
    stone.box(x, top - 0.25, z, 4.7, 0.25, 4.7, PAL.gloamHi, 0, { jit: 0.02 });
    world.addBox({ minX: x - 2.2, maxX: x + 2.2, minZ: z - 2.2, maxZ: z + 2.2, minY: top - 0.9, maxY: top, tag: "climbable", owner: owner + "-cap" });
    // rune slit toward the arena center
    const ix = -Math.cos(a), iz = -Math.sin(a);
    violet.box(x + ix * 1.5, top - 8, z + iz * 1.5, 0.3, 3.2, 0.12, "#d8bcf2", rotRadial(a), { jit: 0, ao: 0 });
    // two ledges staggered up the shaft
    const ledges: [number, number, number][] = [
      [x + ix * 2.8, z + iz * 2.8, top - 9.5], [x + (-Math.sin(a)) * 2.8 + ix * 0.4, z + Math.cos(a) * 2.8 + iz * 0.4, top - 5.0],
    ];
    for (const [lx, lz, ly] of ledges) {
      if (ly < world.heightAt(lx, lz) + 2) continue;
      stone.box(lx, ly - 0.7, lz, 2.6, 0.7, 2.6, PAL.gloamHi, 0, { ao: 0.05 });
      stone.box(lx, ly - 0.7 - 0.9, lz, 1.2, 0.9, 1.2, PAL.gloamLo);
      world.addBox({ minX: lx - 1.3, maxX: lx + 1.3, minZ: lz - 1.3, maxZ: lz + 1.3, minY: ly - 0.7, maxY: ly, tag: "climbable", owner: owner + "-ledge" });
    }
    if (i === 1 || i === 5) reg.cluster({ x, y: top + 0.9, z, n: 5, spread: 1.4 });
  }

  // braziers on the rim
  for (let k = 0; k < 16; k++) {
    const a = (k * 22.5 + 11.25) * Math.PI / 180;
    const x = cx + Math.cos(a) * 32, z = cz + Math.sin(a) * 32;
    if (Math.abs(x - cx) < 9 && z < tz + 9) continue;
    const gh = world.heightAt(x, z);
    stone.cyl(x, gh - 0.4, z, 0.55, 0.38, 1.6, PAL.gloamLo, 6);
    stone.cyl(x, gh + 1.1, z, 0.5, 0.95, 0.6, PAL.gloam, 8);
    violet.cone(x, gh + 1.6, z, 0.62, 1.5, VIOLET, 6, 0, { jit: 0.03, ao: 0 });
    violet.cone(x, gh + 1.6, z, 0.34, 2.1, "#d8bcf2", 5, 0.4, { jit: 0, ao: 0 });
  }

  // fallen blocks, kept out of the middle
  const blockDeg = [0, 45, 135, 180, 225, 315];
  blockDeg.forEach((d, i) => {
    const a = d * Math.PI / 180 + 0.12;
    const r = 24.5 + rnd() * 2.5;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const w = 2.2 + rnd() * 1.1, dd = 2.0 + rnd() * 1.1, h = 1.1 + rnd() * 0.7;
    solidBox(world, stone, `landmarks:spire-block-${i}`, x, z, w, dd, world.heightAt(x, z) + h, i & 1 ? PAL.gloam : PAL.gloamLo, "solid");
    stone.box(x + 1.5, world.heightAt(x + 1.5, z + 1.2) - 0.3, z + 1.2, 1.1, 0.8, 0.9, PAL.gloamLo, rnd() * 3, { rz: 0.3, rx: 0.15 });
  });

  // lore stone at the south entrance
  const lx = cx, lz = cz + 30, lg = world.heightAt(lx, lz);
  stone.box(lx, lg - 0.4, lz, 2.2, 0.8, 1.3, PAL.gloamLo);
  stone.box(lx, lg + 0.3, lz, 1.5, 2.3, 0.5, PAL.gloam);
  stone.prism(lx, lg + 2.6, lz, 1.5, 0.6, 0.5, PAL.gloamHi);
  for (let k = 0; k < 4; k++) violet.box(lx, lg + 0.9 + k * 0.42, lz + 0.26, 0.9 - (k & 1) * 0.4, 0.07, 0.04, "#d8bcf2", 0, { jit: 0, ao: 0 });
  world.addBox({ minX: lx - 1.0, maxX: lx + 1.0, minZ: lz - 0.6, maxZ: lz + 0.6, minY: lg - 0.4, maxY: lg + 2.4, tag: "solid", owner: "landmarks:spire-lore" });
  reg.lore({
    id: "lore-spire", x: lx, z: lz + 1.6, y: lg, yaw: 0, title: "The Sleeper's Stair",
    text: "The Gloam does not die. It sleeps, and it dreams of an island with no light left in it. Four beacons were lit on four hills to keep that dream quiet, and while they burned the mountain stayed still. Relight them, Wren, and the Spire will have nothing left to hide behind.",
  });

  // ---- crystal heart ---------------------------------------------------------------------------------------------------
  crystal.ball(0, 0, 0, 2.2, "#c9a6ec", 1.75, 0, 0.5, { jit: 0.02, ao: 0 });
  for (let k = 0; k < 5; k++) {
    const a = k * TAU / 5;
    crystal.ball(Math.cos(a) * 3.4, Math.sin(k * 2.1) * 1.8, Math.sin(a) * 3.4, 0.55 + (k & 1) * 0.25, "#b48fda", 1.9, 0, a, { jit: 0.03, ao: 0 });
  }
  const crystalY = tb + 57;

  // ---- barrier dome ----------------------------------------------------------------------------------------------------
  const domeY = gy - 3;
  const domeGroup = new THREE.Group();
  domeGroup.position.set(cx, domeY, cz);
  const hexTex = env.own(hexTexture());
  const domeMat = look.toon({
    color: "#5b3a6e", emissive: "#a47cc6", emissiveIntensity: 0.5, transparent: true, opacity: 0.32, side: THREE.DoubleSide, map: hexTex,
  }) as Lam;
  const domeGeo = env.own(new THREE.SphereGeometry(BARRIER_R, 56, 28, 0, TAU, 0, Math.PI / 2));
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.castShadow = dome.receiveShadow = false;
  domeGroup.add(dome);
  for (let c = 0; c < 13; c++) {
    let th = rnd() * TAU, ph = 0.15 + rnd() * 1.05;
    let dth = (rnd() - 0.5) * 0.1, dph = 0.05 + rnd() * 0.05;
    const pt = (t: number, p: number) => [Math.sin(p) * Math.cos(t) * (BARRIER_R + 0.2), Math.cos(p) * (BARRIER_R + 0.2), Math.sin(p) * Math.sin(t) * (BARRIER_R + 0.2)];
    for (let s = 0; s < 6; s++) {
      const a = pt(th, ph);
      dth += (rnd() - 0.5) * 0.06; dph += (rnd() - 0.5) * 0.04;
      th += dth; ph = clamp(ph + dph, 0.05, 1.5);
      const b = pt(th, ph);
      cracks.beam(a[0], a[1], a[2], b[0], b[1], b[2], 0.26 - s * 0.02, "#f0e2ff", { jit: 0, ao: 0 });
    }
  }
  const crackMat = glowMat(look, "#e6d4fb", 0.6, { transparent: true, opacity: 0.85 }) as Lam;
  const crackMesh = cracks.build(look, crackMat, "spire-cracks");
  crackMesh.castShadow = crackMesh.receiveShadow = false;
  env.own(crackMesh.geometry);
  domeGroup.add(crackMesh);
  group.add(domeGroup);

  // fragments: fixed pool of shards, positions are closed-form in time since the fall began
  const fragGeo = env.own(new THREE.IcosahedronGeometry(1, 0));
  const fragMat = look.toon({ color: "#7d56a1", emissive: "#b894e0", emissiveIntensity: 0.9, transparent: true, opacity: 0.8, side: THREE.DoubleSide }) as Lam;
  const frags = new THREE.InstancedMesh(fragGeo, fragMat, FRAG_N);
  frags.frustumCulled = false;
  frags.visible = false;
  env.own(frags);
  const fP = new Float32Array(FRAG_N * 3), fV = new Float32Array(FRAG_N * 3), fR = new Float32Array(FRAG_N * 3), fS = new Float32Array(FRAG_N * 3), fSize = new Float32Array(FRAG_N);
  for (let i = 0; i < FRAG_N; i++) {
    const th = rnd() * TAU, ph = 0.2 + rnd() * 1.2;
    const sx = Math.sin(ph) * Math.cos(th), sz = Math.sin(ph) * Math.sin(th);
    fP[i * 3] = cx + sx * BARRIER_R; fP[i * 3 + 1] = domeY + Math.cos(ph) * BARRIER_R; fP[i * 3 + 2] = cz + sz * BARRIER_R;
    fV[i * 3] = sx * (1 + rnd() * 3); fV[i * 3 + 1] = rnd() * 2; fV[i * 3 + 2] = sz * (1 + rnd() * 3);
    fR[i * 3] = rnd() * 3; fR[i * 3 + 1] = rnd() * 3; fR[i * 3 + 2] = rnd() * 3;
    fS[i * 3] = (rnd() - 0.5) * 6; fS[i * 3 + 1] = (rnd() - 0.5) * 6; fS[i * 3 + 2] = (rnd() - 0.5) * 6;
    fSize[i] = 1.2 + rnd() * 1.8;
  }
  group.add(frags);
  const mt = new THREE.Matrix4(), qt = new THREE.Quaternion(), et = new THREE.Euler(), pt3 = new THREE.Vector3(), st3 = new THREE.Vector3();

  // barrier colliders
  const barrierIds: number[] = [];
  for (let i = 0; i < BARRIER_N; i++) {
    const a = i / BARRIER_N * TAU;
    const x = cx + Math.cos(a) * BARRIER_R, z = cz + Math.sin(a) * BARRIER_R;
    barrierIds.push(world.addBox({
      minX: x - 2.2, maxX: x + 2.2, minZ: z - 2.2, maxZ: z + 2.2,
      minY: groundMin(world, x, z, 2.2, 2.2) - 3, maxY: gy + 50, tag: "barrier", owner: `landmarks:barrier-${i}`,
    }));
  }

  // ---- rim ring (boss) -------------------------------------------------------------------------------------------------
  rim.torus(cx, gy + 0.3, cz, 32.6, 0.32, "#c9a6ec", Math.PI / 2, 0, 0, 96, 6);
  rim.torus(cx, gy + 0.3, cz, 31.4, 0.12, "#c9a6ec", Math.PI / 2, 0, 0, 96, 4);
  const rimMat = glowMat(look, "#b58be0", 0.1) as Lam;
  const rimMesh = rim.build(look, rimMat, "spire-rim");
  rimMesh.castShadow = rimMesh.receiveShadow = false;
  env.own(rimMesh.geometry);
  group.add(rimMesh);

  // ---- main meshes ---------------------------------------------------------------------------------------------------
  const stoneMesh = stone.build(look, undefined, "spire-stone");
  env.own(stoneMesh.geometry);
  group.add(stoneMesh);
  const violetMat = glowMat(look, VIOLET, 1.0) as Lam;
  const violetMesh = violet.build(look, violetMat, "spire-runes");
  violetMesh.castShadow = false;
  env.own(violetMesh.geometry);
  group.add(violetMesh);
  const crystalMat = glowMat(look, "#c49bf0", 1.5) as Lam;
  const crystalMesh = crystal.build(look, crystalMat, "spire-crystal");
  crystalMesh.castShadow = false;
  crystalMesh.position.set(cx, crystalY, tz);
  env.own(crystalMesh.geometry);
  group.add(crystalMesh);
  const halo = haloSprite(env.glow, "#a47cc6", 22);
  halo.position.set(cx, crystalY, tz);
  env.own(halo.material);
  group.add(halo);

  // ---- mountain path: lantern posts and cairns ------------------------------------------------------------------------
  const a0 = Math.atan2(100 - cz, 60 - cx);
  const pathStone = new Mesher(21);
  const flames = new Mesher(22);
  const posts: [number, number][] = [];
  for (let i = 0; i < POST_N; i++) {
    const s = i / (POST_N - 1);
    const r = lerp(120, 40, s), a = a0 + s * Math.PI * 1.4;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    posts.push([x, z]);
    const g = groundMin(world, x, z, 0.3, 0.3);
    pathStone.cyl(x, g - 0.5, z, 0.55, 0.4, 0.9, PAL.rockLo, 6);
    pathStone.cyl(x, g + 0.3, z, 0.13, 0.1, 3.0, PAL.woodLo, 5);
    pathStone.box(x, g + 3.0, z, 0.62, 0.1, 0.62, PAL.ashLo);
    for (const [ox, oz] of [[-0.27, -0.27], [0.27, -0.27], [-0.27, 0.27], [0.27, 0.27]]) pathStone.box(x + ox, g + 3.1, z + oz, 0.07, 0.8, 0.07, PAL.ashLo);
    pathStone.cone(x, g + 3.9, z, 0.5, 0.45, PAL.ashLo, 4, Math.PI / 4);
    flames.cone(x, g + 3.12, z, 0.2, 0.62, "#ffffff", 5, 0, { jit: 0, ao: 0 });
  }
  for (const [x, z] of [[60, 60], [30, -10]] as const) {
    const g = world.heightAt(x, z);
    const n = 5;
    for (let k = 0; k < n; k++) {
      const rr = 0.85 - k * 0.12;
      pathStone.ball(x + (rnd() - 0.5) * 0.15, g + 0.15 + k * 0.42, z + (rnd() - 0.5) * 0.15, rr, k % 2 ? PAL.rock : PAL.rockHi, 0.55, 1, rnd() * 3, { sx: 1.1 });
    }
    pathStone.ball(x - 1.2, g + 0.1, z + 0.5, 0.45, PAL.rockLo, 0.6, 1);
  }
  const pathMesh = pathStone.build(look, undefined, "spire-path");
  env.own(pathMesh.geometry);
  group.add(pathMesh);
  const COLD = "#8a82a7", WARM = "#ffc46a";
  const flameMat = glowMat(look, COLD, 0.7) as Lam;
  const flameMesh = flames.build(look, flameMat, "spire-flames");
  flameMesh.castShadow = flameMesh.receiveShadow = false;
  env.own(flameMesh.geometry);
  group.add(flameMesh);

  // ---- state and animation -----------------------------------------------------------------------------------------------
  let pathLit = false, awake = false, isDefeated = false, flareT = 0, dropT = -1;
  const finishDrop = () => {
    dropT = -1;
    domeGroup.visible = false;
    frags.visible = false;
    domeGroup.position.set(cx, domeY, cz);
  };
  const paintGold = (on: boolean) => {
    const v = on ? GOLD : VIOLET;
    violetMat.color.set(v); violetMat.emissive.set(v);
    const c = on ? "#ffe4a0" : "#c49bf0";
    crystalMat.color.set(c); crystalMat.emissive.set(c);
    halo.material.color.set(on ? "#e8c766" : "#a47cc6");
  };
  const paintPath = () => {
    const c = pathLit ? WARM : COLD;
    flameMat.color.set(c); flameMat.emissive.set(c);
  };

  reg.anim(({ time, dt }) => {
    hexTex.offset.set(time * 0.012, time * 0.03);
    crystalMesh.position.y = crystalY + Math.sin(time * 0.9) * 0.55;
    crystalMesh.rotation.y = time * 0.25;
    halo.position.y = crystalMesh.position.y;
    const hs = 22 * (1 + Math.sin(time * 1.7) * 0.07);
    halo.scale.set(hs, hs, 1);
    flameMat.emissiveIntensity = (pathLit ? 1.8 : 0.7) * (0.9 + Math.sin(time * 9.3) * 0.06 + Math.sin(time * 5.1) * 0.04);

    if (flareT > 0) flareT = Math.max(0, flareT - dt);
    if (isDefeated) rimMesh.visible = false;
    else {
      rimMesh.visible = true;
      const boost = flareT * 3.2;
      rimMat.emissiveIntensity = awake ? 1.2 + Math.sin(time * 4.2) * 0.45 + boost : 0.1 + boost;
    }

    if (dropT >= 0) {
      dropT += dt;
      const t = dropT;
      if (t >= DROP_TIME) { finishDrop(); return; }
      const amp = 0.45 * smooth(t / 0.4) * (1 - smooth((t - 1.2) / 0.9));
      domeGroup.position.set(cx + Math.sin(t * 57) * amp, domeY, cz + Math.cos(t * 49) * amp);
      crackMat.emissiveIntensity = 0.6 + 3.2 * smooth(t / 1.0) * (1 - smooth((t - 1.6) / 0.9));
      domeMat.emissiveIntensity = 0.5 + 1.6 * smooth(t / 1.1);
      domeMat.opacity = t < 1.1 ? 0.32 + 0.12 * Math.sin(t * 38) : 0.32 * (1 - smooth((t - 1.1) / 1.2));
      crackMat.opacity = 0.85 * (1 - smooth((t - 1.9) / 0.6));
      if (t >= 0.9) {
        frags.visible = true;
        const ft = t - 0.9;
        for (let i = 0; i < FRAG_N; i++) {
          const k = i * 3;
          pt3.set(fP[k] + fV[k] * ft, fP[k + 1] + fV[k + 1] * ft - 0.5 * 16 * ft * ft, fP[k + 2] + fV[k + 2] * ft);
          et.set(fR[k] + fS[k] * ft, fR[k + 1] + fS[k + 1] * ft, fR[k + 2] + fS[k + 2] * ft);
          qt.setFromEuler(et);
          const sc = fSize[i] * (1 - smooth((ft - 0.9) / 0.7));
          st3.set(sc, sc * 0.3, sc * 0.8);
          mt.compose(pt3, qt, st3);
          frags.setMatrixAt(i, mt);
        }
        frags.instanceMatrix.needsUpdate = true;
      }
    }
  });

  const handle: SpireHandle = {
    info: { x: cx, z: cz, radius: 140 },
    arena: { x: cx, y: gy, z: cz, r: 30 },
    barrierDown: false,
    dropBarrier(animated: boolean) {
      if (handle.barrierDown) return;
      handle.barrierDown = true;
      for (const id of barrierIds) world.removeBox(id);
      barrierIds.length = 0;
      if (animated) { dropT = 0; domeGroup.visible = true; }
      else finishDrop();
    },
    lightPath(on: boolean) { pathLit = on; paintPath(); },
    bossAwake(on: boolean) { awake = on; if (!isDefeated) rimMat.emissiveIntensity = on ? 1.2 : 0.1; },
    flare() { flareT = 1; },
    defeated(on: boolean) { isDefeated = on; paintGold(on); rimMesh.visible = !on; },
  };
  paintPath();
  return handle;
}
