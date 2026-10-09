import * as THREE from "three";
import type { Box, City } from "./city";
import type { CarBox } from "./city-cars";
import type { Hero } from "./hero";
import { createWebLine } from "./player-web";
import type { AimKind, AimState, GameEvent, HeroPose, Input, PlayerApi, PlayerMode, Sfx } from "./contracts";

export const R = 0.95;
const STEP = 1 / 120;
const MAX_STEPS = 30;
const G = 24;
const G_SWING = 30;
const AIR_DRAG = G / (55 * 55);
const DIVE_DRAG = (G * 1.9) / (70 * 70);
const AIR_CONTROL = 14;
const SOFT_SPEED = 35;
const RUN = 11;
const SPRINT = 20;
const JUMP = 11;
const ZIP = 70;
const LAUNCH = 50;
const MAX_SPEED = 75;
const SWING_PUSH = 6;
const SOFT_DRAG = 8;
const AIR_SOFT = 2.5;
const WALL_GAP = 4;
const ROPE_MAX = 40;
const REEL = 1.5;
const WEB_TRAVEL = 0.08;
const AIM_RANGE = 60;
const AIM_UP = 4;
const DASH_RANGE = 40;
const SWING_RETRY = 0.15;
const COYOTE = 0.1;
const WALL_LET_GO = 0.15;
const WALL_IDLE = 1.5;
const WALL_ENTRY = 16;
const DASH_CD = 0.8;
const PROMPT_RANGE = 30;
const PERCH_HOLD = 0.28;
const SWIM = 4.2;
const SWIM_FAST = 7;
const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

let tMin = 0;
let tMax = 0;
let hitAxis = 0;
let hitSign = 0;
function slab(o: number, d: number, lo: number, hi: number, axis: number) {
  if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
  let a = (lo - o) / d;
  let b = (hi - o) / d;
  if (a > b) [a, b] = [b, a];
  if (a > tMin) {
    tMin = a;
    hitAxis = axis;
    hitSign = d > 0 ? -1 : 1;
  }
  if (b < tMax) tMax = b;
  return tMin <= tMax;
}

export function rayBox(o: THREE.Vector3, d: THREE.Vector3, b: Box, n?: THREE.Vector3) {
  tMin = -Infinity;
  tMax = Infinity;
  hitAxis = -1;
  if (!slab(o.x, d.x, b.minX, b.maxX, 0) || !slab(o.y, d.y, b.minY ?? 0, b.maxY, 1) || !slab(o.z, d.z, b.minZ, b.maxZ, 2)) return -1;
  if (tMin < 0) return -1;
  n?.set(hitAxis === 0 ? hitSign : 0, hitAxis === 1 ? hitSign : 0, hitAxis === 2 ? hitSign : 0);
  return tMin;
}

const _n = new THREE.Vector3();
const _n2 = new THREE.Vector3();
function castList(list: readonly Box[], o: THREE.Vector3, d: THREE.Vector3, maxT: number, n?: THREE.Vector3) {
  let best = -1;
  for (const b of list) {
    const t = rayBox(o, d, b, _n2);
    if (t >= 0 && t <= maxT && (best < 0 || t < best)) {
      best = t;
      n?.copy(_n2);
    }
  }
  return best;
}

export function raycast(city: City, o: THREE.Vector3, d: THREE.Vector3, maxT: number, n?: THREE.Vector3) {
  let best = -1;
  for (const b of city.near(o.x + (d.x * maxT) / 2, o.z + (d.z * maxT) / 2, maxT / 2 + 2)) {
    const t = rayBox(o, d, b, _n);
    if (t >= 0 && t <= maxT && (best < 0 || t < best)) {
      best = t;
      n?.copy(_n);
    }
  }
  return best;
}

export function insideAny(city: City, x: number, y: number, z: number, pad = 0) {
  for (const b of city.near(x, z, 2)) if (x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad && y < b.maxY + pad && y > (b.minY ?? -Infinity) - pad) return true;
  return false;
}

export function groundAt(city: City, x: number, z: number, y: number) {
  let g = 0;
  for (const b of city.near(x, z, 2)) if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && b.maxY <= y + 0.5 && b.maxY > g) g = b.maxY;
  return g;
}

// Debug assert: an anchor must lie on a collider face.
function onCollider(city: City, c: THREE.Vector3) {
  const e = 0.05;
  for (const b of city.near(c.x, c.z, 2)) {
    if (c.y > b.maxY + e || c.y < (b.minY ?? 0) - e) continue;
    const inX = c.x >= b.minX - e && c.x <= b.maxX + e;
    const inZ = c.z >= b.minZ - e && c.z <= b.maxZ + e;
    if (inX && inZ && (Math.abs(c.x - b.minX) < e || Math.abs(c.x - b.maxX) < e || Math.abs(c.z - b.minZ) < e || Math.abs(c.z - b.maxZ) < e || Math.abs(c.y - b.maxY) < e)) return true;
  }
  return false;
}

export type PlayerHooks = {
  strikeTarget: (pos: THREE.Vector3, range: number) => THREE.Vector3 | null;
  strikeHit: (pos: THREE.Vector3, power: number) => GameEvent[];
  trick: (kind: "flip" | "spin", airTime: number) => GameEvent[];
  enemyNear: (pos: THREE.Vector3) => boolean;
  inCombat: () => boolean;
  carHit: (from: THREE.Vector3, speed: number) => void;
  // Height the feet rest on where no box is below (0 = street). Below -0.5 the hero swims.
  floorAt?: (x: number, z: number) => number;
  // Colliders outside the city grid (room walls, roof doors).
  extraBoxes?: (x: number, z: number) => readonly Box[];
};
const ZIP_RANGE = 60;

type Candidate = { p: THREE.Vector3; n: THREE.Vector3; side: number; score: number };
const POOL = 400;
const DEV = process.env.NODE_ENV !== "production";

export function createPlayer(scene: THREE.Scene, city: City, hero: Hero, spawn: THREE.Vector3, spawnDir: THREE.Vector3, hooks: PlayerHooks) {
  const p = spawn.clone();
  const pPrev = spawn.clone();
  const rp = spawn.clone();
  let acc = 0;
  const v = new THREE.Vector3();
  const facing = new THREE.Vector3(0, 0, -1);
  let mode: PlayerMode = "ground";
  let grounded = false;
  let airTime = 0;
  let sprinting = false;
  let swimming = false;
  let ceiling = Infinity;
  let blockE = false;

  // Swing state. The anchor is locked from attach to release.
  const anchor = new THREE.Vector3();
  const anchorN = new THREE.Vector3();
  let rope = 0;
  let ropeGoal = 0;
  let ropeLive = false;
  let webT = 0;
  let swingT = 0;
  let lastSide = 0;
  let sinceRelease = 9;
  let diveCheckT = 0;
  let swingRetry = 0;
  let retryFrom: PlayerMode = "air";
  let coyoteT = 0;
  let swingFloor = 0;
  let diveAssist = false;
  let dove = false;
  let webHand: "L" | "R" = "R";
  let webGrow = 0;

  const aim: AimState = { kind: "none", dist: 0, point: new THREE.Vector3() };
  const aimN = new THREE.Vector3();
  let aimHand: "L" | "R" = "R";
  let aimSide = 1;
  let aimList: Box[] = [];
  const camRight = new THREE.Vector3();
  const ringUp = new THREE.Vector3();
  const rayO = new THREE.Vector3();
  const rayD = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const hitP = new THREE.Vector3();
  const hitN = new THREE.Vector3();

  const wallN = new THREE.Vector3();
  let wallBox: Box | null = null;
  let wallContact = false;
  let cornerHit = false;
  const cornerHitN = new THREE.Vector3();
  let wallMomentum = 0;
  let wallAwayT = 0;
  let wallIdleT = 0;
  let cornerBox: Box | null = null;
  let cornerT = 0;

  const zipTarget = new THREE.Vector3();
  const zipDir = new THREE.Vector3();
  let zipT = 0;
  let striking = false;

  const launchTarget = new THREE.Vector3();
  const launchFrom = new THREE.Vector3();
  let launchArrived = false;
  let launchT = 0;
  let launchAnimT = 1;
  let launchLen = 1;
  let perchIntent = false;
  let launchBuffered = false;

  let hasPrompt = false;
  const promptCorner = new THREE.Vector3();
  const promptTarget = new THREE.Vector3();
  let promptT = 0;
  let eT = -1;
  let eFired = false;

  let dashCd = 0;
  let dashT = 0;
  const dashTo = new THREE.Vector3();
  type Trick = "flip" | "backflip" | "corkscrew" | "split";
  let trick: { kind: Trick; t: number } | null = null;
  let kickT = 1;
  let landT = 1;
  let boostT = 0;
  let vaultT = 0;
  let phase = 0;

  const wingDir = new THREE.Vector3();

  let actPose: HeroPose | null = null;
  let actProgress = 0;
  const lungeTo = new THREE.Vector3();
  let lungeSpeed = 0;

  const events: GameEvent[] = [];
  const prompts: { key: string; label: string }[] = [];
  const pool: Candidate[] = Array.from({ length: POOL }, () => ({ p: new THREE.Vector3(), n: new THREE.Vector3(), side: 0, score: 0 }));
  const cands: Candidate[] = [];
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const heading = new THREE.Vector3();
  const right = new THREE.Vector3();
  const wish = new THREE.Vector3();
  const wishIn = wish;

  const sfx = (name: Sfx, volume?: number) => events.push({ type: "sfx", name, volume });
  const shake = (strength: number) => events.push({ type: "shake", strength });

  const webLine = createWebLine(scene);
  const ZERO = new THREE.Vector3();
  const marker = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.32),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.2), toneMapped: false, depthTest: false, transparent: true }),
  );
  marker.renderOrder = 10;
  marker.visible = false;
  const blobTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(0,0,0,0.75)");
    gr.addColorStop(0.5, "rgba(0,0,0,0.35)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 2.2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
  );
  blob.renderOrder = 1;
  scene.add(marker, blob);

  const findAnchor = (look: THREE.Vector3) => {
    const speed = v.length();
    heading.set(v.x, 0, v.z);
    if (heading.lengthSq() < 16) heading.set(look.x, 0, look.z);
    heading.normalize().addScaledVector(wish, 0.6);
    if (heading.lengthSq() < 1e-4) heading.set(look.x, 0, look.z);
    heading.normalize();
    right.set(-heading.z, 0, heading.x);
    const idealAhead = THREE.MathUtils.clamp(12 + speed * 0.35, 12, 26);
    const idealUp = THREE.MathUtils.clamp(13 + speed * 0.15, 12, 22);
    const minAhead = speed < 8 ? 3 : 8;
    cands.length = 0;
    const consider = (x: number, y: number, z: number, nx: number, nz: number) => {
      if (cands.length >= POOL) return;
      const dx = x - p.x;
      const dy = y - p.y;
      const dz = z - p.z;
      const ahead = dx * heading.x + dz * heading.z;
      const side = dx * right.x + dz * right.z;
      if (ahead < minAhead || ahead > 44 || dy < 4 || Math.abs(side) > 30) return;
      if (dx * dx + dy * dy + dz * dz > 60 * 60) return;
      const fwd = Math.max(0, 1 - Math.abs(ahead - idealAhead) / 22);
      const alt = lastSide === 0 ? 0.7 : Math.sign(side) === -lastSide ? 1 : 0.35;
      const along = nx || nz ? 0.4 + 0.6 * (1 - Math.abs(nx * heading.x + nz * heading.z)) : 0.7;
      const sidePref = alt * along * (Math.abs(side) < 3 ? 0.4 : 1);
      const fit = Math.max(0, 1 - Math.abs(dy - idealUp) / idealUp);
      const c = pool[cands.length];
      c.p.set(x, y, z);
      c.n.set(nx, 0, nz);
      c.side = side;
      c.score = fwd * 0.5 + sidePref * 0.3 + fit * 0.2;
      cands.push(c);
    };
    for (const b of city.near(p.x, p.z, 60)) {
      if (b.maxY < p.y + 4) continue;
      const lo = Math.max(b.maxY * 0.6, p.y + 4, b.minY ?? 0);
      const hi = b.maxY - 0.2;
      if (lo > hi) continue;
      const y = THREE.MathUtils.clamp(p.y + idealUp, lo, hi);
      for (let f = 0; f < 4; f++) {
        const xFace = f < 2;
        const nx = f === 0 ? -1 : f === 1 ? 1 : 0;
        const nz = f === 2 ? -1 : f === 3 ? 1 : 0;
        const fixed = f === 0 ? b.minX : f === 1 ? b.maxX : f === 2 ? b.minZ : b.maxZ;
        const out = xFace ? (p.x - fixed) * nx : (p.z - fixed) * nz;
        if (out < 3) continue;
        const a0 = (xFace ? b.minZ : b.minX) + 0.5;
        const a1 = (xFace ? b.maxZ : b.maxX) - 0.5;
        if (a1 <= a0) continue;
        for (const k of [0.6, 1, 1.4]) {
          const ix = p.x + heading.x * idealAhead * k;
          const iz = p.z + heading.z * idealAhead * k;
          const along = THREE.MathUtils.clamp(xFace ? iz : ix, a0, a1);
          if (xFace) consider(fixed, y, along, nx, nz);
          else consider(along, y, fixed, nx, nz);
        }
      }
    }
    const extra = (city as { anchors?: THREE.Vector3[] }).anchors;
    if (extra) for (const a of extra) if (Math.abs(a.x - p.x) < 60 && Math.abs(a.z - p.z) < 60) consider(a.x, a.y, a.z, 0, 0);
    cands.sort((a, b) => b.score - a.score);
    tmp.copy(p).addScaledVector(UP, 0.6);
    for (const c of cands) {
      tmp2.copy(c.p).sub(tmp);
      const len = tmp2.length();
      tmp2.divideScalar(len);
      const hit = raycast(city, tmp, tmp2, len);
      if (hit >= 0 && hit < len - 0.3) continue;
      return c;
    }
    return null;
  };

  const sideOf = (pt: THREE.Vector3, camPos: THREE.Vector3): "L" | "R" => ((pt.x - camPos.x) * camRight.x + (pt.z - camPos.z) * camRight.z >= 0 ? "R" : "L");

  // 0 valid, 1 too low, 2 too far, 3 line of sight blocked.
  const checkAnchor = (pt: THREE.Vector3) => {
    if (pt.y - p.y < AIM_UP) return 1;
    if (pt.distanceTo(p) > AIM_RANGE) return 2;
    tmp2.copy(pt).sub(eye);
    const len = tmp2.length();
    if (len < 0.5) return 3;
    tmp2.divideScalar(len);
    const hit = castList(aimList, eye, tmp2, len);
    return hit >= 0 && hit < len - 0.3 ? 3 : 0;
  };

  const castAim = (o: THREE.Vector3, d: THREE.Vector3, ahead: number, maxT: number) => {
    rayO.copy(o).addScaledVector(d, ahead);
    const t = castList(aimList, rayO, d, maxT - ahead, hitN);
    if (t < 0) return false;
    hitP.copy(rayO).addScaledVector(d, t);
    return true;
  };

  const computeAim = (camPos: THREE.Vector3, look: THREE.Vector3) => {
    const d = look;
    camRight.set(-d.z, 0, d.x);
    if (camRight.lengthSq() < 1e-6) camRight.set(1, 0, 0);
    camRight.normalize();
    ringUp.crossVectors(camRight, d).normalize();
    eye.copy(p).addScaledVector(UP, 0.6);
    const ahead = Math.max(0, tmp.copy(p).sub(camPos).dot(d));
    const maxT = AIM_RANGE + ahead + 2;
    aimList = city.near(camPos.x + (d.x * maxT) / 2, camPos.z + (d.z * maxT) / 2, maxT / 2 + 8);
    let miss: AimKind = "none";
    let found = false;
    if (castAim(camPos, d, ahead, maxT)) {
      const r = checkAnchor(hitP);
      if (r === 0) found = true;
      else if (r > 1) {
        miss = r === 2 ? "far" : "blocked";
        aim.point.copy(hitP);
      }
    }
    for (let ring = 1; ring <= 2 && !found; ring++) {
      for (let k = 0; k < 8 && !found; k++) {
        const a = (k / 8) * Math.PI * 2;
        const r = ring * 0.045;
        rayD.copy(d).addScaledVector(camRight, Math.cos(a) * r).addScaledVector(ringUp, Math.sin(a) * r).normalize();
        if (castAim(camPos, rayD, ahead, maxT) && checkAnchor(hitP) === 0) found = true;
      }
    }
    if (found) {
      aim.kind = "aim";
      aim.point.copy(hitP);
      aimN.copy(hitN);
      heading.set(v.x, 0, v.z);
      if (heading.lengthSq() < 16) heading.set(look.x, 0, look.z);
      aimSide = Math.sign((hitP.x - p.x) * -heading.z + (hitP.z - p.z) * heading.x) || 1;
    } else {
      const c = findAnchor(look);
      if (c) {
        aim.kind = "auto";
        aim.point.copy(c.p);
        aimN.copy(c.n);
        aimSide = Math.sign(c.side) || 1;
      } else aim.kind = miss;
    }
    aimHand = sideOf(aim.point, camPos);
    aim.dist = aim.kind === "none" ? 0 : aim.point.distanceTo(p);
  };
  const aimOk = () => aim.kind === "aim" || aim.kind === "auto";

  // Debug hook for the verify scripts. It moves p and v.
  (globalThis as any).__fa = (pp: THREE.Vector3, look: THREE.Vector3, vv: THREE.Vector3, cam?: THREE.Vector3) => {
    p.copy(pp);
    v.copy(vv);
    const c = findAnchor(look);
    const res = { found: !!c, c: c && { p: c.p.clone(), n: c.n.clone(), side: c.side, score: c.score }, aim: { kind: aim.kind, dist: 0, point: new THREE.Vector3() } };
    computeAim(cam ?? tmp.copy(pp).addScaledVector(look, -6).addScaledVector(UP, 2).clone(), look);
    res.aim = { kind: aim.kind, dist: aim.dist, point: aim.point.clone() };
    return res;
  };

  const attach = () => {
    if (!aimOk()) return false;
    anchor.copy(aim.point);
    anchorN.copy(aimN);
    if (DEV && !onCollider(city, anchor) && aim.kind === "aim") console.error("anchor off collider", anchor.toArray());
    lastSide = aimSide;
    webHand = aimHand;
    ropeLive = false;
    webT = 0;
    swingT = 0;
    webGrow = 0;
    trick = null;
    swingRetry = 0;
    mode = "swing";
    sfx("thwip");
    return true;
  };

  const tryAttach = (from: PlayerMode) => {
    if (!attach()) return false;
    if (from === "wall") v.copy(wallN).multiplyScalar(8).addScaledVector(UP, 6);
    else if (from === "ground" || from === "perch") v.y = Math.max(v.y, JUMP * 0.8);
    return true;
  };

  const landWeb = () => {
    ropeLive = true;
    const dist = p.distanceTo(anchor);
    swingFloor = groundAt(city, anchor.x + anchorN.x * 1.5, anchor.z + anchorN.z * 1.5, anchor.y);
    rope = dist;
    ropeGoal = Math.max(4, Math.min(dist - REEL, ROPE_MAX, anchor.y - swingFloor - 5));
    sfx("webImpact", 0.25);
  };

  const pastBottom = () => {
    tmp.copy(p).sub(anchor);
    const fl = Math.hypot(v.x, v.z) || 1;
    return Math.atan2((tmp.x * v.x + tmp.z * v.z) / fl, -tmp.y);
  };

  const release = (manual: boolean, jump: boolean) => {
    mode = "air";
    sinceRelease = 0;
    diveCheckT = 0.25;
    if (!ropeLive) return;
    const ang = pastBottom();
    const flat = Math.hypot(v.x, v.z);
    if (wish.lengthSq() > 0 && flat > 1) {
      tmp.set(v.x / flat, 0, v.z / flat).lerp(wish, 0.6);
      if (tmp.lengthSq() > 1e-4) {
        tmp.normalize();
        v.x = tmp.x * flat;
        v.z = tmp.z * flat;
      }
    }
    if (manual && ang > 15 * DEG && ang < 40 * DEG) {
      v.multiplyScalar(1.1);
      const s1 = v.length();
      v.y += 6;
      v.setLength(s1);
      boostT = 0.5;
      sfx("whoosh");
    } else v.y += manual ? 3 : 1.5;
    if (jump) v.y += 4;
  };

  // Camera ray to the first surface past the hero, within range of the hero.
  const camRay = (look: THREE.Vector3, camPos: THREE.Vector3, range: number) => {
    const ahead = Math.max(0, tmp.copy(p).sub(camPos).dot(look));
    rayO.copy(camPos).addScaledVector(look, ahead);
    const t = raycast(city, rayO, look, range + 2, hitN);
    if (t < 0) return false;
    hitP.copy(rayO).addScaledVector(look, t);
    return hitP.distanceTo(p) <= range;
  };

  const startZip = (look: THREE.Vector3, camPos: THREE.Vector3) => {
    if (!camRay(look, camPos, ZIP_RANGE)) {
      sfx("whiff", 0.6);
      return false;
    }
    anchor.copy(hitP);
    anchorN.copy(hitN);
    zipTarget.copy(anchor).addScaledVector(hitN, R + 0.2);
    if (hitN.y > 0.5) zipTarget.y += 0.5;
    zipDir.copy(zipTarget).sub(p).normalize();
    webHand = sideOf(anchor, camPos);
    webGrow = 0;
    zipT = 0;
    striking = false;
    trick = null;
    mode = "zip";
    sfx("zip");
    return true;
  };

  const startStrike = (camPos: THREE.Vector3) => {
    const target = hooks.strikeTarget(p, 40);
    if (!target) return;
    zipTarget.copy(target);
    zipDir.copy(target).sub(p).normalize();
    anchor.copy(target);
    anchorN.set(0, 0, 0);
    webHand = sideOf(target, camPos);
    webGrow = 0;
    zipT = 0;
    striking = true;
    trick = null;
    mode = "zip";
    sfx("zip");
  };
  const startLaunch = (perch: boolean) => {
    launchTarget.copy(promptTarget);
    launchFrom.copy(p);
    anchor.copy(promptCorner);
    anchorN.set(0, 0, 0);
    launchLen = Math.max(1, p.distanceTo(launchTarget));
    launchT = 0;
    launchArrived = false;
    perchIntent = perch;
    launchBuffered = false;
    webHand = "R";
    webGrow = 0;
    trick = null;
    hasPrompt = false;
    mode = "launch";
    sfx("zip");
  };

  const highLaunch = (look: THREE.Vector3) => {
    tmp.set(look.x, 0, look.z).normalize();
    v.copy(tmp).multiplyScalar(11).addScaledVector(UP, 24);
    mode = "air";
    launchAnimT = 0;
    boostT = 0.6;
    sinceRelease = 0;
    sfx("whoosh");
    shake(0.15);
  };

  const enterWall = (speed: number) => {
    mode = "wall";
    wallMomentum = Math.min(speed, WALL_ENTRY);
    wallAwayT = 0;
    wallIdleT = 0;
    tmp.copy(v).addScaledVector(wallN, -v.dot(wallN));
    if (tmp.lengthSq() < 1) tmp.copy(UP);
    v.copy(tmp.normalize()).multiplyScalar(Math.max(wallMomentum, 4));
    trick = null;
  };

  const findPrompt = (look: THREE.Vector3) => {
    hasPrompt = false;
    if (mode !== "ground" && mode !== "air" && mode !== "wall" && mode !== "perch" && mode !== "wings") return;
    let best = 0.9;
    const eye = tmp.copy(p).addScaledVector(UP, 0.6);
    for (const b of city.near(p.x, p.z, PROMPT_RANGE)) {
      if (b.maxX - b.minX < 4 || b.maxZ - b.minZ < 4) continue;
      for (let k = 0; k < 4; k++) {
        const ox = k & 1 ? 1 : -1;
        const oz = k & 2 ? 1 : -1;
        const cx = ox > 0 ? b.maxX : b.minX;
        const cz = oz > 0 ? b.maxZ : b.minZ;
        const dx = cx - eye.x;
        const dy = b.maxY - eye.y;
        const dz = cz - eye.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > PROMPT_RANGE || dist < 5) continue;
        const align = (dx * look.x + dy * look.y + dz * look.z) / dist;
        if (align <= best) continue;
        const px = cx + ox * 0.3;
        const pz = cz + oz * 0.3;
        if (insideAny(city, px, b.maxY + 0.3, pz)) continue;
        const tx = cx - ox * 0.9;
        const tz = cz - oz * 0.9;
        if (insideAny(city, tx, b.maxY + 0.5, tz)) continue;
        tmp2.set(px - eye.x, b.maxY + 0.3 - eye.y, pz - eye.z);
        const len = tmp2.length();
        tmp2.divideScalar(len);
        const hit = raycast(city, eye, tmp2, len);
        if (hit >= 0 && hit < len - 0.4) continue;
        best = align;
        hasPrompt = true;
        promptCorner.set(cx, b.maxY, cz);
        promptTarget.set(tx, b.maxY + R + 0.02, tz);
      }
    }
  };

  const carList: CarBox[] = [];
  const carFrom = new THREE.Vector3();
  let carCd = 0;
  const collideCars = (h: number) => {
    carCd -= h;
    if (p.y > 6) return;
    for (const b of city.carsNear(p.x, p.z, 4, carList)) {
      const x0 = b.minX - 0.45;
      const x1 = b.maxX + 0.45;
      const z0 = b.minZ - 0.45;
      const z1 = b.maxZ + 0.45;
      const top = b.maxY + R;
      if (p.x <= x0 || p.x >= x1 || p.z <= z0 || p.z >= z1 || p.y >= top) continue;
      const up = top - p.y;
      let m = 0;
      let pen = p.x - x0;
      if (x1 - p.x < pen) [m, pen] = [1, x1 - p.x];
      if (p.z - z0 < pen) [m, pen] = [2, p.z - z0];
      if (z1 - p.z < pen) [m, pen] = [3, z1 - p.z];
      if (up < pen || (up < 0.8 && v.y <= 1)) {
        p.y = top;
        if (v.y < 0) v.y = 0;
        p.x += b.vx * h;
        p.z += b.vz * h;
        grounded = true;
        continue;
      }
      if (m === 0) p.x = x0;
      else if (m === 1) p.x = x1;
      else if (m === 2) p.z = z0;
      else p.z = z1;
      const n = tmp.set(m === 0 ? -1 : m === 1 ? 1 : 0, 0, m === 2 ? -1 : m === 3 ? 1 : 0);
      const toward = b.vx * n.x + b.vz * n.z;
      if (toward > 4 && carCd <= 0) {
        carCd = 1;
        v.copy(n).multiplyScalar(8 + toward * 0.6).addScaledVector(UP, 7);
        if (mode !== "air") mode = "air";
        carFrom.set((b.minX + b.maxX) / 2, p.y, (b.minZ + b.maxZ) / 2);
        hooks.carHit(carFrom, toward);
        continue;
      }
      const vn = v.dot(n) - Math.max(0, toward);
      if (vn < 0) v.addScaledVector(n, -vn);
    }
  };

  const hits: Box[] = [];
  // Vertical box edges are round, so the hero slides around corners instead of catching on them.
  const overlaps = (b: Box, x: number, y: number, z: number) => {
    if (!(x > b.minX - R && x < b.maxX + R && z > b.minZ - R && z < b.maxZ + R && y < b.maxY + R && y > (b.minY ?? -Infinity) - R)) return false;
    if (y >= b.maxY || y <= (b.minY ?? -Infinity)) return true;
    const ex = x < b.minX ? b.minX - x : x > b.maxX ? x - b.maxX : 0;
    const ez = z < b.minZ ? b.minZ - z : z > b.maxZ ? z - b.maxZ : 0;
    return ex === 0 || ez === 0 || ex * ex + ez * ez < R * R;
  };
  const cornerN = new THREE.Vector3();
  const bestCorner = new THREE.Vector3();
  const clearAt = (x: number, y: number, z: number) => {
    for (const b of hits) if (overlaps(b, x, y, z)) return false;
    return true;
  };

  // Resolve against every touching box at once, so two boxes that share a face cannot trap the hero.
  const solve = () => {
    for (let it = 0; it < 5; it++) {
      let bestCost = Infinity;
      let bestM = -1;
      let bestVal = 0;
      let bestBox: Box | null = null;
      for (const b of hits) {
        if (!overlaps(b, p.x, p.y, p.z)) continue;
        const up = b.maxY + R - p.y;
        const stepUp = (mode === "ground" || mode === "air") && up < 1.0 && v.y <= 1;
        const cx = p.x < b.minX ? b.minX : p.x > b.maxX ? b.maxX : NaN;
        const cz = p.z < b.minZ ? b.minZ : p.z > b.maxZ ? b.maxZ : NaN;
        const corner = cx === cx && cz === cz && p.y < b.maxY && p.y > (b.minY ?? -Infinity);
        if (corner) {
          const dx = p.x - cx;
          const dz = p.z - cz;
          const d = Math.hypot(dx, dz);
          if (d > 1e-6) cornerN.set(dx / d, 0, dz / d);
          else cornerN.set(Math.sign(p.x - (b.minX + b.maxX) / 2), 0, Math.sign(p.z - (b.minZ + b.maxZ) / 2)).normalize();
          const cost = R - d;
          if (cost < bestCost && clearAt(cx + cornerN.x * (R + 1e-4), p.y, cz + cornerN.z * (R + 1e-4))) {
            [bestCost, bestM, bestBox] = [cost, 6, b];
            bestCorner.set(cx, 0, cz).addScaledVector(cornerN, R + 1e-4);
          }
        }
        for (let m = corner ? 4 : 0; m < 6; m++) {
          let val: number;
          let cost: number;
          if (m === 0) [val, cost] = [b.minX - R, p.x - b.minX + R];
          else if (m === 1) [val, cost] = [b.maxX + R, b.maxX + R - p.x];
          else if (m === 2) [val, cost] = [b.minZ - R, p.z - b.minZ + R];
          else if (m === 3) [val, cost] = [b.maxZ + R, b.maxZ + R - p.z];
          else if (m === 4) [val, cost] = [b.maxY + R, stepUp ? 0 : up];
          else {
            if (b.minY === undefined) continue;
            [val, cost] = [b.minY - R, p.y - b.minY + R];
          }
          if (cost >= bestCost) continue;
          const ok = m < 2 ? clearAt(val, p.y, p.z) : m < 4 ? clearAt(p.x, p.y, val) : clearAt(p.x, val, p.z);
          if (!ok) cost += 1000;
          if (cost < bestCost) [bestCost, bestM, bestVal, bestBox] = [cost, m, val, b];
        }
      }
      if (!bestBox) return;
      const b = bestBox;
      if (bestM === 6) {
        cornerN.set(bestCorner.x - p.x, 0, bestCorner.z - p.z);
        p.x = bestCorner.x;
        p.z = bestCorner.z;
        if (cornerN.lengthSq() > 1e-12) {
          cornerN.normalize();
          const vn = v.dot(cornerN);
          if (vn < 0) v.addScaledVector(cornerN, -vn);
          cornerHit = true;
          cornerHitN.copy(cornerN);
        }
        continue;
      }
      if (bestM === 4) {
        p.y = bestVal;
        if (v.y < 0) v.y = 0;
        grounded = true;
        swimming = false;
        continue;
      }
      if (bestM === 5) {
        p.y = bestVal;
        if (v.y > 0) v.y = 0;
        continue;
      }
      const up = b.maxY + R - p.y;
      if (bestM < 2) p.x = bestVal;
      else p.z = bestVal;
      const n = tmp.set(bestM === 0 ? -1 : bestM === 1 ? 1 : 0, 0, bestM === 2 ? -1 : bestM === 3 ? 1 : 0);
      const vn = v.dot(n);
      if (mode === "ground" && sprinting && up < 2.6 && vn < -6) {
        v.y = 8;
        vaultT = 0.45;
        mode = "air";
        sfx("whoosh", 0.4);
      }
      if (vn < 0) v.addScaledVector(n, -vn);
      wallContact = true;
      wallN.copy(n);
      wallBox = b;
    }
  };

  const collide = () => {
    grounded = false;
    wallContact = false;
    cornerHit = false;
    swimming = false;
    const fl = hooks.floorAt?.(p.x, p.z) ?? 0;
    if (p.y < fl + R) {
      p.y = fl + R;
      if (v.y < 0) v.y = 0;
      grounded = true;
      swimming = fl < -0.5;
    }
    hits.length = 0;
    for (const b of city.near(p.x, p.z, 8)) hits.push(b);
    if (hooks.extraBoxes) for (const b of hooks.extraBoxes(p.x, p.z)) hits.push(b);
    solve();
    if (p.y > ceiling - R) {
      p.y = ceiling - R;
      if (v.y > 0) v.y = 0;
    }
  };

  let edgeT = 0;
  const edge = (h: number) => {
    if (ceiling < Infinity) return;
    const B = city.bounds;
    const ox = p.x < B.minX ? B.minX - p.x : p.x > B.maxX ? B.maxX - p.x : 0;
    const oz = p.z < B.minZ ? B.minZ - p.z : p.z > B.maxZ ? B.maxZ - p.z : 0;
    if (ox === 0 && oz === 0) return;
    if (mode === "wings" || mode === "perch") mode = "air";
    const k = Math.min(1, 6 * h);
    if (ox * v.x < 0) v.x -= v.x * k;
    if (oz * v.z < 0) v.z -= v.z * k;
    v.x += ox * 10 * h;
    v.z += oz * 10 * h;
    if (Math.abs(ox) > 20) p.x += ox - Math.sign(ox) * 20;
    if (Math.abs(oz) > 20) p.z += oz - Math.sign(oz) * 20;
    if (edgeT <= 0) {
      events.push({ type: "toast", title: "City limits", text: "Turn back" });
      edgeT = 5;
    }
  };

  const airStep = (h: number, dive: boolean) => {
    const g = dive ? G * 1.9 : diveAssist ? G * 1.6 : G;
    v.y -= g * h;
    if (v.y < 0) v.y += (dive || diveAssist ? DIVE_DRAG : AIR_DRAG) * v.y * v.y * h;
    const flat = Math.hypot(v.x, v.z);
    if (flat > SOFT_SPEED) {
      const k = Math.max(0, 1 - (AIR_SOFT * (flat - SOFT_SPEED) * h) / flat);
      v.x *= k;
      v.z *= k;
    }
    const along = v.x * wish.x + v.z * wish.z;
    if (along < 16) v.addScaledVector(wish, AIR_CONTROL * h);
  };

  const swingStep = (h: number) => {
    swingT += h;
    v.y -= G_SWING * h;
    if (rope > ropeGoal) rope = Math.max(ropeGoal, rope - Math.min(45, 10 + 4 * (rope - ropeGoal)) * h);
    const n = tmp.copy(anchor).sub(p).normalize();
    if (p.y < anchor.y && v.y < 0) {
      const tan = tmp2.copy(v).addScaledVector(n, -v.dot(n));
      const ts = tan.length();
      if (ts > 0.1) v.addScaledVector(tan, (SWING_PUSH * THREE.MathUtils.clamp((SOFT_SPEED - ts) / 10, 0, 1) * h) / ts);
    }
    const sp = v.length();
    if (sp > 0.1 && wish.lengthSq() > 0) {
      const s = tmp2.copy(wish).addScaledVector(n, -wish.dot(n));
      s.addScaledVector(v, -s.dot(v) / (sp * sp));
      v.addScaledVector(s, 8 * h);
    }
    const clear = p.y - R - swingFloor;
    if (n.y > 0.85 && clear < 9) v.y += 12 * (1 - clear / 9) * h;
    // The rope pulls toward the anchor wall. Turn speed into that wall into speed along it.
    if (anchorN.y < 0.5 && anchorN.lengthSq() > 0) {
      const out = (p.x - anchor.x) * anchorN.x + (p.z - anchor.z) * anchorN.z;
      const vn = v.dot(anchorN);
      const want = (WALL_GAP - out) * 2;
      if (vn < want) {
        const s0 = v.length();
        v.addScaledVector(anchorN, (want - vn) * Math.min(1, 10 * h));
        v.setLength(s0);
      }
    }
    const s2 = v.length();
    if (s2 > SOFT_SPEED) v.multiplyScalar(Math.max(0, s2 - SOFT_DRAG * (s2 - SOFT_SPEED) * h) / s2);
  };

  // One-sided rope: it only pulls. Outward speed turns into speed along the arc, so a taut rope never brakes.
  const ropeConstraint = () => {
    tmp.copy(p).sub(anchor);
    const len = tmp.length();
    // Before the bottom of the arc the web takes up slack, so the hero never free falls inside the rope.
    if (len < rope && v.y < 0 && tmp.y < 0 && tmp.x * v.x + tmp.z * v.z < 0) {
      rope = Math.max(4, len);
      ropeGoal = Math.min(ropeGoal, rope);
    }
    if (len <= rope || len < 1e-6) return;
    tmp.divideScalar(len);
    p.copy(anchor).addScaledVector(tmp, rope);
    const vr = v.dot(tmp);
    if (vr <= 0) return;
    const s0 = v.length();
    v.addScaledVector(tmp, -vr);
    const ts = v.length();
    if (ts > 0.5) v.multiplyScalar(s0 / ts);
    else {
      tmp2.set(facing.x, 0, facing.z).addScaledVector(tmp, -(facing.x * tmp.x + facing.z * tmp.z));
      if (tmp2.lengthSq() > 1e-6) v.addScaledVector(tmp2.normalize(), Math.sqrt(Math.max(0, s0 * s0 - ts * ts)));
    }
  };

  const wallWish = new THREE.Vector3();
  let wrapT = 0;
  let wrapAng = 0;
  const wallStep = (h: number, held: ReadonlySet<string>) => {
    const n = wallN;
    // After a corner wrap the held key keeps its meaning on the new face until the camera turns.
    const wish = wrapT > 0 ? wallWish.copy(wishIn).applyAxisAngle(UP, wrapAng) : wishIn;
    wrapT -= h;
    const away = wish.dot(n);
    wallAwayT = away > 0.5 ? wallAwayT + h : 0;
    if (wallAwayT >= WALL_LET_GO) {
      v.addScaledVector(n, 6 - v.dot(n));
      v.y = Math.max(v.y, 1);
      mode = "air";
      cornerBox = wallBox;
      cornerT = 0.35;
      return;
    }
    tmp.copy(wish).addScaledVector(n, -away);
    const run = Math.max(held.has("swing") ? 12 : 8, wallMomentum);
    wallMomentum = Math.max(0, wallMomentum - (WALL_ENTRY / 0.6) * h);
    if (wish.lengthSq() === 0) {
      wallIdleT += h;
      if (wallIdleT > WALL_IDLE) tmp2.set(0, -2, 0);
      else {
        tmp2.copy(v);
        if (tmp2.lengthSq() > 1e-6) tmp2.setLength(wallMomentum);
      }
    } else {
      wallIdleT = 0;
      if (-away > 0.5) tmp2.copy(UP).multiplyScalar(run).addScaledVector(tmp, run * 0.5);
      else tmp2.copy(tmp).normalize().multiplyScalar(run).addScaledVector(UP, Math.max(0, v.y) * 0.5);
    }
    v.lerp(tmp2, 1 - Math.exp(-8 * h));
    v.addScaledVector(n, -v.dot(n) - 2);
  };

  // Past the end of a face, the run turns onto the next face of the same box.
  const wrapCorner = () => {
    const b = wallBox;
    if (!b) return;
    const xFace = wallN.x !== 0;
    const along = xFace ? p.z : p.x;
    const va = xFace ? v.z : v.x;
    const lo = xFace ? b.minZ : b.minX;
    const hi = xFace ? b.maxZ : b.maxX;
    const dir = along > hi && va > 0.5 ? 1 : along < lo && va < -0.5 ? -1 : 0;
    if (dir === 0) return;
    const plane = xFace ? (wallN.x > 0 ? b.maxX : b.minX) : wallN.z > 0 ? b.maxZ : b.minZ;
    const inX = xFace ? plane - wallN.x * 0.5 : p.x;
    const inZ = xFace ? p.z : plane - wallN.z * 0.5;
    if (insideAny(city, inX, p.y, inZ)) return;
    const st = Math.abs(va);
    const edgeV = dir > 0 ? hi : lo;
    const ax = xFace ? 0 : dir;
    const az = xFace ? dir : 0;
    wrapAng = Math.atan2(az * -wallN.x - ax * -wallN.z, -ax * wallN.x - az * wallN.z);
    wrapT = 0.6;
    if (xFace) {
      p.z = edgeV + dir * (R - 0.02);
      p.x = plane - wallN.x * 0.3;
      v.set(-wallN.x * st, v.y, 0);
      wallN.set(0, 0, dir);
    } else {
      p.x = edgeV + dir * (R - 0.02);
      p.z = plane - wallN.z * 0.3;
      v.set(0, v.y, -wallN.z * st);
      wallN.set(dir, 0, 0);
    }
  };

  const wingStep = (h: number, look: THREE.Vector3, dive: boolean) => {
    tmp.set(look.x, 0, look.z);
    if (wish.lengthSq() > 0) tmp.addScaledVector(wish, 0.8);
    if (tmp.lengthSq() > 1e-4) {
      tmp.normalize();
      const turn = Math.atan2(wingDir.x * tmp.z - wingDir.z * tmp.x, wingDir.dot(tmp));
      const a = THREE.MathUtils.clamp(turn, -1.7 * h, 1.7 * h);
      wingDir.applyAxisAngle(UP, -a).normalize();
    }
    let hf = Math.hypot(v.x, v.z);
    if (hf < 10) hf += (10 - hf) * 3 * h;
    v.x = wingDir.x * hf;
    v.z = wingDir.z * hf;
    v.y -= G * h;
    const s = v.length();
    if (s < 0.1) return;
    tmp.copy(v).divideScalar(s);
    tmp2.copy(UP).addScaledVector(tmp, -tmp.y);
    const cl = (dive ? 0.012 : 0.07) * Math.max(0, 1 - 2 * Math.max(0, tmp.y));
    if (tmp2.lengthSq() > 1e-6) v.addScaledVector(tmp2.normalize(), Math.min(2.5 * G, cl * s * s) * h);
    const drag = 0.12 * s + 0.006 * s * s;
    v.addScaledVector(tmp, -Math.min(s, drag * h));
  };

  const land = (fall: number, held: ReadonlySet<string>) => {
    trick = null;
    mode = "ground";
    if (swimming) return;
    if (fall > 35) {
      if (held.has("dive") || diveAssist) {
        events.push(...hooks.strikeHit(p, 2));
        shake(0.7);
      } else shake(0.35);
      sfx("bigLand");
      landT = 0;
      v.x *= 0.3;
      v.z *= 0.3;
      return;
    }
    if (fall > 4) sfx("land");
    const k = wish.lengthSq() === 0 ? 0.4 : Math.hypot(v.x, v.z) >= 15 ? 0.7 : 1;
    v.x *= k;
    v.z *= k;
  };

  const physics = (h: number, inp: Input) => {
    const held = inp.held;
    const dive = held.has("dive");
    switch (mode) {
      case "ground": {
        const target = swimming ? (sprinting ? SWIM_FAST : SWIM) : sprinting ? SPRINT : RUN;
        const flat = Math.hypot(v.x, v.z);
        const k = 1 - Math.exp(-(flat > target + 2 ? 3 : swimming ? 3 : 10) * h);
        v.x += (wish.x * target - v.x) * k;
        v.z += (wish.z * target - v.z) * k;
        v.y -= G * h;
        break;
      }
      case "air":
        airStep(h, dive);
        break;
      case "swing":
        if (ropeLive) swingStep(h);
        else {
          airStep(h, false);
          webT += h;
          if (webT >= WEB_TRAVEL) landWeb();
        }
        break;
      case "wall":
        wallStep(h, held);
        break;
      case "zip":
        v.copy(zipDir).multiplyScalar(ZIP);
        if (zipT < WEB_TRAVEL && zipT + h >= WEB_TRAVEL) sfx("webImpact", 0.25);
        zipT += h;
        break;
      case "launch":
        launchT += h;
        if (launchArrived) v.set(0, 0, 0);
        else {
          v.copy(launchTarget).sub(p);
          const d = v.length();
          if (d < 1.2) {
            p.copy(launchTarget);
            v.set(0, 0, 0);
            launchArrived = true;
            launchT = 0;
            grounded = true;
            sfx("land", 0.7);
            if (perchIntent) {
              mode = "perch";
              sfx("land", 0.4);
            } else if (launchBuffered) highLaunch(inp.look);
          } else v.multiplyScalar(LAUNCH / d);
        }
        break;
      case "perch":
        v.set(0, 0, 0);
        break;
      case "wings":
        wingStep(h, inp.look, dive);
        break;
    }
    if (mode !== "wall") wallAwayT = 0;

    if (lungeSpeed > 0) {
      tmp.set(lungeTo.x - p.x, 0, lungeTo.z - p.z);
      const d = tmp.length();
      if (d > 0.8) {
        tmp.multiplyScalar(lungeSpeed / d);
        v.x = tmp.x;
        v.z = tmp.z;
      }
    }

    if (v.length() > MAX_SPEED) v.setLength(MAX_SPEED);
    p.addScaledVector(v, h);

    if (mode === "swing" && ropeLive) {
      ropeConstraint();
      if (swingT > 0.3 && v.y > 0 && p.y > anchor.y - 3) release(false, false);
    }
    if (mode === "wall") wrapCorner();

    if (mode === "launch" && !launchArrived) return;
    const pre = v.length();
    const fall = -v.y;
    collide();
    collideCars(h);
    edge(h);

    if (mode === "zip" && striking && p.distanceTo(zipTarget) < 2.4) {
      events.push(...hooks.strikeHit(p, 1));
      sfx("hit");
      shake(0.35);
      v.copy(zipDir).multiplyScalar(-7).addScaledVector(UP, 10);
      kickT = 0;
      striking = false;
      mode = "air";
    }
    if (mode === "zip" && (p.distanceTo(zipTarget) < 2 || (zipT > 0.15 && (wallContact || grounded)) || zipT > 4)) {
      v.copy(zipDir).multiplyScalar(16).addScaledVector(UP, 14);
      striking = false;
      mode = "air";
    }
    if (grounded && (mode === "air" || mode === "swing" || mode === "wings" || (mode === "wall" && v.y <= 0.1 && !wallContact))) land(fall, held);
    if (mode === "ground" && !grounded) {
      mode = "air";
      coyoteT = COYOTE;
    }
    if (cornerHit && !wallContact && (mode === "swing" || mode === "wings")) {
      mode = "air";
      v.addScaledVector(cornerHitN, 3);
    }
    if (wallContact && !(cornerT > 0 && wallBox === cornerBox) && mode !== "wall" && mode !== "zip" && mode !== "launch" && mode !== "perch") {
      const into = -wish.dot(wallN);
      if (mode === "swing" || mode === "wings") {
        mode = "air";
        v.addScaledVector(wallN, 3);
      } else if (ceiling === Infinity && into > 0.7 && (mode === "ground" || (mode === "air" && !held.has("swing")))) enterWall(mode === "air" ? pre : 0);
    }
    if (mode === "wall") {
      if (!wallContact) {
        v.addScaledVector(wallN, 3);
        mode = "air";
      } else if (wallBox && p.y > wallBox.maxY + R - 0.6 && v.y > 0) {
        v.copy(wallN).multiplyScalar(-7).addScaledVector(UP, 8);
        mode = "air";
      } else if (grounded && v.y <= 0.1 && wish.dot(wallN) > -0.5) mode = "ground";
    }
    if (p.y < -30) reset();
  };

  const wallAhead = (look: THREE.Vector3) => {
    if (wallContact) return true;
    heading.set(v.x, 0, v.z);
    if (heading.lengthSq() < 4) heading.set(look.x, 0, look.z);
    if (wish.lengthSq() > 0) heading.copy(wish);
    if (heading.lengthSq() < 1e-4) return false;
    heading.normalize();
    return raycast(city, p, heading, 6) >= 0;
  };

  const decide = (inp: Input, dt: number) => {
    const pressed = inp.pressed;
    const look = inp.look;
    const airborne = mode === "air" || mode === "wings";

    if (pressed.has("launch") && !blockE) {
      eT = 0;
      eFired = false;
    }
    if (eT >= 0 && inp.held.has("launch") && !eFired && inp.holdTime("launch") >= PERCH_HOLD && hasPrompt) {
      eFired = true;
      startLaunch(true);
    }
    if (eT >= 0 && inp.released.has("launch")) {
      if (!eFired && hasPrompt) startLaunch(false);
      eT = -1;
    }

    const canSwing = (m: PlayerMode) => m === "air" || m === "wings" || (inp.swingFromMouse && (m === "ground" || m === "wall" || m === "perch"));
    if (pressed.has("swing") && canSwing(mode) && !tryAttach(mode)) {
      swingRetry = SWING_RETRY;
      retryFrom = mode;
    } else if (swingRetry > 0) {
      if (!inp.held.has("swing") || mode !== retryFrom) {
        swingRetry = 0;
        if (mode === retryFrom) sfx("whiff", 0.6);
      } else if (!tryAttach(mode)) {
        swingRetry -= dt;
        if (swingRetry <= 0) sfx("whiff", 0.6);
      }
    }
    if (inp.released.has("swing") && mode === "swing") release(true, false);

    if (pressed.has("jump")) {
      if (mode === "ground" || (mode === "air" && coyoteT > 0)) {
        v.y = swimming ? JUMP + 2 : JUMP + (sprinting ? 3 : 0);
        mode = "air";
        coyoteT = 0;
      } else if (mode === "swing") release(true, true);
      else if (mode === "wall") {
        v.copy(wallN).multiplyScalar(13).addScaledVector(UP, 10);
        mode = "air";
        sfx("whoosh", 0.5);
      } else if (mode === "perch") {
        tmp.set(look.x, 0, look.z).normalize();
        v.copy(tmp).multiplyScalar(7).addScaledVector(UP, 13);
        mode = "air";
      } else if (mode === "launch") {
        if (launchArrived) highLaunch(look);
        else if (launchT * LAUNCH > launchLen - 14) launchBuffered = true;
      } else if (airborne && dashCd <= 0 && !camRay(look, inp.camPos, DASH_RANGE)) {
        sfx("whiff", 0.6);
        dashCd = 0.3;
      } else if (airborne && dashCd <= 0) {
        dashTo.copy(hitP);
        tmp.set(look.x, 0, look.z).normalize();
        const s = Math.max(30, Math.hypot(v.x, v.z) + 6);
        v.copy(tmp).multiplyScalar(s);
        v.y = 4;
        mode = "air";
        dashCd = DASH_CD;
        dashT = 0.3;
        webHand = sideOf(dashTo, inp.camPos);
        webGrow = 0;
        trick = null;
        sfx("zip");
      }
    }

    if (pressed.has("wings")) {
      if (mode === "air") {
        mode = "wings";
        wingDir.set(v.x, 0, v.z);
        if (wingDir.lengthSq() < 1) wingDir.set(look.x, 0, look.z);
        wingDir.normalize();
        trick = null;
        sfx("glide");
      } else if (mode === "wings") mode = "air";
    }

    if (pressed.has("trick") && mode === "air" && !trick) {
      tmp.set(look.x, 0, look.z).normalize();
      const fwd = wish.dot(tmp);
      const side = wish.x * -tmp.z + wish.z * tmp.x;
      const kind: Trick = wish.lengthSq() < 0.01 ? "split" : Math.abs(side) > Math.abs(fwd) ? "corkscrew" : fwd > 0 ? "flip" : "backflip";
      trick = { kind, t: 0 };
      sfx("whoosh", 0.5);
    }
    if (pressed.has("web") && !hooks.inCombat() && mode !== "zip" && mode !== "launch") startZip(look, inp.camPos);
    if (pressed.has("strike") && mode !== "zip" && mode !== "launch") startStrike(inp.camPos);

    if (mode === "perch" && wish.lengthSq() > 0) mode = "ground";

    // A new web needs a new press. Holding swing in the air with no anchor in reach dives toward the roofs.
    if (inp.held.has("swing") && mode === "air" && airTime > 0.15 && diveCheckT <= 0 && swingRetry <= 0) {
      diveCheckT = 0.2;
      dove = !wallAhead(look) && !aimOk();
    }
    diveAssist = dove && !wallContact && inp.held.has("swing") && mode === "air";
    if (mode === "swing" && swingT > 4) release(false, false);
  };

  const quatTarget = new THREE.Quaternion();
  const basis = new THREE.Matrix4();
  const ou = new THREE.Vector3();
  const of = new THREE.Vector3();
  const ox = new THREE.Vector3();
  const orient = (up: THREE.Vector3, fwd: THREE.Vector3, dt: number) => {
    ou.copy(up).normalize();
    of.copy(fwd).addScaledVector(ou, -fwd.dot(ou));
    if (of.lengthSq() < 1e-4) of.copy(facing).addScaledVector(ou, -facing.dot(ou));
    if (of.lengthSq() < 1e-4) of.set(0, 0, 1);
    of.normalize();
    ox.crossVectors(ou, of);
    basis.makeBasis(ox, ou, of);
    quatTarget.setFromRotationMatrix(basis);
    hero.root.quaternion.slerp(quatTarget, 1 - Math.exp(-10 * dt));
  };

  const handPos = new THREE.Vector3();
  const vdir = new THREE.Vector3();
  const lean = new THREE.Vector3();

  const visuals = (dt: number, t: number, camPos: THREE.Vector3) => {
    const flat = Math.hypot(v.x, v.z);
    if (flat > 0.5 && mode !== "wall" && mode !== "perch") facing.set(v.x, 0, v.z).normalize();
    let pose: HeroPose = "idle";
    let progress = phase;
    vdir.copy(v).normalize();
    launchAnimT = Math.min(1, launchAnimT + dt / 0.9);
    if (mode !== "air") launchAnimT = 1;
    if (actPose) {
      pose = actPose;
      progress = actProgress;
      orient(UP, facing, dt);
    } else if (mode === "ground" && swimming) {
      // Stroke when moving, tread water upright when still.
      const stroke = THREE.MathUtils.clamp(flat / SWIM, 0, 1);
      pose = "swim";
      phase += Math.max(flat, 1.2) * dt * 0.45;
      progress = phase;
      orient(ou.copy(UP).lerp(facing, 0.82 * stroke), of.copy(facing).lerp(DOWN, 0.82 * stroke), dt);
    } else if (mode === "ground") {
      pose = landT < 1 ? "land" : flat > 14 ? "sprint" : flat > 0.5 ? "run" : "idle";
      phase += flat * dt * 0.85;
      progress = pose === "land" ? landT : phase;
      orient(UP, facing, dt);
    } else if (mode === "air") {
      const dive = THREE.MathUtils.clamp((-v.y - 12) / 20, 0, 1) * (vaultT > 0 ? 0 : 1);
      if (trick) [pose, progress] = [trick.kind, trick.t];
      else if (dashT > 0) pose = "zip";
      else if (kickT < 1) [pose, progress] = ["kick", kickT];
      else if (launchAnimT < 1) [pose, progress] = ["launch", launchAnimT];
      else if (dive > 0.4 || diveAssist) pose = "dive";
      else pose = "air";
      lean.copy(DOWN);
      orient(ou.copy(UP).lerp(vdir, dive), of.copy(facing).lerp(lean, dive), dt);
    } else if (mode === "swing") {
      pose = "swing";
      phase += dt * 2.2;
      orient(ropeLive ? tmp.copy(anchor).sub(p) : UP, v.lengthSq() > 1 ? v : facing, dt);
    } else if (mode === "wall") {
      pose = "wall";
      phase += Math.max(v.length(), 3) * dt * 0.85;
      orient(wallN, Math.abs(v.y) > 1 || flat < 0.5 ? UP : v, dt);
    } else if (mode === "wings") {
      pose = "wings";
      orient(ou.copy(UP).lerp(vdir, 0.85), of.copy(facing).lerp(DOWN, 0.85), dt);
    } else if (mode === "perch") {
      pose = "perch";
      orient(UP, facing, dt);
    } else if (mode === "launch") {
      pose = launchArrived ? "perch" : "zip";
      progress = launchT;
      orient(UP, launchArrived ? facing : tmp.copy(launchTarget).sub(launchFrom), dt);
    } else {
      pose = striking && zipT > 0.1 ? "kick" : "zip";
      progress = striking ? 0.3 : zipT;
      orient(UP, zipDir, dt);
    }
    hero.root.position.copy(rp);
    if (swimming) hero.root.position.y += Math.sin(t * 2.6) * 0.06;
    hero.animate(pose as Parameters<Hero["animate"]>[0], progress, webHand, t, dt);
    hero.root.updateMatrixWorld(true);

    const webOn = mode === "swing" || mode === "zip" || (mode === "launch" && !launchArrived) || dashT > 0.1;
    const dashing = dashT > 0.1 && mode === "air";
    if (webOn) {
      webGrow = mode === "swing" ? Math.min(1, webT / WEB_TRAVEL) : mode === "zip" ? Math.min(1, zipT / WEB_TRAVEL) : Math.min(1, webGrow + dt / WEB_TRAVEL);
      hero.handWorld(webHand, handPos);
    }
    const taut = mode !== "swing" || (ropeLive && p.distanceTo(anchor) > rope - 0.1);
    webLine.update(dt, handPos, dashing ? dashTo : anchor, dashing ? ZERO : anchorN, webGrow, taut, webOn, camPos);
    webLine.preview(aimOk() && mode !== "zip" && mode !== "launch" ? aim.point : null, aim.kind);

    marker.visible = hasPrompt && mode !== "launch";
    if (marker.visible) {
      marker.position.copy(promptCorner).addScaledVector(UP, 0.9 + Math.sin(t * 4) * 0.08);
      marker.rotation.y = t * 2;
      marker.scale.setScalar(Math.max(1, p.distanceTo(promptCorner) / 9));
    }

    const gy = groundAt(city, rp.x, rp.z, rp.y);
    const hgt = rp.y - R - gy;
    blob.visible = hgt < 14 && mode !== "wall" && !swimming;
    if (blob.visible) {
      blob.position.set(rp.x, gy + 0.04, rp.z);
      const s = 0.7 + hgt * 0.06;
      blob.scale.set(s, 1, s);
      (blob.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - hgt / 14) * 0.9;
    }
  };

  const spawnFacing = new THREE.Vector3(0, 0, -1);
  let snapped = false;
  const snap = () => {
    pPrev.copy(p);
    rp.copy(p);
    snapped = true;
  };
  const reset = () => {
    p.copy(spawn);
    snap();
    v.set(0, 0, 0);
    facing.copy(spawnFacing);
    hero.root.quaternion.setFromUnitVectors(tmp.set(0, 0, 1), facing);
    mode = "perch";
    trick = null;
  };

  spawnFacing.copy(spawnDir);
  reset();

  // Combat movement drops webs, wings and perches.
  const detach = () => {
    if (mode !== "swing" && mode !== "wings" && mode !== "zip" && mode !== "perch") return;
    mode = "air";
    striking = false;
  };

  const api = {
    // Drawn position: the fixed physics step blended to the frame time.
    get pos() {
      return rp;
    },
    get vel() {
      return v;
    },
    get mode() {
      return mode;
    },
    get facing() {
      return facing;
    },
    get grounded() {
      return grounded;
    },
    get airTime() {
      return airTime;
    },
    get swimming() {
      return swimming;
    },
    // Room height above the floor. Finite indoors: caps jumps and turns off wall runs.
    get ceiling() {
      return ceiling;
    },
    set ceiling(y: number) {
      ceiling = y;
    },
    // True while another module owns E (doors), so E does not launch.
    get blockE() {
      return blockE;
    },
    set blockE(b: boolean) {
      blockE = b;
      if (b) eT = -1;
    },
    busy: false,
    act(pose: HeroPose, progress: number) {
      actPose = pose;
      actProgress = progress;
    },
    lunge(to: THREE.Vector3, speed: number) {
      detach();
      lungeTo.copy(to);
      lungeSpeed = speed;
    },
    push(impulse: THREE.Vector3) {
      detach();
      v.add(impulse);
      if (impulse.y > 0 && (mode === "ground" || mode === "perch")) mode = "air";
    },
    face(dir: THREE.Vector3) {
      if (dir.x * dir.x + dir.z * dir.z > 1e-6) facing.set(dir.x, 0, dir.z).normalize();
    },
    teleport(pos: THREE.Vector3) {
      p.copy(pos);
      snap();
      v.set(0, 0, 0);
      mode = "air";
    },
    get swingAnchor() {
      return mode === "swing" ? anchor : null;
    },
    get wallNormal() {
      return mode === "wall" ? wallN : null;
    },
    get boost() {
      return boostT;
    },
    aim,
    prompts,
    reset,
    update(dt: number, inp: Input, t: number) {
      events.length = 0;
      if (api.busy) wish.set(0, 0, 0);
      else wish.copy(inp.wish);
      sprinting = !api.busy && inp.held.has("swing") && wish.lengthSq() > 0;
      computeAim(inp.camPos, inp.look);
      if (!api.busy) decide(inp, dt);
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < MAX_STEPS) {
        pPrev.copy(p);
        physics(STEP, inp);
        if (snapped) pPrev.copy(p);
        snapped = false;
        acc -= STEP;
        steps++;
      }
      if (steps === MAX_STEPS) acc = 0;
      rp.lerpVectors(pPrev, p, acc / STEP);

      dashCd = Math.max(0, dashCd - dt);
      dashT = Math.max(0, dashT - dt);
      boostT = Math.max(0, boostT - dt);
      vaultT = Math.max(0, vaultT - dt);
      cornerT -= dt;
      edgeT -= dt;
      diveCheckT -= dt;
      coyoteT = Math.max(0, coyoteT - dt);
      sinceRelease += dt;
      if (mode === "launch" && launchArrived && launchT > 0.35) mode = "ground";
      airTime = mode === "air" || mode === "swing" || mode === "zip" || mode === "wings" ? airTime + dt : 0;
      kickT = Math.min(1, kickT + dt / 0.45);
      landT = Math.min(1, landT + dt / 0.5);
      if (trick) {
        trick.t += dt / 0.6;
        if (mode !== "air") trick = null;
        else if (trick.t >= 1) {
          events.push(...hooks.trick(trick.kind === "flip" || trick.kind === "backflip" ? "flip" : "spin", airTime));
          sfx("trick");
          trick = null;
        }
      }
      promptT -= dt;
      if (promptT <= 0) {
        promptT = 0.1;
        findPrompt(inp.look);
      }
      prompts.length = 0;
      if (hasPrompt && mode !== "launch") prompts.push({ key: "E", label: mode === "perch" ? "Launch" : "Launch, hold to perch" });
      if (mode === "launch" && launchArrived) prompts.push({ key: "Space", label: "High launch" });

      visuals(dt, t, inp.camPos);
      actPose = null;
      lungeSpeed = 0;
      return events;
    },
    dispose() {
      webLine.dispose();
      scene.remove(marker, blob);
      for (const m of [marker, blob]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      blobTex.dispose();
    },
  };
  return api satisfies PlayerApi;
}

export type Player = ReturnType<typeof createPlayer>;
