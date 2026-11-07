import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { TeamData } from "./contracts";
import { canvas2d, canvasTexture, hashStr, seeded, shade } from "./arena-tex";

// Seating bowl around a rounded-rectangle footprint: lower bowl, suite ring, upper bowl, back wall, ceiling truss.
// Fans are one InstancedMesh per tier, animated in the vertex shader (bob, stand, arm raise, clap, hop, phone flash).

export const NO_REFLECT = 2;

const LOWER = { hx: 18.4, hz: 11.4, r: 5, rows: 22, depth: 0.9, rise: 0.42, y0: 0.5 };
const SUITE = { o: 20.4, h: 3.6 };
const UPPER = { rows: 16, depth: 0.86, rise: 0.6 };
const SEAT_W = 0.56;
const STREET = ["#111214", "#1c1d22", "#2a2c33", "#3b3f48", "#1d2840", "#2c3e5c", "#4a4f57", "#5b4636", "#3d4a35", "#5a1f24", "#6d6f73", "#22252b"];

/** Bowl surface height (m) at a floor point; cameras placed in the stands should stay above it. */
export function bowlHeightAt(x: number, z: number): number {
  const o = offsetOf(x, z);
  if (o < 0) return 0;
  const lowerEnd = LOWER.rows * LOWER.depth;
  if (o < lowerEnd) return LOWER.y0 + Math.floor(o / LOWER.depth) * LOWER.rise;
  const top = LOWER.y0 + LOWER.rows * LOWER.rise;
  if (o < SUITE.o + 1) return top + SUITE.h;
  return top + SUITE.h + 0.8 + Math.floor((o - SUITE.o - 1) / UPPER.depth) * UPPER.rise;
}

function offsetOf(x: number, z: number) {
  const ax = Math.abs(x) - (LOWER.hx - LOWER.r);
  const az = Math.abs(z) - (LOWER.hz - LOWER.r);
  if (ax > 0 && az > 0) return Math.hypot(ax, az) - LOWER.r;
  return Math.max(Math.abs(x) - LOWER.hx, Math.abs(z) - LOWER.hz);
}

interface PathPt {
  x: number;
  z: number;
  nx: number;
  nz: number;
  s: number;
}

/** Rounded-rect loop at offset o, inward normals. */
function loop(o: number, cornerSegs = 10): PathPt[] {
  const ax = LOWER.hx + o;
  const az = LOWER.hz + o;
  const r = LOWER.r + o;
  const cx = ax - r;
  const cz = az - r;
  const pts: PathPt[] = [];
  const corners: [number, number, number][] = [[cx, cz, 0], [-cx, cz, Math.PI / 2], [-cx, -cz, Math.PI], [cx, -cz, (3 * Math.PI) / 2]];
  for (const [ox, oz, a0] of corners)
    for (let i = 0; i <= cornerSegs; i++) {
      const a = a0 + (i / cornerSegs) * (Math.PI / 2);
      const c = Math.cos(a);
      const s = Math.sin(a);
      pts.push({ x: ox + c * r, z: oz + s * r, nx: -c, nz: -s, s: 0 });
    }
  pts.push({ ...pts[0] });
  for (let i = 1; i < pts.length; i++) pts[i].s = pts[i - 1].s + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return pts;
}

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  /** Wall along loop at offset o from y0 to y1, facing inward. u in seats, v in meters. */
  wall(o: number, y0: number, y1: number, uScale = 1 / SEAT_W, vScale = 1) {
    const pts = loop(o);
    const base = this.pos.length / 3;
    for (const p of pts) {
      this.pos.push(p.x, y0, p.z, p.x, y1, p.z);
      this.nor.push(p.nx, 0, p.nz, p.nx, 0, p.nz);
      this.uv.push(p.s * uScale, 0, p.s * uScale, (y1 - y0) * vScale);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + i * 2;
      this.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  /** Horizontal tread from offset o0 to o1 at height y. */
  tread(o0: number, o1: number, y: number) {
    const a = loop(o0);
    const b = loop(o1);
    const base = this.pos.length / 3;
    for (let i = 0; i < a.length; i++) {
      this.pos.push(a[i].x, y, a[i].z, b[i].x, y, b[i].z);
      this.nor.push(0, 1, 0, 0, 1, 0);
      this.uv.push(a[i].s / SEAT_W, 0, a[i].s / SEAT_W, o1 - o0);
    }
    for (let i = 0; i < a.length - 1; i++) {
      const k = base + i * 2;
      this.idx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3);
    }
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Seated fan, facing local +z, origin on the tread at the seat. Attribute `part`: 0 legs, 1 shirt (torso + shoulder
 * yoke), 2 skin (neck + head), 2.25 hair / cap, 3 armL, 4 armR. A T-shirt silhouette (broad rounded shoulders, arms
 * hanging close to the body) reads as a person at 3-6 px; `far` is the cheaper set for the upper tier.
 */
function fanGeometry(far = false): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, part: number, x: number, y: number, z: number) => {
    g.translate(x, y, z);
    const n = g.attributes.position.count;
    g.setAttribute("part", new THREE.Float32BufferAttribute(new Array(n).fill(part), 1));
    const shadeA = new Float32Array(n);
    for (let i = 0; i < n; i++) shadeA[i] = 0.72 + 0.28 * Math.min(1, Math.max(0, g.attributes.position.getY(i) / 1.4));
    g.setAttribute("ao", new THREE.BufferAttribute(shadeA, 1));
    g.deleteAttribute("uv");
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  // thighs: one rounded slab across both legs
  const legs = new THREE.CapsuleGeometry(0.09, 0.26, 1, far ? 4 : 6);
  legs.rotateX(Math.PI / 2);
  legs.scale(1.9, 1, 1);
  add(legs, 0, 0, 0.5, 0.14);
  // torso: capsule tapering from the lats to the waist, flattened front to back
  const torso = new THREE.CapsuleGeometry(0.15, 0.28, far ? 1 : 2, far ? 6 : 10);
  {
    const a = torso.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const y = a.getY(i);
      const k = 1 + Math.max(0, y) * 0.75 - Math.max(0, -y - 0.1) * 0.4;
      a.setX(i, a.getX(i) * k);
    }
    torso.computeVertexNormals();
  }
  torso.scale(1, 1, 0.64);
  add(torso, 1, 0, 0.8, -0.06);
  // shoulder yoke: a sideways capsule gives the round deltoid caps and the slope up to the neck
  const yoke = new THREE.CapsuleGeometry(0.068, 0.3, 1, far ? 4 : 6);
  yoke.rotateZ(Math.PI / 2);
  yoke.scale(1, 0.9, 0.95);
  add(yoke, 1, 0, 1.0, -0.06);
  const neck = new THREE.CylinderGeometry(0.045, 0.05, 0.1, far ? 4 : 6);
  add(neck, 2, 0, 1.1, -0.05);
  const head = new THREE.SphereGeometry(0.1, far ? 6 : 10, far ? 4 : 8);
  head.scale(0.92, 1.12, 1.0);
  add(head, 2, 0, 1.25, -0.04);
  // hair / cap: top-back shell over the skull, hairline tilted up at the forehead
  const hair = new THREE.SphereGeometry(0.106, far ? 6 : 10, far ? 3 : 5, 0, Math.PI * 2, 0, Math.PI * 0.52);
  hair.scale(0.94, 1.1, 1.02);
  hair.rotateX(-0.42);
  add(hair, 2.25, 0, 1.262, -0.05);
  // arms hang from the shoulder pivot (y 1.0) close to the ribs: tapered tubes, upper arm thicker than the wrist
  const arm = () => new THREE.CylinderGeometry(0.058, 0.044, 0.46, far ? 4 : 6, 1, false);
  add(arm(), 3, -0.228, 0.78, -0.05);
  add(arm(), 4, 0.228, 0.78, -0.05);
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return g;
}

const CROWD_VERT_PARS = /* glsl */ `
attribute float part;
attribute float ao;
attribute vec4 aFan; // seed, team (0 home 1 away 0.5 neutral), energy, flashy
attribute vec3 aShirt;
uniform float uTime; uniform float uHype; uniform float uCheer; uniform float uCheerTeam; uniform float uChant;
uniform float uAnim; uniform float uGroan; uniform vec3 uBall;
varying vec3 vFanCol; varying float vFlash; varying float vAo; varying float vSpill; varying float vNear; varying float vHand;
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
`;

const CROWD_BEGIN = /* glsl */ `
vec3 transformed = vec3(position);
{
  float seed = aFan.x; float team = aFan.y; float energy = aFan.z;
  float mine = team < 0.25 ? 1.0 - uCheerTeam : team > 0.75 ? uCheerTeam : 0.5;
  float cheer = uCheer * mix(0.15, 1.0, mine) * energy * uAnim;
  float groan = uGroan * (1.0 - mine) * energy * uAnim;
  float t = uTime + seed * 17.0;
  float hype = uHype * uAnim;
  float stand = clamp(cheer * 1.4 + step(0.78 - hype * 0.35, energy) * hype * 0.9 + uChant * 0.6 * step(team, 0.25) * energy, 0.0, 1.0);
  float hop = cheer * abs(sin(t * 8.5)) * 0.13;
  float bob = sin(t * (1.3 + energy)) * 0.015 * (0.4 + hype) * uAnim;
  // per-fan resting pose: 0 hands on thighs, 1 elbows on knees (leaning in), 2 arms folded, 3 sat back, arms down
  float pk = h1(seed * 4.7);
  float pose = pk < 0.42 ? 0.0 : pk < 0.66 ? 1.0 : pk < 0.82 ? 2.0 : 3.0;
  // an occasional idle clap among the livelier fans, at their own moments
  float idleClap = step(0.82, h1(floor(uTime * 0.22 + seed * 3.0) + seed)) * step(0.55, energy) * uAnim;
  float lean = (pose == 1.0 ? 0.26 : pose == 3.0 ? -0.1 : 0.04 + h1(seed * 6.1) * 0.08) * (1.0 - stand);
  vec3 objN = objectNormal;
  if (part > 2.5) {
    float sideS = part > 3.5 ? 1.0 : -1.0;
    vec3 piv = vec3(0.228 * sideS, 1.0, -0.05);
    float raise = clamp(cheer * 1.2 + hype * 0.25 * step(0.6, energy), 0.0, 1.0);
    float pump = sin(t * 7.0 + sideS * 0.6) * 0.35 * raise;
    float clap = max(uChant * step(team, 0.25), idleClap) * (1.0 - raise);
    // resting arms stay tucked against the body (hands in the lap): from the broadcast angle they read as part of
    // the silhouette, not as rods
    float restP = pose == 0.0 ? -0.36 : pose == 1.0 ? -0.78 : pose == 2.0 ? -1.2 : -0.1;
    float restR = pose == 2.0 ? -sideS * 0.62 : pose == 3.0 ? sideS * 0.04 : -sideS * 0.1;
    restP = mix(restP, -0.1, stand);
    restR = mix(restR, sideS * 0.03, stand);
    float pitch = mix(restP, -2.75 + pump, raise);
    pitch = mix(pitch, -1.3 + sin(uTime * 12.566 + seed) * 0.14, clap);
    pitch = mix(pitch, -2.4, groan * step(0.5, energy));
    float roll = mix(restR, sideS * 0.38, raise);
    roll = mix(roll, -sideS * 0.42, clap) + sideS * groan * 0.25;
    mat3 R = rotZ(roll) * rotX(pitch);
    transformed = piv + R * (transformed - piv);
    objectNormal = R * objN;
  }
  if (part > 0.5) {
    // upper body leans about the hips
    vec3 hip = vec3(0.0, 0.62, -0.06);
    mat3 L = rotX(lean);
    transformed = hip + L * (transformed - hip);
    objectNormal = L * objectNormal;
  }
  #ifdef USE_INSTANCING
  {
    mat3 IR = mat3(instanceMatrix);
    vec3 lb = transpose(IR) * (uBall - instanceMatrix[3].xyz);
    float yaw = clamp(atan(lb.x, lb.z), -1.1, 1.1) * uAnim;
    float k = part > 1.5 && part < 2.5 ? 1.0 : part > 0.5 ? 0.3 : 0.0;
    float cy = cos(yaw * k), sy = sin(yaw * k);
    transformed.xz = vec2(cy * transformed.x + sy * transformed.z, -sy * transformed.x + cy * transformed.z);
    objectNormal.xz = vec2(cy * objectNormal.x + sy * objectNormal.z, -sy * objectNormal.x + cy * objectNormal.z);
  }
  #endif
  if (part > 0.5) { transformed.y += stand * 0.42; transformed.z -= stand * 0.08; }
  else { transformed.y += stand * 0.24; transformed.z -= stand * 0.12; }
  transformed.y += hop + bob;
  transformed.x += sin(t * 0.7) * 0.02 * (1.0 + hype) * uAnim;
  vec3 skin = mix(vec3(0.94, 0.76, 0.62), vec3(0.24, 0.15, 0.10), h1(seed * 3.1));
  vec3 pants = mix(vec3(0.05, 0.05, 0.07), vec3(0.20, 0.25, 0.36), h1(seed * 5.7));
  float hk = h1(seed * 2.3);
  vec3 hair = hk < 0.1 ? skin * 0.92 : hk < 0.24 ? aShirt * 0.8 : hk < 0.3 ? vec3(0.55, 0.53, 0.5) : mix(vec3(0.025, 0.02, 0.018), vec3(0.32, 0.2, 0.09), hk * hk);
  bool sleeve = h1(seed * 9.3) > 0.68; // short sleeves: forearm skin; long sleeves / hoodies: shirt color
  vFanCol = part < 0.5 ? pants : part < 1.5 ? aShirt : part < 2.1 ? skin : part < 2.5 ? hair : (sleeve && position.y < 0.84 ? skin * 0.8 : aShirt * 0.88);
  vAo = ao * (part > 2.1 && part < 2.5 ? 0.9 : 1.0);
  float fl = step(1.0 - 0.0035 * aFan.w * (0.2 + hype * 2.0 + cheer * 6.0), h1(floor(uTime * 9.0) + seed * 101.0));
  vFlash = fl * step(2.5, part) * step(part, 3.5) * uAnim;
  vHand = clamp((1.02 - position.y) / 0.5, 0.0, 1.0);
  vec4 wp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  wp = instanceMatrix * wp;
  #endif
  wp = modelMatrix * wp;
  vNear = smoothstep(2.5, 5.0, distance(wp.xyz, cameraPosition));
  #ifdef USE_INSTANCING
  // whole fans that would sit in the bottom of a raised shot (near-side rows and the courtside row under the
  // broadcast rig) are culled as a unit (no dither speckle): collapse the instance to its seat point
  {
    vec3 ip = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
    vec2 cxz = cameraPosition.xz;
    float d = distance(ip.xz, cxz);
    float sameSide = step(0.0, ip.z * cxz.y) * step(abs(ip.z), abs(cxz.y) + 0.5);
    float below = step(1.6, cameraPosition.y - ip.y);
    float close = step(d, 9.0);
    vec4 cl = projectionMatrix * viewMatrix * vec4(ip + vec3(0.0, 1.3, 0.0), 1.0);
    float lowEdge = step(0.0, cl.w) * step(cl.y / max(cl.w, 1e-3), -0.38) * step(d, 17.5) * step(0.8, cameraPosition.y - ip.y);
    if (sameSide * below * close > 0.5 || lowEdge > 0.5) {
      vNear = 1.0;
      wp = vec4(ip, 1.0);
      transformed = vec3(0.0);
    }
  }
  #endif
  vSpill = 0.62 - smoothstep(12.0, 34.0, length(wp.xz)) * 0.34;
}
`;

const CROWD_FRAG_PARS = /* glsl */ `
varying vec3 vFanCol; varying float vFlash; varying float vAo; varying float vSpill; varying float vNear; varying float vHand;
`;

export interface Bowl {
  readonly group: THREE.Group;
  setTeams(home: TeamData, away: TeamData): void;
  setDensity(d: number, anim: boolean): void;
  setHaze(on: boolean): void;
  update(dt: number, time: number, ball: THREE.Vector3 | null): void;
  /** 0..1 sustained excitement. */
  hype: number;
  /** Burst: team side whose fans erupt (0 home, 1 away), strength 0..1. */
  cheer(team: 0 | 1, strength: number): void;
  groan(strength: number): void;
  chant: number;
  readonly fans: number;
  dispose(): void;
}

export function createBowl(home: TeamData, away: TeamData, density: number, anim: boolean, ribbonMat: THREE.Material | null): Bowl {
  const group = new THREE.Group();
  group.name = "bowl";
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];

  const [sc, sctx] = canvas2d(128, 128);
  const seatTex = canvasTexture(sc, true, 8);
  seatTex.wrapS = seatTex.wrapT = THREE.RepeatWrapping;
  texs.push(seatTex);
  function drawSeats(t: TeamData) {
    sctx.fillStyle = "#16171b";
    sctx.fillRect(0, 0, 128, 128);
    const seat = shade(t.primary, -0.55);
    sctx.fillStyle = seat;
    sctx.beginPath();
    sctx.roundRect(10, 8, 108, 112, 14);
    sctx.fill();
    sctx.fillStyle = shade(seat, 0.12);
    sctx.fillRect(16, 12, 96, 10);
    sctx.fillStyle = "rgba(0,0,0,0.35)";
    sctx.fillRect(10, 96, 108, 24);
    seatTex.needsUpdate = true;
  }
  drawSeats(home);

  const spill = (sh: { fragmentShader: string; vertexShader: string }) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vSpill;")
      .replace("#include <project_vertex>", "#include <project_vertex>\n{ vec4 sw = modelMatrix * vec4(transformed, 1.0); vSpill = 0.7 - smoothstep(12.0, 40.0, length(sw.xz)) * 0.4; }");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vSpill;")
      .replace("#include <opaque_fragment>", "outgoingLight *= vSpill;\n#include <opaque_fragment>");
  };
  const riserMat = new THREE.MeshLambertMaterial({ map: seatTex });
  riserMat.onBeforeCompile = spill;
  const treadMat = new THREE.MeshLambertMaterial({ color: "#1b1c21" });
  treadMat.onBeforeCompile = spill;
  const wallMat = new THREE.MeshLambertMaterial({ color: "#0d0e12" });
  wallMat.onBeforeCompile = spill;
  mats.push(riserMat, treadMat, wallMat);

  const lowerB = new Builder();
  const lowerT = new Builder();
  if (!ribbonMat) lowerB.wall(-0.05, 0, LOWER.y0, 1 / SEAT_W, 1);
  for (let i = 0; i < LOWER.rows; i++) {
    const o = i * LOWER.depth;
    const y = LOWER.y0 + i * LOWER.rise;
    lowerT.tread(o, o + LOWER.depth, y);
    if (i > 0) lowerB.wall(o, y - LOWER.rise, y, 1 / SEAT_W, 1 / LOWER.rise);
  }
  const lowerTop = LOWER.y0 + (LOWER.rows - 1) * LOWER.rise;
  const upperB = new Builder();
  const upperT = new Builder();
  const fasciaO = LOWER.rows * LOWER.depth;
  const wallB = new Builder();
  wallB.wall(fasciaO, lowerTop, lowerTop + 1.1);
  const suiteY0 = lowerTop + 1.1;
  const suiteY1 = suiteY0 + SUITE.h;
  const ribbonY0 = suiteY1;
  const ribbonY1 = suiteY1 + 0.9;
  const upperO = SUITE.o + 1;
  for (let i = 0; i < UPPER.rows; i++) {
    const o = upperO + i * UPPER.depth;
    const y = ribbonY1 + 0.25 + i * UPPER.rise;
    upperT.tread(o, o + UPPER.depth, y);
    upperB.wall(o, y - (i === 0 ? 0.25 + 0.0 : UPPER.rise), y, 1 / SEAT_W, 1 / UPPER.rise);
  }
  const upperTop = ribbonY1 + 0.25 + (UPPER.rows - 1) * UPPER.rise;
  const backO = upperO + UPPER.rows * UPPER.depth;
  wallB.wall(backO, upperTop, upperTop + 7);
  wallB.wall(SUITE.o + 0.95, ribbonY1, ribbonY1 + 0.25);
  const [wc, wctx] = canvas2d(512, 128);
  wctx.fillStyle = "#07080b";
  wctx.fillRect(0, 0, 512, 128);
  const wr = seeded(4);
  for (let i = 0; i < 8; i++) {
    const lit = wr();
    const x0 = i * 64 + 3;
    const g = wctx.createLinearGradient(0, 30, 0, 100);
    if (lit > 0.3) {
      g.addColorStop(0, `rgb(${110 + lit * 60},${70 + lit * 40},${40 + lit * 20})`);
      g.addColorStop(1, `rgb(${50 + lit * 30},${30 + lit * 20},${20})`);
    } else {
      g.addColorStop(0, "#15171c");
      g.addColorStop(1, "#0b0c10");
    }
    wctx.fillStyle = g;
    wctx.fillRect(x0, 34, 58, 62);
    if (lit > 0.3) {
      wctx.fillStyle = "rgba(0,0,0,0.6)";
      const n = 1 + Math.floor(wr() * 3);
      for (let k = 0; k < n; k++) {
        const x = x0 + 8 + wr() * 40;
        wctx.beginPath();
        wctx.arc(x, 74, 3.2, 0, Math.PI * 2);
        wctx.fill();
        wctx.fillRect(x - 4.5, 78, 9, 18);
      }
    }
    wctx.fillStyle = "rgba(255,255,255,0.05)";
    wctx.fillRect(x0, 34, 58, 8);
  }
  wctx.fillStyle = "#1a1c22";
  wctx.fillRect(0, 100, 512, 4);
  const winTex = canvasTexture(wc, true, 4);
  winTex.wrapS = THREE.RepeatWrapping;
  texs.push(winTex);
  const winMat = new THREE.MeshStandardMaterial({ color: "#000000", emissive: "#ffffff", emissiveMap: winTex, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.3 });
  mats.push(winMat);
  const winB = new Builder();
  winB.wall(SUITE.o, suiteY0, suiteY1, 1 / 10, 1 / SUITE.h);
  wallB.tread(fasciaO, SUITE.o, suiteY0);
  wallB.tread(fasciaO - 0.3, upperO, suiteY1);

  const mk = (b: Builder, mat: THREE.Material, layer: number, name: string) => {
    const geo = b.geo();
    geos.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.receiveShadow = false;
    if (layer) mesh.layers.set(layer);
    group.add(mesh);
    return mesh;
  };
  mk(lowerB, riserMat, 0, "lowerRisers");
  mk(lowerT, treadMat, 0, "lowerTreads");
  mk(upperB, riserMat, NO_REFLECT, "upperRisers");
  mk(upperT, treadMat, NO_REFLECT, "upperTreads");
  mk(wallB, wallMat, NO_REFLECT, "walls");
  mk(winB, winMat, NO_REFLECT, "suites");
  if (ribbonMat) {
    const rb = new Builder();
    rb.wall(SUITE.o + 0.9, ribbonY0 + 0.05, ribbonY1 - 0.02, 1 / 24, 1 / (ribbonY1 - 0.07 - ribbonY0));
    mk(rb, ribbonMat, 0, "fasciaRibbon");
    const front = new Builder();
    front.wall(-0.05, 0.02, LOWER.y0 - 0.02, 1 / 24, 1 / (LOWER.y0 - 0.04));
    mk(front, ribbonMat, 0, "courtsideRibbon");
  }

  const ceilY = upperTop + 7;
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(140, 110), new THREE.MeshBasicMaterial({ color: "#030305" }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = ceilY;
  ceil.layers.set(NO_REFLECT);
  geos.push(ceil.geometry);
  mats.push(ceil.material as THREE.Material);
  group.add(ceil);
  const truss: THREE.BufferGeometry[] = [];
  const bank: THREE.BufferGeometry[] = [];
  for (const [ox, oz] of [[22, 15], [16, 10]]) {
    for (const sx of [-1, 1]) {
      const a = new THREE.BoxGeometry(0.5, 0.5, oz * 2);
      a.translate(sx * ox, ceilY - 3.5, 0);
      truss.push(a);
      const b = new THREE.BoxGeometry(ox * 2, 0.5, 0.5);
      b.translate(0, ceilY - 3.5, sx * oz);
      truss.push(b);
    }
  }
  const bankPos: [number, number][] = [];
  for (let i = -3; i <= 3; i++) for (const z of [-10, 10]) bankPos.push([i * 5.3, z]);
  for (const z of [-15, 15]) for (let i = -4; i <= 4; i++) bankPos.push([i * 5.2, z]);
  for (const x of [-22, 22]) for (let i = -2; i <= 2; i++) bankPos.push([x, i * 5]);
  for (const [x, z] of bankPos) {
    const b = new THREE.BoxGeometry(1.1, 0.35, 0.8);
    b.translate(x, ceilY - 3.95, z);
    bank.push(b);
  }
  const trussGeo = mergeGeometries(truss);
  const bankGeo = mergeGeometries(bank);
  for (const x of [...truss, ...bank]) x.dispose();
  geos.push(trussGeo, bankGeo);
  const trussMat = new THREE.MeshLambertMaterial({ color: "#121318" });
  const bankMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#fff2df").multiplyScalar(14) });
  mats.push(trussMat, bankMat);
  const trussMesh = new THREE.Mesh(trussGeo, trussMat);
  const bankMesh = new THREE.Mesh(bankGeo, bankMat);
  trussMesh.layers.set(NO_REFLECT);
  group.add(trussMesh, bankMesh);

  const hazeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTop: { value: ceilY - 4 }, uK: { value: 0.03 } },
    vertexShader: /* glsl */ `varying float vY; varying vec3 vN; varying vec3 vV;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y; vN = normalize(mat3(modelMatrix) * normal);
      vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `uniform float uTop; uniform float uK; varying float vY; varying vec3 vN; varying vec3 vV;
      void main() { float h = clamp(vY / uTop, 0.0, 1.0); float edge = pow(abs(dot(vN, vV)), 1.5);
      float a = uK * edge * smoothstep(0.0, 0.25, h) * (0.35 + 0.65 * h);
      gl_FragColor = vec4(vec3(1.0, 0.95, 0.86) * a, 1.0); }`,
  });
  mats.push(hazeMat);
  const hazeParts: THREE.BufferGeometry[] = [];
  for (const [x, z] of bankPos.slice(0, 14)) {
    const c = new THREE.CylinderGeometry(0.5, 3.4, ceilY - 4, 18, 1, true);
    c.translate(x * 0.85, (ceilY - 4) / 2, z * 0.55);
    hazeParts.push(c);
  }
  const hazeGeo = mergeGeometries(hazeParts);
  for (const x of hazeParts) x.dispose();
  geos.push(hazeGeo);
  const haze = new THREE.Mesh(hazeGeo, hazeMat);
  haze.layers.set(NO_REFLECT);
  haze.renderOrder = 10;
  group.add(haze);

  const fanGeo = fanGeometry();
  const fanGeoFar = fanGeometry(true);
  geos.push(fanGeo, fanGeoFar);
  const uniforms = {
    uTime: { value: 0 }, uHype: { value: 0.3 }, uCheer: { value: 0 }, uCheerTeam: { value: 0 }, uChant: { value: 0 },
    uAnim: { value: anim ? 1 : 0 }, uGroan: { value: 0 }, uBall: { value: new THREE.Vector3(0, 1, 0) },
  };
  const fanMat = new THREE.MeshLambertMaterial({ color: "#ffffff" });
  fanMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\n${CROWD_VERT_PARS}`)
      // begin_vertex runs after the normal chunks, so the rotated arm normal is transformed again here
      .replace("#include <begin_vertex>", `${CROWD_BEGIN}\n{ vec3 tn = objectNormal;\n#ifdef USE_INSTANCING\ntn = mat3(instanceMatrix) * tn;\n#endif\nvNormal = normalize(normalMatrix * tn); }`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\n${CROWD_FRAG_PARS}`)
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif (vNear < 0.999 && fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) > vNear) discard;")
      .replace("#include <color_fragment>", "diffuseColor.rgb *= vFanCol * vAo;")
      .replace("#include <opaque_fragment>", "outgoingLight = outgoingLight * vSpill + vec3(1.6, 1.6, 1.8) * vFlash * 9.0 * pow(vHand, 14.0);\n#include <opaque_fragment>");
  };
  fanMat.customProgramCacheKey = () => "hoops-crowd";
  mats.push(fanMat);

  interface Seat {
    m: THREE.Matrix4;
    tier: 0 | 1;
    sec: number;
    rnd: number;
  }
  const seats: Seat[] = [];
  const tmpM = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const rs = seeded(91);
  function seatRow(o: number, y: number, tier: 0 | 1) {
    const pts = loop(o + 0.36);
    const total = pts[pts.length - 1].s;
    const n = Math.floor(total / SEAT_W);
    let j = 0;
    for (let k = 0; k < n; k++) {
      if (k % 18 === 0) continue; // aisle
      const s = k * SEAT_W + SEAT_W / 2;
      while (j < pts.length - 2 && pts[j + 1].s < s) j++;
      const a = pts[j];
      const b = pts[j + 1];
      const f = (s - a.s) / Math.max(1e-6, b.s - a.s);
      const x = a.x + (b.x - a.x) * f;
      const z = a.z + (b.z - a.z) * f;
      const nx = a.nx + (b.nx - a.nx) * f;
      const nz = a.nz + (b.nz - a.nz) * f;
      q.setFromEuler(new THREE.Euler((rs() - 0.5) * 0.16, Math.atan2(nx, nz) + (rs() - 0.5) * 0.5, (rs() - 0.5) * 0.08, "YXZ"));
      pos.set(x, y, z);
      const sc = 0.86 + rs() * 0.26;
      one.set(sc * (0.92 + rs() * 0.16), sc * (0.9 + rs() * 0.18), sc);
      seats.push({ m: new THREE.Matrix4().compose(pos, q, one), tier, sec: Math.floor(s / 14) + tier * 1000, rnd: rs() });
    }
  }
  for (let i = 0; i < LOWER.rows; i++) seatRow(i * LOWER.depth, LOWER.y0 + i * LOWER.rise, 0);
  for (let i = 0; i < UPPER.rows; i++) seatRow(upperO + i * UPPER.depth, ribbonY1 + 0.25 + i * UPPER.rise, 1);
  // courtside row on the far sideline: one row, and none in the middle stretch, so the LED ribbon behind it reads
  // cleanly from the broadcast rig (heads in front of it broke the scrolling text into pieces)
  for (const [zz, yy] of [[9.75, 0.02]] as const)
    for (let x = -12.2; x <= 12.2; x += 0.62) {
      if (Math.abs(x) < 7.8) continue;
      q.setFromAxisAngle(UP, Math.PI + (rs() - 0.5) * 0.3);
      pos.set(x, yy, zz);
      seats.push({ m: new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)), tier: 0, sec: 9000, rnd: rs() });
    }
  // shuffle so any prefix is an even sample of the bowl
  for (let i = seats.length - 1; i > 0; i--) {
    const j = Math.floor(rs() * (i + 1));
    const t = seats[i];
    seats[i] = seats[j];
    seats[j] = t;
  }

  function tierMesh(tier: 0 | 1) {
    const list = seats.filter((s) => s.tier === tier);
    const geo = (tier === 1 ? fanGeoFar : fanGeo).clone();
    geos.push(geo);
    const fan = new Float32Array(list.length * 4);
    const shirt = new Float32Array(list.length * 3);
    geo.setAttribute("aFan", new THREE.InstancedBufferAttribute(fan, 4));
    geo.setAttribute("aShirt", new THREE.InstancedBufferAttribute(shirt, 3));
    const mesh = new THREE.InstancedMesh(geo, fanMat, list.length);
    for (let i = 0; i < list.length; i++) mesh.setMatrixAt(i, list[i].m);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    // crowd stays out of the floor mirror: boards hide most of it and it is the most expensive thing to redraw
    mesh.layers.set(NO_REFLECT);
    mesh.name = tier ? "fansUpper" : "fansLower";
    group.add(mesh);
    return { mesh, list, fan, shirt };
  }
  const tiers = [tierMesh(0), tierMesh(1)];

  const col = new THREE.Color();
  function dress(h: TeamData, a: TeamData) {
    const awaySec = new Set<number>();
    const r0 = seeded(hashStr(h.abbr + a.abbr));
    for (let i = 0; i < 6; i++) awaySec.add(Math.floor(r0() * 60) + (i > 3 ? 1000 : 0));
    for (const t of tiers) {
      for (let i = 0; i < t.list.length; i++) {
        const s = t.list[i];
        const r = s.rnd;
        const r2 = (r * 7.31) % 1;
        const r3 = (r * 13.7) % 1;
        let team = 0;
        if (awaySec.has(s.sec) ? r2 < 0.7 : r2 < 0.07) team = 1;
        else if (r2 > 0.86) team = 0.5;
        const tm = team === 1 ? a : h;
        if (team === 0.5 || r3 > 0.62) col.set(STREET[Math.floor(((r * 31.7) % 1) * STREET.length)]);
        else if (r3 < 0.34) col.set(tm.primary);
        else if (r3 < 0.48) col.set(tm.secondary);
        else if (r3 < 0.56) col.set("#e8e8e8");
        else col.set(tm.accent);
        col.convertSRGBToLinear();
        col.multiplyScalar(0.85 + r * 0.25);
        t.shirt[i * 3] = col.r;
        t.shirt[i * 3 + 1] = col.g;
        t.shirt[i * 3 + 2] = col.b;
        t.fan[i * 4] = s.rnd * 61.7;
        t.fan[i * 4 + 1] = team;
        t.fan[i * 4 + 2] = 0.35 + ((r * 3.7) % 1) * 0.65;
        t.fan[i * 4 + 3] = s.sec === 9000 ? 0.3 : 1;
      }
      (t.mesh.geometry.attributes.aFan as THREE.InstancedBufferAttribute).needsUpdate = true;
      (t.mesh.geometry.attributes.aShirt as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
  }
  dress(home, away);

  function setDensity(d: number, an: boolean) {
    for (const t of tiers) t.mesh.count = Math.max(0, Math.floor(t.list.length * Math.min(1, Math.max(0, d))));
    uniforms.uAnim.value = an ? 1 : 0;
  }
  setDensity(density, anim);

  let cheer = 0;
  let cheerTeam = 0;
  let groan = 0;
  const self: Bowl = {
    group,
    hype: 0.3,
    chant: 0,
    get fans() {
      return tiers[0].mesh.count + tiers[1].mesh.count;
    },
    setTeams(h, a) {
      drawSeats(h);
      dress(h, a);
    },
    setDensity,
    setHaze(on) {
      haze.visible = on;
    },
    update(dt, time, ball) {
      if (ball) uniforms.uBall.value.lerp(ball, Math.min(1, dt * 4));
      else uniforms.uBall.value.set(Math.sin(time * 0.2) * 6, 1, 0);
      cheer = Math.max(0, cheer - dt * 0.42);
      groan = Math.max(0, groan - dt * 0.5);
      uniforms.uTime.value = time;
      uniforms.uHype.value += (self.hype - uniforms.uHype.value) * Math.min(1, dt * 2);
      uniforms.uCheer.value = Math.min(1, cheer);
      uniforms.uCheerTeam.value = cheerTeam;
      uniforms.uGroan.value = Math.min(1, groan);
      uniforms.uChant.value += (self.chant - uniforms.uChant.value) * Math.min(1, dt * 1.5);
      hazeMat.uniforms.uK.value = 0.022 + uniforms.uHype.value * 0.012;
    },
    cheer(team, s) {
      if (team !== cheerTeam && cheer > 0.3 && s < cheer) return;
      cheerTeam = team;
      cheer = Math.max(cheer, s * 1.25);
    },
    groan(s) {
      groan = Math.max(groan, s);
    },
    dispose() {
      for (const t of tiers) t.mesh.dispose();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
    },
  };
  return self;
}
