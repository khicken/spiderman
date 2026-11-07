import * as THREE from "three";
import type { Dir, GameEvent, SimView, TeamData } from "./contracts";
import { COURT } from "./contracts";
import { canvas2d, canvasTexture, contrastOn, displayFont, fitText, shade, spacedText } from "./arena-tex";

// Both baskets: padded stanchion, glass backboard with LED edge and shot-clock unit, spring-loaded rim,
// and a verlet-cloth net that the ball physically pushes through.

const NC = 12; // knots around the rim
const NR = 8; // knot rows from rim to the bottom
const NODES = NC * NR;
const SEG_PER_NODE = 2; // each knot ties down-left and down-right
const SEGS = NC * (NR - 1) * SEG_PER_NODE;
const STEP = 1 / 120;
const STRING_R = 0.0042;

interface Net {
  side: Dir;
  pos: Float32Array;
  prev: Float32Array;
  rest: Float32Array; // local rest offsets from rim center
  links: Uint16Array; // pairs
  len: Float32Array;
  geo: THREE.BufferGeometry;
  mesh: THREE.Mesh;
}

interface Hoop {
  side: Dir;
  group: THREE.Group;
  rim: THREE.Group; // pivots at the board face
  angle: number;
  vel: number;
  twist: number;
  twistVel: number;
  net: Net;
  ledMat: THREE.MeshStandardMaterial;
  led: number;
}

export interface Hoops {
  readonly group: THREE.Group;
  setTeams(home: TeamData, away: TeamData): void;
  update(dt: number, view: SimView | null, time: number): void;
  handle(events: readonly GameEvent[]): void;
  /** Kick the net: swish snap / rim-in ripple / dunk yank. strength 0..1. */
  netKick(side: Dir, strength: number, kind?: "swish" | "rim" | "dunk"): void;
  /** Shake the rim (rim hit 0..1, dunk ~1). */
  rimHit(side: Dir, strength: number): void;
  /** Red LED edge glow around both backboards (end of period). */
  buzzer(on: boolean): void;
  dispose(): void;
}

export function createHoops(home: TeamData, _away: TeamData): Hoops {
  const group = new THREE.Group();
  group.name = "hoops";
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const g = <T extends THREE.BufferGeometry>(x: T) => (geos.push(x), x);
  const m = <T extends THREE.Material>(x: T) => (mats.push(x), x);

  const steel = m(new THREE.MeshStandardMaterial({ color: "#2a2e35", metalness: 0.75, roughness: 0.35 }));
  const darkSteel = m(new THREE.MeshStandardMaterial({ color: "#14161a", metalness: 0.6, roughness: 0.5 }));
  const rimMat = m(new THREE.MeshStandardMaterial({ color: "#ff4d12", metalness: 0.55, roughness: 0.3, emissive: "#3a0d00", emissiveIntensity: 0.25 }));
  const glassMat = m(new THREE.MeshPhysicalMaterial({
    color: "#d8eef6", metalness: 0, roughness: 0.03, transparent: true, opacity: 0.1, envMapIntensity: 1.3,
    depthWrite: false, side: THREE.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.02,
  }));
  const [bc, bctx] = canvas2d(1024, 600);
  drawBoardLines(bctx, bc.width, bc.height);
  const boardTex = canvasTexture(bc, true, 8);
  texs.push(boardTex);
  const boardLineMat = m(new THREE.MeshStandardMaterial({ map: boardTex, transparent: true, roughness: 0.25, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  const padMat = m(new THREE.MeshStandardMaterial({ color: home.primary, roughness: 0.72, metalness: 0 }));
  const padDark = m(new THREE.MeshStandardMaterial({ color: "#121318", roughness: 0.8, metalness: 0 }));
  const [pc, pctx] = canvas2d(512, 512);
  const padTex = canvasTexture(pc, true, 8);
  texs.push(padTex);
  const padFront = m(new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.7, metalness: 0 }));
  const netMat = m(new THREE.MeshStandardMaterial({ color: "#f4f6f8", roughness: 0.75, metalness: 0, emissive: "#ffffff", emissiveIntensity: 0.06 }));
  const [sc, sctx] = canvas2d(512, 256);
  const clockTex = canvasTexture(sc, true, 4);
  texs.push(clockTex);
  const clockMat = m(new THREE.MeshStandardMaterial({ color: "#000000", emissive: "#ffffff", emissiveMap: clockTex, emissiveIntensity: 3.2, roughness: 0.4 }));

  const boardY = COURT.boardBottom + COURT.boardH / 2;

  function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, shadow = true) {
    const mesh = new THREE.Mesh(g(new THREE.BoxGeometry(w, h, d)), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  const hoops: Hoop[] = [];
  for (const side of [-1, 1] as Dir[]) {
    const hg = new THREE.Group();
    hg.name = `hoop${side}`;
    group.add(hg);
    const s = side;
    const baseX = COURT.stanchionX;
    box(1.9, 1.05, 1.45, padMat, s * (baseX + 0.95), 0.525, 0, hg);
    const front = new THREE.Mesh(g(new THREE.PlaneGeometry(1.45, 1.0)), padFront);
    front.position.set(s * (baseX - 0.002), 0.53, 0);
    front.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    hg.add(front);
    box(1.6, 0.06, 1.2, padDark, s * (baseX + 1.0), 1.08, 0, hg);
    const colX = s * (baseX + 1.25);
    box(0.32, 3.1, 0.36, steel, colX, 1.05 + 1.55, 0, hg);
    box(0.5, 1.45, 0.52, padMat, colX, 1.05 + 0.72, 0, hg);
    const armEnd = s * (COURT.boardX + COURT.boardThick + 0.22);
    const armLen = Math.abs(colX - armEnd);
    box(armLen, 0.2, 0.22, steel, (colX + armEnd) / 2, 3.98, 0, hg);
    const brace = box(Math.hypot(armLen * 0.7, 1.5), 0.12, 0.14, darkSteel, colX - s * armLen * 0.35, 3.15, 0, hg);
    brace.rotation.z = s * Math.atan2(1.5, armLen * 0.7);
    box(0.12, 1.15, 0.9, darkSteel, s * (COURT.boardX + COURT.boardThick + 0.16), boardY + 0.1, 0, hg);
    box(0.14, 0.12, 0.9, darkSteel, s * (COURT.boardX + COURT.boardThick + 0.12), boardY + 0.62, 0, hg);
    const glass = box(COURT.boardThick, COURT.boardH, COURT.boardW, glassMat, s * (COURT.boardX + COURT.boardThick / 2), boardY, 0, hg, false);
    glass.renderOrder = 2;
    const lines = new THREE.Mesh(g(new THREE.PlaneGeometry(COURT.boardW, COURT.boardH)), boardLineMat);
    lines.position.set(s * (COURT.boardX - 0.001), boardY, 0);
    lines.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    lines.renderOrder = 3;
    hg.add(lines);
    const fx = s * (COURT.boardX + COURT.boardThick / 2);
    box(0.06, 0.03, COURT.boardW + 0.04, darkSteel, fx, COURT.boardBottom + COURT.boardH + 0.015, 0, hg);
    for (const z of [-1, 1]) box(0.06, COURT.boardH, 0.025, darkSteel, fx, boardY, z * (COURT.boardW / 2 + 0.012), hg);
    box(0.09, 0.06, COURT.boardW + 0.06, padDark, fx, COURT.boardBottom - 0.03, 0, hg);
    const ledMat = m(new THREE.MeshStandardMaterial({ color: "#200000", emissive: "#ff1a1a", emissiveIntensity: 0, roughness: 0.5 }));
    box(0.02, 0.018, COURT.boardW, ledMat, s * (COURT.boardX - 0.01), COURT.boardBottom + COURT.boardH + 0.01, 0, hg, false);
    for (const z of [-1, 1]) box(0.02, COURT.boardH, 0.018, ledMat, s * (COURT.boardX - 0.01), boardY, z * (COURT.boardW / 2), hg, false);
    const unitY = COURT.boardBottom + COURT.boardH + 0.3;
    const unit = new THREE.Mesh(g(new THREE.BoxGeometry(0.26, 0.5, 1.0)), darkSteel);
    unit.position.set(s * (COURT.boardX + 0.1), unitY, 0);
    unit.castShadow = true;
    hg.add(unit);
    for (const face of [-1, 1]) {
      const scr = new THREE.Mesh(g(new THREE.PlaneGeometry(0.92, 0.44)), clockMat);
      scr.position.set(s * (COURT.boardX + 0.1) + face * 0.131, unitY, 0);
      scr.rotation.y = face > 0 ? Math.PI / 2 : -Math.PI / 2;
      hg.add(scr);
    }
    box(0.08, 0.2, 0.08, darkSteel, s * (COURT.boardX + 0.1), unitY - 0.33, 0.3, hg);
    box(0.08, 0.2, 0.08, darkSteel, s * (COURT.boardX + 0.1), unitY - 0.33, -0.3, hg);

    const rim = new THREE.Group();
    rim.position.set(s * COURT.boardX, COURT.rimHeight, 0);
    hg.add(rim);
    const ringR = COURT.rimRadius + COURT.rimTube;
    const torus = new THREE.Mesh(g(new THREE.TorusGeometry(ringR, 0.0095, 10, 56)), rimMat);
    torus.rotation.x = Math.PI / 2;
    torus.position.set(-s * (COURT.boardX - COURT.rimX), -0.0095, 0);
    torus.castShadow = true;
    rim.add(torus);
    const neckLen = COURT.boardX - COURT.rimX - ringR;
    box(neckLen + 0.02, 0.025, 0.11, rimMat, -s * (neckLen / 2), -0.02, 0, rim);
    box(0.02, 0.2, 0.26, rimMat, -s * 0.01, -0.08, 0, rim);
    box(neckLen * 0.9, 0.012, 0.012, rimMat, -s * neckLen * 0.5, -0.06, 0.05, rim);
    box(neckLen * 0.9, 0.012, 0.012, rimMat, -s * neckLen * 0.5, -0.06, -0.05, rim);
    for (let i = 0; i < NC; i++) {
      const a = (i / NC) * Math.PI * 2;
      const hook = box(0.008, 0.02, 0.008, rimMat, torus.position.x + Math.cos(a) * ringR, -0.025, Math.sin(a) * ringR, rim, false);
      hook.castShadow = false;
    }

    const net = buildNet(s);
    group.add(net.mesh);
    hoops.push({ side: s, group: hg, rim, angle: 0, vel: 0, twist: 0, twistVel: 0, net, ledMat, led: 0 });
  }

  function buildNet(side: Dir): Net {
    const pos = new Float32Array(NODES * 3);
    const prev = new Float32Array(NODES * 3);
    const rest = new Float32Array(NODES * 3);
    const rTop = COURT.rimRadius - 0.004;
    const rBot = COURT.netBottomRadius * 0.92;
    for (let r = 0; r < NR; r++) {
      const t = r / (NR - 1);
      const rad = rBot + (rTop - rBot) * Math.pow(1 - t, 1.5);
      const y = -0.02 - t * (COURT.netLength - 0.02);
      for (let c = 0; c < NC; c++) {
        const a = ((c + (r % 2) * 0.5) / NC) * Math.PI * 2;
        const i = (r * NC + c) * 3;
        rest[i] = Math.cos(a) * rad;
        rest[i + 1] = y;
        rest[i + 2] = Math.sin(a) * rad;
      }
    }
    const pairs: number[] = [];
    for (let r = 0; r < NR - 1; r++)
      for (let c = 0; c < NC; c++) {
        const a = r * NC + c;
        const odd = r % 2;
        const left = (r + 1) * NC + ((c - 1 + odd + NC) % NC);
        const right = (r + 1) * NC + ((c + odd) % NC);
        pairs.push(a, left, a, right);
      }
    // soft ring + skip-row links keep the tube from collapsing (never rendered)
    for (let r = 1; r < NR; r++) for (let c = 0; c < NC; c++) pairs.push(r * NC + c, r * NC + ((c + 1) % NC));
    for (let r = 0; r < NR - 2; r++) for (let c = 0; c < NC; c++) pairs.push(r * NC + c, (r + 2) * NC + c);
    const links = new Uint16Array(pairs);
    const len = new Float32Array(links.length / 2);
    for (let k = 0; k < len.length; k++) {
      const a = links[k * 2] * 3;
      const b = links[k * 2 + 1] * 3;
      len[k] = Math.hypot(rest[a] - rest[b], rest[a + 1] - rest[b + 1], rest[a + 2] - rest[b + 2]);
    }
    const cx = side * COURT.rimX;
    for (let i = 0; i < NODES; i++) {
      pos[i * 3] = prev[i * 3] = cx + rest[i * 3];
      pos[i * 3 + 1] = prev[i * 3 + 1] = COURT.rimHeight + rest[i * 3 + 1];
      pos[i * 3 + 2] = prev[i * 3 + 2] = rest[i * 3 + 2];
    }
    const geo = g(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SEGS * 6 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(SEGS * 6 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let s = 0; s < SEGS; s++) {
      const o = s * 6;
      for (let k = 0; k < 3; k++) {
        const a0 = o + k;
        const a1 = o + ((k + 1) % 3);
        const b0 = a0 + 3;
        const b1 = a1 + 3;
        idx.push(a0, b0, a1, a1, b0, b1);
      }
    }
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, COURT.rimHeight - 0.25, 0), 0.8);
    const mesh = new THREE.Mesh(geo, netMat);
    mesh.frustumCulled = true;
    mesh.castShadow = true;
    return { side, pos, prev, rest, links, len, geo, mesh };
  }

  const ballP = new THREE.Vector3();
  let acc = 0;
  let wind = 0;

  function stepNet(h: Hoop, ballOn: boolean, time: number) {
    const n = h.net;
    const { pos, prev, rest } = n;
    const th = h.side * h.angle;
    const ct = Math.cos(th);
    const st = Math.sin(th);
    const px = h.side * COURT.boardX;
    const off = -h.side * (COURT.boardX - COURT.rimX);
    const g2 = -COURT.gravity * STEP * STEP;
    const sway = Math.sin(time * 0.9 + h.side) * 0.00002 + wind;
    for (let i = 0; i < NODES; i++) {
      const k = i * 3;
      if (i < NC) {
        const lx = off + rest[k];
        const ly = rest[k + 1];
        pos[k] = prev[k] = px + lx * ct - ly * st;
        pos[k + 1] = prev[k + 1] = COURT.rimHeight + lx * st + ly * ct;
        pos[k + 2] = prev[k + 2] = rest[k + 2];
        continue;
      }
      const x = pos[k];
      const y = pos[k + 1];
      const z = pos[k + 2];
      pos[k] += (x - prev[k]) * 0.982 + sway;
      pos[k + 1] += (y - prev[k + 1]) * 0.982 + g2;
      pos[k + 2] += (z - prev[k + 2]) * 0.982;
      prev[k] = x;
      prev[k + 1] = y;
      prev[k + 2] = z;
    }
    const L = n.links;
    const len = n.len;
    const nl = len.length;
    const rendered = SEGS;
    for (let it = 0; it < 5; it++) {
      for (let q = 0; q < nl; q++) {
        const a = L[q * 2];
        const b = L[q * 2 + 1];
        const ka = a * 3;
        const kb = b * 3;
        const dx = pos[kb] - pos[ka];
        const dy = pos[kb + 1] - pos[ka + 1];
        const dz = pos[kb + 2] - pos[ka + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const rl = len[q];
        // strings resist stretch only; helper links are soft both ways
        if (q < rendered && d <= rl) continue;
        const stiff = q < rendered ? 1 : q < rendered + NODES - NC ? 0.07 : 0.035;
        const diff = ((d - rl) / d) * stiff;
        const wa = a < NC ? 0 : b < NC ? 1 : 0.5;
        const wb = b < NC ? 0 : a < NC ? 1 : 0.5;
        pos[ka] += dx * diff * wa;
        pos[ka + 1] += dy * diff * wa;
        pos[ka + 2] += dz * diff * wa;
        pos[kb] -= dx * diff * wb;
        pos[kb + 1] -= dy * diff * wb;
        pos[kb + 2] -= dz * diff * wb;
      }
      if (ballOn) {
        const R = COURT.ballR + STRING_R + 0.004;
        for (let i = NC; i < NODES; i++) {
          const k = i * 3;
          const dx = pos[k] - ballP.x;
          const dy = pos[k + 1] - ballP.y;
          const dz = pos[k + 2] - ballP.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < R * R) {
            const d = Math.sqrt(d2) || 1e-6;
            const push = (R - d) / d;
            pos[k] += dx * push;
            pos[k + 1] += dy * push;
            pos[k + 2] += dz * push;
          }
        }
      }
    }
  }

  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const D = new THREE.Vector3();
  const U = new THREE.Vector3();
  const V = new THREE.Vector3();
  const N = new THREE.Vector3();
  const UPV = new THREE.Vector3(0, 1, 0);
  const SIDE = new THREE.Vector3(1, 0, 0);

  function writeNet(n: Net) {
    const pa = n.geo.attributes.position as THREE.BufferAttribute;
    const na = n.geo.attributes.normal as THREE.BufferAttribute;
    const P = pa.array as Float32Array;
    const NN = na.array as Float32Array;
    const p = n.pos;
    for (let s = 0; s < SEGS; s++) {
      const a = n.links[s * 2] * 3;
      const b = n.links[s * 2 + 1] * 3;
      A.set(p[a], p[a + 1], p[a + 2]);
      B.set(p[b], p[b + 1], p[b + 2]);
      D.subVectors(B, A).normalize();
      U.crossVectors(D, Math.abs(D.y) > 0.9 ? SIDE : UPV).normalize();
      V.crossVectors(D, U);
      const o = s * 18;
      for (let k = 0; k < 3; k++) {
        const ang = (k / 3) * Math.PI * 2;
        const c = Math.cos(ang);
        const sn = Math.sin(ang);
        N.set(U.x * c + V.x * sn, U.y * c + V.y * sn, U.z * c + V.z * sn);
        const i0 = o + k * 3;
        const i1 = o + (k + 3) * 3;
        P[i0] = A.x + N.x * STRING_R;
        P[i0 + 1] = A.y + N.y * STRING_R;
        P[i0 + 2] = A.z + N.z * STRING_R;
        P[i1] = B.x + N.x * STRING_R;
        P[i1 + 1] = B.y + N.y * STRING_R;
        P[i1 + 2] = B.z + N.z * STRING_R;
        NN[i0] = NN[i1] = N.x;
        NN[i0 + 1] = NN[i1 + 1] = N.y;
        NN[i0 + 2] = NN[i1 + 2] = N.z;
      }
    }
    pa.needsUpdate = true;
    na.needsUpdate = true;
  }

  function kick(side: Dir, strength: number, kind: "swish" | "rim" | "dunk" = "swish") {
    const h = hoops[side > 0 ? 1 : 0];
    const n = h.net;
    const s = Math.min(1.5, Math.max(0, strength));
    for (let i = NC; i < NODES; i++) {
      const k = i * 3;
      const row = Math.floor(i / NC) / (NR - 1);
      const ox = n.pos[k] - h.side * COURT.rimX;
      const oz = n.pos[k + 2];
      const ol = Math.hypot(ox, oz) || 1;
      let vx = 0;
      let vy = 0;
      let vz = 0;
      if (kind === "swish") {
        vy = 2.8 * row * row * s;
        vx = (ox / ol) * 0.9 * row * s - (oz / ol) * 0.35 * s * row;
        vz = (oz / ol) * 0.9 * row * s + (ox / ol) * 0.35 * s * row;
      } else if (kind === "dunk") {
        vy = -3.2 * row * s;
        vx = (ox / ol) * 0.9 * row * s;
        vz = (oz / ol) * 0.9 * row * s;
      } else {
        vx = (ox / ol) * 0.4 * s * (Math.random() - 0.3);
        vz = (oz / ol) * 0.4 * s * (Math.random() - 0.3);
        vy = 0.5 * s * row;
      }
      n.prev[k] -= vx * STEP;
      n.prev[k + 1] -= vy * STEP;
      n.prev[k + 2] -= vz * STEP;
    }
  }

  function shake(side: Dir, strength: number) {
    const h = hoops[side > 0 ? 1 : 0];
    h.vel += strength * 0.9 * (0.6 + Math.random() * 0.4);
    h.twistVel += (Math.random() - 0.5) * strength * 1.2;
  }

  let clockKey = "";
  function drawClock(view: SimView | null) {
    let shot = "";
    let game = "";
    let warn = false;
    if (view) {
      const st = view.state;
      if (st.shotClockOn) {
        const sc = Math.max(0, st.shotClock);
        shot = sc < 5 && sc > 0 ? sc.toFixed(1) : String(Math.ceil(sc));
        warn = sc < 5;
      }
      const c = Math.max(0, st.clock);
      game = c < 60 ? c.toFixed(1) : `${Math.floor(c / 60)}:${String(Math.floor(c % 60)).padStart(2, "0")}`;
    }
    const key = `${shot}|${game}|${view ? 1 : 0}`;
    if (key === clockKey) return;
    clockKey = key;
    const W = sc.width;
    const H = sc.height;
    sctx.fillStyle = "#020202";
    sctx.fillRect(0, 0, W, H);
    sctx.fillStyle = "#0d0d0d";
    for (let y = 4; y < H; y += 8) for (let x = 4; x < W; x += 8) sctx.fillRect(x, y, 3, 3);
    sctx.textAlign = "center";
    sctx.textBaseline = "middle";
    if (!view) {
      sctx.fillStyle = "#ff6a2a";
      sctx.font = `900 120px ${displayFont()}`;
      spacedText(sctx, "HOOPS", W / 2, H / 2 + 6, 0.08);
    } else {
      sctx.fillStyle = warn ? "#ff2a1a" : "#ff3b1f";
      sctx.font = `900 190px ${displayFont()}`;
      sctx.fillText(shot, W * 0.5, H * 0.4);
      sctx.fillStyle = "#ffd23a";
      sctx.font = `800 70px ${displayFont()}`;
      sctx.fillText(game, W * 0.5, H * 0.86);
    }
    clockTex.needsUpdate = true;
  }
  let clockT = 0;

  function paintPad(t: TeamData) {
    const W = pc.width;
    const H = pc.height;
    const grd = pctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, shade(t.primary, 0.08));
    grd.addColorStop(1, shade(t.primary, -0.25));
    pctx.fillStyle = grd;
    pctx.fillRect(0, 0, W, H);
    pctx.fillStyle = t.secondary;
    pctx.fillRect(0, H * 0.06, W, H * 0.03);
    pctx.fillRect(0, H * 0.91, W, H * 0.03);
    const ink = contrastOn(t.primary, "#ffffff", "#111111");
    pctx.textAlign = "center";
    pctx.textBaseline = "middle";
    pctx.fillStyle = ink;
    fitText(pctx, t.name.toUpperCase(), 900, 150, W * 0.86, 0.06);
    spacedText(pctx, t.name.toUpperCase(), W / 2, H * 0.45, 0.06);
    pctx.fillStyle = t.secondary;
    fitText(pctx, "HOOPS", 800, 64, W * 0.5, 0.4);
    spacedText(pctx, "HOOPS", W / 2, H * 0.72, 0.4);
    padTex.needsUpdate = true;
  }

  function setTeams(h: TeamData) {
    padMat.color.set(h.primary);
    paintPad(h);
  }
  setTeams(home);
  drawClock(null);

  let buzz = false;
  return {
    group,
    setTeams(h) {
      setTeams(h);
      clockKey = "";
    },
    update(dt, view, time) {
      for (const h of hoops) {
        h.vel += (-260 * h.angle - 9 * h.vel) * dt;
        h.angle += h.vel * dt;
        h.angle = Math.max(-0.05, Math.min(0.22, h.angle));
        h.twistVel += (-200 * h.twist - 8 * h.twistVel) * dt;
        h.twist += h.twistVel * dt;
        h.rim.rotation.z = h.side * h.angle;
        h.rim.rotation.x = h.twist * 0.05;
        const target = buzz ? 1 : 0;
        h.led += (target - h.led) * Math.min(1, dt * (buzz ? 20 : 2.5));
        h.ledMat.emissiveIntensity = h.led * 8;
      }
      wind = Math.sin(time * 0.37) * 0.000004;
      acc = Math.min(acc + dt, STEP * 6);
      let ballOn = false;
      if (view) {
        ballP.copy(view.ball.pos);
        ballOn = ballP.y > COURT.rimHeight - COURT.netLength - 0.3 && ballP.y < COURT.rimHeight + 0.3 && Math.abs(Math.abs(ballP.x) - COURT.rimX) < 0.5 && Math.abs(ballP.z) < 0.5;
      }
      while (acc >= STEP) {
        acc -= STEP;
        for (const h of hoops) stepNet(h, ballOn && Math.sign(ballP.x) === h.side, time);
      }
      for (const h of hoops) writeNet(h.net);
      clockT -= dt;
      if (clockT <= 0) {
        clockT = 0.1;
        drawClock(view);
      }
    },
    handle(events) {
      for (const e of events) {
        switch (e.type) {
          case "rim":
            shake(e.side, e.strength * 0.5);
            kick(e.side, e.strength * 0.6, "rim");
            break;
          case "backboard":
            shake(e.side, e.strength * 0.15);
            break;
          case "swish":
            kick(e.side, 1, "swish");
            break;
          case "net":
            kick(e.side, Math.max(0.4, e.strength), "swish");
            break;
          case "dunk":
            shake(e.side, 1.4);
            kick(e.side, 1, "dunk");
            break;
          case "buzzer":
            if (e.kind !== "shotClock") {
              buzz = true;
              setTimeout(() => (buzz = false), 2600);
            }
            break;
          case "periodStart":
            buzz = false;
            break;
        }
      }
    },
    netKick: kick,
    rimHit: shake,
    buzzer(on) {
      buzz = on;
    },
    dispose() {
      for (const x of geos) x.dispose();
      for (const x of mats) x.dispose();
      for (const x of texs) x.dispose();
    },
  };
}

function drawBoardLines(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const sx = W / 72;
  const sy = H / 42;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2 * sx;
  ctx.strokeRect(1 * sx, 1 * sy, 70 * sx, 40 * sy);
  // shooter's square: 24 x 18 in, bottom edge level with the rim top (6 in above the board's lower edge)
  const bw = 24 * sx;
  const bh = 18 * sy;
  ctx.lineWidth = 2 * sx;
  ctx.strokeRect(W / 2 - bw / 2 + sx, H - 6 * sy - bh + sy, bw - 2 * sx, bh - 2 * sy);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.font = `800 ${Math.round(3.4 * sy)}px "Arial Narrow", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("H O O P S", W / 2, 5 * sy);
}
