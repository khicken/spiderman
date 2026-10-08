import * as THREE from "three";
import type { Box, City } from "./city";
import type { CarBox } from "./city-cars";
import type { Hero } from "./hero";
import type { GameEvent, HeroPose, Input, PlayerApi, PlayerMode, Sfx } from "./contracts";

export const R = 0.95;
const G = 24;
const G_SWING = 16;
const RUN = 11;
const SPRINT = 20;
const JUMP = 11;
const ZIP = 70;
const LAUNCH = 50;
const MAX_SPEED = 75;
const SWING_MIN = 18;
const SWING_MAX = 45;
const ROPE_MIN = 12;
const ROPE_MAX = 35;
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
  if (!slab(o.x, d.x, b.minX, b.maxX, 0) || !slab(o.y, d.y, 0, b.maxY, 1) || !slab(o.z, d.z, b.minZ, b.maxZ, 2)) return -1;
  if (tMin < 0) return -1;
  n?.set(hitAxis === 0 ? hitSign : 0, hitAxis === 1 ? hitSign : 0, hitAxis === 2 ? hitSign : 0);
  return tMin;
}

const _n = new THREE.Vector3();
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
  for (const b of city.near(x, z, 2)) if (x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad && y < b.maxY + pad) return true;
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
    if (c.y > b.maxY + e || c.y < -e) continue;
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
  // Physics pivot: the anchor moved toward the travel plane, so the arc runs along the street.
  const pivot = new THREE.Vector3();
  let rope = 0;
  let ropeGoal = 0;
  let swingCap = SWING_MAX;
  let swingT = 0;
  let lastSide = 0;
  let sinceRelease = 9;
  let retryT = 0;
  let swingFloor = 0;
  let diveAssist = false;
  let dove = false;
  let webHand: "L" | "R" = "R";
  let webGrow = 0;

  const wallN = new THREE.Vector3();
  let wallBox: Box | null = null;
  let wallContact = false;
  let wallMomentum = 0;
  let cornerBox: Box | null = null;
  let cornerT = 0;
  const vPre = new THREE.Vector3();
  const nPre = new THREE.Vector3();

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
  let trick: { kind: "flip" | "spin"; t: number } | null = null;
  let kickT = 1;
  let landT = 1;
  let boostT = 0;
  let vaultT = 0;
  let phase = 0;

  const wingDir = new THREE.Vector3();
  let wingSpeed = 0;
  let wingVy = 0;

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

  const sfx = (name: Sfx, volume?: number) => events.push({ type: "sfx", name, volume });
  const shake = (strength: number) => events.push({ type: "shake", strength });

  const webMat = new THREE.MeshBasicMaterial({ color: "#f4f6ff" });
  const web = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 5).translate(0, 0.5, 0), webMat);
  web.visible = false;
  const splat = new THREE.Mesh(new THREE.CircleGeometry(0.45, 10), new THREE.MeshBasicMaterial({ color: "#eef2ff", side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
  splat.visible = false;
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
  scene.add(web, splat, marker, blob);

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
      if (ahead < minAhead || ahead > 40 || dy < 4 || Math.abs(side) > 26) return;
      if (dx * dx + dy * dy + dz * dz > 55 * 55) return;
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
    for (const b of city.near(p.x, p.z, 55)) {
      if (b.maxY < p.y + 4) continue;
      const lo = Math.max(b.maxY * 0.6, p.y + 4);
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
    if (extra) for (const a of extra) if (Math.abs(a.x - p.x) < 55 && Math.abs(a.z - p.z) < 55) consider(a.x, a.y, a.z, 0, 0);
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

  const attach = (look: THREE.Vector3, fresh: boolean) => {
    const c = findAnchor(look);
    if (!c) {
      if (fresh) sfx("whiff", 0.6);
      return false;
    }
    anchor.copy(c.p);
    anchorN.copy(c.n);
    if (DEV && c.n.lengthSq() > 0 && !onCollider(city, anchor)) console.error("anchor off collider", anchor.toArray());
    lastSide = Math.sign(c.side) || 1;
    webHand = lastSide > 0 ? "R" : "L";
    pivot.copy(anchor).addScaledVector(right, -0.9 * c.side);
    const dist = p.distanceTo(pivot);
    swingFloor = groundAt(city, pivot.x, pivot.z, pivot.y);
    ropeGoal = Math.max(5, Math.min(THREE.MathUtils.clamp(dist, ROPE_MIN, ROPE_MAX), pivot.y - swingFloor - 3));
    rope = Math.max(dist, ropeGoal);
    swingCap = Math.min(60, Math.max(SWING_MAX, v.length()));
    swingT = 0;
    webGrow = 0;
    trick = null;
    wingSpeed = 0;
    mode = "swing";
    sfx("thwip");
    return true;
  };

  const pastBottom = () => {
    tmp.copy(p).sub(pivot);
    const fl = Math.hypot(v.x, v.z) || 1;
    return Math.atan2((tmp.x * v.x + tmp.z * v.z) / fl, -tmp.y);
  };

  const release = (manual: boolean, jump: boolean) => {
    const ang = pastBottom();
    tmp.set(v.x, 0, v.z).normalize();
    v.addScaledVector(UP, manual ? 4 : 1.5).addScaledVector(tmp, 2);
    if (manual && ang > 10 * DEG && ang < 35 * DEG) {
      v.multiplyScalar(1.2);
      if (v.length() > 55) v.setLength(55);
      boostT = 0.5;
      sfx("whoosh");
    }
    if (jump) v.y += 6;
    mode = "air";
    sinceRelease = 0;
    retryT = 0.25;
  };

  const startZip = (look: THREE.Vector3, camPos: THREE.Vector3) => {
    const skip = camPos.distanceTo(p);
    const t = raycast(city, camPos, look, skip + ZIP_RANGE, tmp);
    if (t < skip || t - skip > ZIP_RANGE) {
      sfx("whiff", 0.6);
      return false;
    }
    anchor.copy(camPos).addScaledVector(look, t);
    anchorN.copy(tmp);
    zipTarget.copy(anchor).addScaledVector(tmp, R + 0.2);
    if (tmp.y > 0.5) zipTarget.y += 0.5;
    zipDir.copy(zipTarget).sub(p).normalize();
    webHand = "R";
    webGrow = 0;
    zipT = 0;
    striking = false;
    trick = null;
    mode = "zip";
    sfx("zip");
    return true;
  };

  const startStrike = () => {
    const target = hooks.strikeTarget(p, 40);
    if (!target) return;
    zipTarget.copy(target);
    zipDir.copy(target).sub(p).normalize();
    anchor.copy(target);
    anchorN.set(0, 0, 0);
    webHand = "R";
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
    wallMomentum = speed * 0.9;
    tmp.copy(v).addScaledVector(wallN, -v.dot(wallN));
    if (tmp.lengthSq() < 1) tmp.copy(UP);
    v.copy(tmp.normalize()).multiplyScalar(Math.max(speed * 0.9, 4));
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

  const collideBox = (b: Box) => {
    const x0 = b.minX - R;
    const x1 = b.maxX + R;
    const z0 = b.minZ - R;
    const z1 = b.maxZ + R;
    const top = b.maxY + R;
    if (p.x <= x0 || p.x >= x1 || p.z <= z0 || p.z >= z1 || p.y >= top) return;
    const up = top - p.y;
    let m = 0;
    let pen = p.x - x0;
    if (x1 - p.x < pen) [m, pen] = [1, x1 - p.x];
    if (p.z - z0 < pen) [m, pen] = [2, p.z - z0];
    if (z1 - p.z < pen) [m, pen] = [3, z1 - p.z];
    const stepUp = (mode === "ground" || mode === "air") && up < 1.0 && v.y <= 1;
    if (up < pen || stepUp) {
      p.y = top;
      if (v.y < 0) v.y = 0;
      grounded = true;
      swimming = false;
      return;
    }
    if (m === 0) p.x = x0;
    else if (m === 1) p.x = x1;
    else if (m === 2) p.z = z0;
    else p.z = z1;
    const n = tmp.set(m === 0 ? -1 : m === 1 ? 1 : 0, 0, m === 2 ? -1 : m === 3 ? 1 : 0);
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
  };

  const collide = () => {
    grounded = false;
    wallContact = false;
    swimming = false;
    const fl = hooks.floorAt?.(p.x, p.z) ?? 0;
    if (p.y < fl + R) {
      p.y = fl + R;
      if (v.y < 0) v.y = 0;
      grounded = true;
      swimming = fl < -0.5;
    }
    for (const b of city.near(p.x, p.z, 8)) collideBox(b);
    if (hooks.extraBoxes) for (const b of hooks.extraBoxes(p.x, p.z)) collideBox(b);
    if (p.y > ceiling - R) {
      p.y = ceiling - R;
      if (v.y > 0) v.y = 0;
    }
  };

  const physics = (h: number, inp: Input) => {
    const held = inp.held;
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
      case "air": {
        let g = G;
        if (held.has("dive")) g *= 1.9;
        else if (diveAssist) g *= 1.6;
        v.y = Math.max(v.y - g * h, held.has("dive") ? -62 : -48);
        const along = v.x * wish.x + v.z * wish.z;
        if (along < 16) v.addScaledVector(wish, 9 * h);
        break;
      }
      case "swing": {
        v.y -= G_SWING * h;
        if (rope > ropeGoal) rope = Math.max(ropeGoal, rope - 30 * h);
        const n = tmp.copy(pivot).sub(p).normalize();
        const below = p.y < pivot.y - 2;
        const tan = tmp2.copy(v).addScaledVector(n, -v.dot(n));
        const ts = tan.length();
        if (below && ts > 0.1) {
          tan.divideScalar(ts);
          v.addScaledVector(tan, (9 + (ts < SWING_MIN ? 22 : 0)) * h);
        }
        const steer = wish.dot(n);
        v.addScaledVector(wish, 10 * h).addScaledVector(n, -steer * 10 * h);
        if (anchorN.lengthSq() > 0) {
          const out = (p.x - anchor.x) * anchorN.x + (p.z - anchor.z) * anchorN.z;
          v.addScaledVector(anchorN, (2.5 + Math.max(0, 6 - out) * 4) * h);
        }
        const clear = p.y - R - swingFloor;
        if (n.y > 0.85 && clear < 9) v.y += 12 * (1 - clear / 9) * h;
        if (v.length() > swingCap) v.setLength(swingCap);
        break;
      }
      case "wall": {
        const n = wallN;
        tmp.copy(wish).addScaledVector(n, -wish.dot(n));
        const into = -wish.dot(n);
        const run = Math.max(held.has("swing") ? 12 : 8, wallMomentum);
        wallMomentum = Math.max(0, wallMomentum - 20 * h);
        if (wish.lengthSq() === 0) {
          tmp2.copy(v).multiplyScalar(wallMomentum > 13 ? 1 : 0);
          if (wallMomentum > 13) tmp2.setLength(wallMomentum);
        } else if (into > 0.5) tmp2.copy(UP).multiplyScalar(run).addScaledVector(tmp, run * 0.5);
        else tmp2.copy(tmp).normalize().multiplyScalar(run).addScaledVector(UP, Math.max(0, v.y) * 0.5);
        v.lerp(tmp2, 1 - Math.exp(-8 * h));
        v.addScaledVector(n, -v.dot(n) - 2);
        break;
      }
      case "zip":
        v.copy(zipDir).multiplyScalar(ZIP);
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
      case "wings": {
        tmp.set(inp.look.x, 0, inp.look.z);
        if (wish.lengthSq() > 0) tmp.addScaledVector(wish, 0.8);
        if (tmp.lengthSq() > 1e-4) {
          tmp.normalize();
          const turn = Math.atan2(wingDir.x * tmp.z - wingDir.z * tmp.x, wingDir.dot(tmp));
          const a = THREE.MathUtils.clamp(turn, -1.7 * h, 1.7 * h);
          wingDir.applyAxisAngle(UP, -a).normalize();
        }
        if (held.has("dive")) {
          wingVy += (-30 - wingVy) * 1.2 * h;
          wingSpeed = Math.min(55, wingSpeed + 12 * h);
        } else {
          if (wingVy < -4) wingSpeed = Math.min(55, wingSpeed + -wingVy * 0.2 * h);
          wingVy += (-3 - wingVy) * 1.6 * h;
          wingSpeed += (Math.min(wingSpeed, 14) - wingSpeed) * 0.2 * h;
          wingSpeed = Math.max(wingSpeed - 0.6 * h, 10);
        }
        v.copy(wingDir).multiplyScalar(wingSpeed).addScaledVector(UP, wingVy);
        break;
      }
    }

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

    if (mode === "swing") {
      tmp.copy(p).sub(pivot);
      const len = tmp.length();
      if (len > rope) {
        tmp.multiplyScalar(rope / len);
        p.copy(pivot).add(tmp);
        const n = tmp.normalize();
        const vr = v.dot(n);
        if (vr > 0) v.addScaledVector(n, -vr);
      }
      if (p.y > pivot.y - 0.5) release(false, false);
    }

    if (mode === "launch" && !launchArrived) return;
    const pre = v.length();
    const fall = -v.y;
    const wasWall = mode === "wall";
    vPre.copy(v);
    nPre.copy(wallN);
    const boxPre = wallBox;
    collide();
    collideCars(h);
    if (wasWall && wallContact && wallBox === boxPre && wallN.dot(nPre) < 0.5) {
      v.copy(vPre).addScaledVector(nPre, 3);
      wallN.copy(nPre);
      cornerBox = boxPre;
      cornerT = 0.35;
      mode = "air";
      wallContact = false;
    }

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
    if (grounded && (mode === "air" || mode === "swing" || mode === "wings" || (mode === "wall" && v.y <= 0.1 && !wallContact))) {
      if (swimming) {
        // The water module plays the splash.
      } else if (fall > 28) {
        events.push(...hooks.strikeHit(p, 2));
        sfx("bigLand");
        shake(0.7);
        landT = 0;
      } else if (fall > 4) sfx("land");
      trick = null;
      mode = "ground";
    }
    if (mode === "ground" && !grounded) mode = "air";
    if (wallContact && !(cornerT > 0 && wallBox === cornerBox) && mode !== "wall" && mode !== "zip" && mode !== "launch" && mode !== "perch") {
      const into = -wish.dot(wallN);
      if (mode === "swing" || mode === "wings") {
        mode = "air";
        v.addScaledVector(wallN, 3);
      } else if (ceiling === Infinity && into > 0.7 && (mode === "ground" || (mode === "air" && !held.has("swing")))) enterWall(mode === "air" ? Math.min(pre, 12) : 0);
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

  const decide = (inp: Input) => {
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

    if (pressed.has("swing") && airborne) attach(look, true);
    else if (pressed.has("swing") && inp.swingFromMouse && (mode === "ground" || mode === "wall" || mode === "perch")) {
      const from = mode;
      if (attach(look, true)) {
        if (from === "wall") v.copy(wallN).multiplyScalar(8).addScaledVector(UP, 6);
        else v.y = Math.max(v.y, JUMP * 0.8);
      }
    }
    if (inp.released.has("swing") && mode === "swing") release(true, false);

    if (pressed.has("jump")) {
      if (mode === "ground") {
        v.y = swimming ? JUMP + 2 : JUMP + (sprinting ? 3 : 0);
        mode = "air";
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
      } else if (airborne && dashCd <= 0 && raycast(city, p, look, 40, tmp2) < 0) {
        sfx("whiff", 0.6);
        dashCd = 0.3;
      } else if (airborne && dashCd <= 0) {
        const hitT = raycast(city, p, look, 40, tmp2);
        tmp.set(look.x, 0, look.z).normalize();
        const s = Math.max(30, Math.hypot(v.x, v.z) + 6);
        v.copy(tmp).multiplyScalar(s);
        v.y = 4;
        mode = "air";
        dashCd = DASH_CD;
        dashT = 0.3;
        dashTo.copy(p).addScaledVector(look, hitT);
        webHand = webHand === "R" ? "L" : "R";
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
        wingSpeed = Math.max(12, Math.hypot(v.x, v.z));
        wingVy = Math.max(v.y, -12);
        trick = null;
        sfx("glide");
      } else if (mode === "wings") mode = "air";
    }

    if (pressed.has("trick") && mode === "air" && !trick) {
      trick = { kind: Math.random() < 0.5 ? "flip" : "spin", t: 0 };
      sfx("whoosh", 0.5);
    }
    if (pressed.has("web") && !hooks.inCombat() && mode !== "zip" && mode !== "launch") startZip(look, inp.camPos);
    if (pressed.has("strike") && mode !== "zip" && mode !== "launch") startStrike();

    if (mode === "perch" && wish.lengthSq() > 0) mode = "ground";

    // A new web needs a new press. Holding swing in the air with no anchor in reach dives toward the roofs.
    if (inp.held.has("swing") && mode === "air" && airTime > 0.15 && retryT <= 0) {
      retryT = 0.2;
      dove = findAnchor(look) === null;
    }
    diveAssist = dove && inp.held.has("swing") && mode === "air";
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

  const visuals = (dt: number, t: number) => {
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
      pose = flat > 0.8 ? "run" : "air";
      phase += flat * dt * 0.45;
      progress = pose === "run" ? phase : t * 0.5;
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
      orient(tmp.copy(anchor).sub(p), v.lengthSq() > 1 ? v : facing, dt);
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
    hero.root.position.copy(p);
    if (swimming) hero.root.position.y += Math.sin(t * 2.6) * 0.06;
    hero.animate(pose as Parameters<Hero["animate"]>[0], progress, webHand, t, dt);
    hero.root.updateMatrixWorld(true);

    const webOn = mode === "swing" || mode === "zip" || (mode === "launch" && !launchArrived) || dashT > 0.1;
    if (webOn) {
      webGrow = Math.min(1, webGrow + dt * 9);
      hero.handWorld(webHand, handPos);
      tmp.copy(dashT > 0.1 && mode === "air" ? dashTo : anchor).sub(handPos);
      const len = tmp.length() * webGrow;
      web.position.copy(handPos);
      web.quaternion.setFromUnitVectors(UP, tmp.normalize());
      web.scale.set(1, len, 1);
    }
    web.visible = webOn;
    splat.visible = mode === "swing" && webGrow >= 1;
    if (splat.visible) {
      splat.position.copy(anchor).addScaledVector(anchorN, 0.03);
      if (anchorN.lengthSq() > 0) splat.lookAt(tmp.copy(anchor).add(anchorN));
      else splat.lookAt(p);
    }

    marker.visible = hasPrompt && mode !== "launch";
    if (marker.visible) {
      marker.position.copy(promptCorner).addScaledVector(UP, 0.9 + Math.sin(t * 4) * 0.08);
      marker.rotation.y = t * 2;
      marker.scale.setScalar(Math.max(1, p.distanceTo(promptCorner) / 9));
    }

    const gy = groundAt(city, p.x, p.z, p.y);
    const hgt = p.y - R - gy;
    blob.visible = hgt < 14 && mode !== "wall" && !swimming;
    if (blob.visible) {
      blob.position.set(p.x, gy + 0.04, p.z);
      const s = 0.7 + hgt * 0.06;
      blob.scale.set(s, 1, s);
      (blob.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - hgt / 14) * 0.9;
    }
  };

  const spawnFacing = new THREE.Vector3(0, 0, -1);
  const reset = () => {
    p.copy(spawn);
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
    get pos() {
      return p;
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
    prompts,
    reset,
    update(dt: number, inp: Input, t: number) {
      events.length = 0;
      if (api.busy) wish.set(0, 0, 0);
      else wish.copy(inp.wish);
      sprinting = !api.busy && inp.held.has("swing") && wish.lengthSq() > 0;
      if (!api.busy) decide(inp);
      for (let i = 0; i < 3; i++) physics(dt / 3, inp);

      dashCd = Math.max(0, dashCd - dt);
      dashT = Math.max(0, dashT - dt);
      boostT = Math.max(0, boostT - dt);
      vaultT = Math.max(0, vaultT - dt);
      cornerT -= dt;
      retryT -= dt;
      sinceRelease += dt;
      if (mode === "swing") swingT += dt;
      if (mode === "launch" && launchArrived && launchT > 0.35) mode = "ground";
      airTime = mode === "air" || mode === "swing" || mode === "zip" || mode === "wings" ? airTime + dt : 0;
      kickT = Math.min(1, kickT + dt / 0.45);
      landT = Math.min(1, landT + dt / 0.5);
      if (trick) {
        trick.t += dt / 0.6;
        if (mode !== "air") trick = null;
        else if (trick.t >= 1) {
          events.push(...hooks.trick(trick.kind, airTime));
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

      visuals(dt, t);
      actPose = null;
      lungeSpeed = 0;
      return events;
    },
    dispose() {
      scene.remove(web, splat, marker, blob);
      for (const m of [web, splat, marker, blob]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      blobTex.dispose();
    },
  };
  return api satisfies PlayerApi;
}

export type Player = ReturnType<typeof createPlayer>;
