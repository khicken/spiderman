import * as THREE from "three";
import type { TeamData } from "./contracts";
import { COURT } from "./contracts";
import { canvas2d, canvasTexture, contrastOn, displayFont, drawEmblem, fitText, ledColor, shade, spacedText } from "./arena-tex";

// LED ribbons (courtside + fascia share one scrolling canvas), scorer's table, team benches and the center-hung board.

export interface ScoreboardInfo {
  home: TeamData;
  away: TeamData;
  score: [number, number];
  period: string;
  clock: number;
  shotClock: number;
  shotClockOn: boolean;
  fouls: [number, number];
  timeouts: [number, number];
  bonus: [boolean, boolean];
  possession: 0 | 1 | -1;
}

export type RibbonTone = "home" | "away" | "neutral" | "hot";

export interface Boards {
  readonly group: THREE.Group;
  readonly ribbonMat: THREE.MeshBasicMaterial;
  setTeams(home: TeamData, away: TeamData): void;
  /** Scoreboard content. Pass null for the idle/menu loop. */
  setScoreboard(info: ScoreboardInfo | null): void;
  /** Big takeover message on ribbons and the board for `secs`. */
  flash(text: string, tone: RibbonTone, secs?: number): void;
  update(dt: number, time: number, hype: number): void;
  dispose(): void;
}

const RW = 2048;
const RH = 128;

export function createBoards(home: TeamData, away: TeamData): Boards {
  const group = new THREE.Group();
  group.name = "boards";
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  let teams: [TeamData, TeamData] = [home, away];

  const [rc, rctx] = canvas2d(RW, RH);
  const ribbonTex = canvasTexture(rc, true, 16); // three clamps to the GPU max
  ribbonTex.wrapS = THREE.RepeatWrapping;
  texs.push(ribbonTex);
  const ribbonMat = new THREE.MeshBasicMaterial({ map: ribbonTex, toneMapped: true });
  ribbonMat.color.setScalar(1.9);
  mats.push(ribbonMat);
  const dots = makeDots();

  let message: { text: string; tone: RibbonTone; t: number } | null = null;
  let ribbonKey = "";

  function toneColor(tone: RibbonTone) {
    const [h, a] = teams;
    return tone === "home" ? ledColor(h) : tone === "away" ? ledColor(a) : tone === "hot" ? "#ff5a1f" : "#46d2ff";
  }

  function drawRibbon() {
    const [h, a] = teams;
    const key = message ? `m:${message.text}:${message.tone}` : `i:${h.abbr}:${a.abbr}`;
    if (key === ribbonKey) return;
    ribbonKey = key;
    rctx.fillStyle = "#020203";
    rctx.fillRect(0, 0, RW, RH);
    rctx.textAlign = "center";
    rctx.textBaseline = "middle";
    if (message) {
      const c = toneColor(message.tone);
      const g = rctx.createLinearGradient(0, 0, RW, 0);
      g.addColorStop(0, shade(c, -0.5));
      g.addColorStop(0.5, c);
      g.addColorStop(1, shade(c, -0.5));
      rctx.fillStyle = g;
      rctx.fillRect(0, 0, RW, RH);
      const ink = contrastOn(c, "#ffffff", "#0a0a0a");
      rctx.fillStyle = ink;
      for (let i = 0; i < 2; i++) {
        fitText(rctx, message.text, 900, 98, RW * 0.46, 0.1);
        spacedText(rctx, message.text, RW * (0.25 + i * 0.5), RH / 2 + 4, 0.1);
      }
    } else {
      const segs: [string, string, string][] = [
        ["HOOPS", "#ff5a1f", "#020203"],
        [h.name.toUpperCase(), h.primary, h.secondary],
        [`${h.abbr}  VS  ${a.abbr}`, "#0a0d14", "#46d2ff"],
        ["MAKE SOME NOISE", h.secondary, h.primary],
      ];
      const w = RW / segs.length;
      segs.forEach(([txt, bg, fg], i) => {
        rctx.fillStyle = bg;
        rctx.fillRect(i * w, 0, w, RH);
        rctx.fillStyle = contrastOn(bg, fg, "#ffffff");
        fitText(rctx, txt, 900, 92, w * 0.86, 0.12);
        spacedText(rctx, txt, i * w + w / 2, RH / 2 + 4, 0.12);
        rctx.fillStyle = "rgba(255,255,255,0.18)";
        rctx.fillRect(i * w, 0, 3, RH);
      });
    }
    rctx.globalCompositeOperation = "multiply";
    rctx.drawImage(dots, 0, 0);
    rctx.globalCompositeOperation = "source-over";
    ribbonTex.needsUpdate = true;
  }

  const tableW = 6.4;
  const tableZ = COURT.tableZ;
  const tableMat = new THREE.MeshStandardMaterial({ color: "#0b0c10", roughness: 0.45, metalness: 0.3 });
  const topMat = new THREE.MeshStandardMaterial({ color: "#1a1c22", roughness: 0.25, metalness: 0.2 });
  mats.push(tableMat, topMat);
  const addBox = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = group) => {
    const g = new THREE.BoxGeometry(w, h, d);
    geos.push(g);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    m.castShadow = false;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  addBox(tableW, 0.76, 0.8, tableMat, 0, 0.38, tableZ - 0.4);
  addBox(tableW + 0.1, 0.05, 0.9, topMat, 0, 0.785, tableZ - 0.42);
  const ledFront = new THREE.PlaneGeometry(tableW, 0.6);
  const uv = ledFront.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (tableW / 24));
  geos.push(ledFront);
  const front = new THREE.Mesh(ledFront, ribbonMat);
  front.position.set(0, 0.42, tableZ + 0.005);
  group.add(front);
  const monMat = new THREE.MeshStandardMaterial({ color: "#000", emissive: "#3a6c9a", emissiveIntensity: 0.9 });
  mats.push(monMat);
  for (let i = -4; i <= 4; i += 2) {
    const mon = addBox(0.5, 0.32, 0.04, monMat, i * 0.68, 0.98, tableZ - 0.6);
    mon.rotation.x = -0.25;
  }

  const chairGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  const chairBack = new THREE.BoxGeometry(0.5, 0.6, 0.1);
  chairBack.translate(0, 0.3, -0.22);
  geos.push(chairGeo, chairBack);
  const benchMats = [new THREE.MeshStandardMaterial({ roughness: 0.6 }), new THREE.MeshStandardMaterial({ roughness: 0.6 })];
  mats.push(...benchMats);
  const benchSpan: [number, number][] = [[-9.4, -3.6], [3.6, 9.4]];
  const chairsPerRow = 11;
  const benches = benchSpan.map(([x0, x1], side) => {
    const seat = new THREE.InstancedMesh(chairGeo, benchMats[side], chairsPerRow * 2);
    const back = new THREE.InstancedMesh(chairBack, benchMats[side], chairsPerRow * 2);
    const m4 = new THREE.Matrix4();
    for (let r = 0; r < 2; r++)
      for (let i = 0; i < chairsPerRow; i++) {
        const x = x0 + ((i + 0.5) / chairsPerRow) * (x1 - x0);
        m4.makeTranslation(x, 0.25 + r * 0.25, COURT.benchZ - 0.35 - r * 0.85);
        seat.setMatrixAt(r * chairsPerRow + i, m4);
        m4.makeTranslation(x, 0.5 + r * 0.25, COURT.benchZ - 0.35 - r * 0.85);
        m4.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
        back.setMatrixAt(r * chairsPerRow + i, m4);
      }
    seat.receiveShadow = back.receiveShadow = true;
    group.add(seat, back);
    return [seat, back];
  });
  for (const [x0, x1] of benchSpan) addBox(x1 - x0 + 0.4, 0.25, 1.0, tableMat, (x0 + x1) / 2, 0.125, COURT.benchZ - 1.2);

  const hung = new THREE.Group();
  hung.name = "centerHung";
  hung.position.y = 17.8;
  group.add(hung);
  const [lc, lctx] = canvas2d(1024, 576);
  const [ec, ectx] = canvas2d(768, 576);
  const longTex = canvasTexture(lc, true, 16);
  const endTex = canvasTexture(ec, true, 16);
  texs.push(longTex, endTex);
  const longMat = new THREE.MeshBasicMaterial({ map: longTex });
  const endMat = new THREE.MeshBasicMaterial({ map: endTex });
  longMat.color.setScalar(1.45);
  endMat.color.setScalar(1.45);
  const frameMat = new THREE.MeshStandardMaterial({ color: "#0c0d11", roughness: 0.5, metalness: 0.6 });
  mats.push(longMat, endMat, frameMat);
  const LW = 8.6;
  const EW = 5.6;
  const SH = 4.6;
  addBox(EW + 0.3, SH + 0.3, LW + 0.3, frameMat, 0, 0, 0, hung);
  for (const s of [-1, 1]) {
    const lg = new THREE.PlaneGeometry(LW, SH);
    geos.push(lg);
    const l = new THREE.Mesh(lg, longMat);
    l.position.set(0, 0, 0);
    l.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    l.position.x = s * (EW / 2 + 0.16);
    const eg = new THREE.PlaneGeometry(EW, SH);
    geos.push(eg);
    const e = new THREE.Mesh(eg, endMat);
    e.rotation.y = s > 0 ? 0 : Math.PI;
    e.position.z = s * (LW / 2 + 0.16);
    hung.add(l, e);
  }
  hung.rotation.y = Math.PI / 2;
  for (const y of [SH / 2 + 0.55, -SH / 2 - 0.55]) {
    const ring = new THREE.CylinderGeometry(5.2, 5.2, 0.7, 48, 1, true);
    const ruv = ring.attributes.uv;
    for (let i = 0; i < ruv.count; i++) ruv.setX(i, ruv.getX(i) * 1.4);
    geos.push(ring);
    const rm = new THREE.Mesh(ring, ribbonMat);
    rm.position.y = y;
    rm.scale.set(1, 1, 1.35);
    hung.add(rm);
  }
  const [uc, uctx] = canvas2d(512, 512);
  const underTex = canvasTexture(uc, true, 16);
  texs.push(underTex);
  const underMat = new THREE.MeshBasicMaterial({ map: underTex });
  underMat.color.setScalar(1.3);
  mats.push(underMat);
  const ug = new THREE.CircleGeometry(2.6, 48);
  geos.push(ug);
  const under = new THREE.Mesh(ug, underMat);
  under.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
  under.scale.x = -1;
  under.position.y = -SH / 2 - 0.95;
  hung.add(under);
  addBox(EW * 0.9, 0.5, LW * 0.9, frameMat, 0, -SH / 2 - 0.4, 0, hung);
  const cableMat = new THREE.MeshBasicMaterial({ color: "#050505" });
  mats.push(cableMat);
  for (const [x, z] of [[-2, -3], [2, -3], [-2, 3], [2, 3]]) {
    const cg = new THREE.CylinderGeometry(0.03, 0.03, 12, 4);
    geos.push(cg);
    const c = new THREE.Mesh(cg, cableMat);
    c.position.set(x, SH / 2 + 6, z);
    hung.add(c);
  }

  let board: ScoreboardInfo | null = null;
  let boardKey = "";
  let boardT = 0;
  let hypeShown = -1;

  function clockStr(c: number) {
    c = Math.max(0, c);
    return c < 60 ? c.toFixed(1) : `${Math.floor(c / 60)}:${String(Math.floor(c % 60)).padStart(2, "0")}`;
  }

  function drawLong() {
    const W = lc.width;
    const H = lc.height;
    const [h, a] = teams;
    const ctx = lctx;
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0b0e16");
    bg.addColorStop(1, "#04050a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (message) {
      const c = toneColor(message.tone);
      ctx.fillStyle = c;
      ctx.fillRect(0, H * 0.18, W, H * 0.64);
      ctx.fillStyle = contrastOn(c, "#ffffff", "#0a0a0a");
      fitText(ctx, message.text, 900, 230, W * 0.9, 0.06);
      spacedText(ctx, message.text, W / 2, H / 2 + 8, 0.06);
    } else if (!board) {
      drawEmblem(ctx, h, W * 0.15, H * 0.5, H * 0.24);
      drawEmblem(ctx, a, W * 0.85, H * 0.5, H * 0.24);
      ctx.fillStyle = "#ff5a1f";
      fitText(ctx, "HOOPS", 900, 190, W * 0.4, 0.08);
      spacedText(ctx, "HOOPS", W / 2, H * 0.44, 0.08);
      ctx.fillStyle = "#8d96a8";
      fitText(ctx, "TONIGHT", 700, 54, W * 0.3, 0.4);
      spacedText(ctx, "TONIGHT", W / 2, H * 0.66, 0.4);
    } else {
      const b = board;
      for (const s of [0, 1] as const) {
        const t = s === 0 ? b.home : b.away;
        const x0 = s === 0 ? 0 : W * 0.62;
        const c = ledColor(t);
        ctx.fillStyle = shade(t.primary, -0.2);
        ctx.fillRect(x0, 0, W * 0.38, H * 0.2);
        ctx.fillStyle = c;
        ctx.fillRect(x0, H * 0.2, W * 0.38, 6);
        ctx.fillStyle = contrastOn(t.primary, "#ffffff", "#0a0a0a");
        fitText(ctx, t.name.toUpperCase(), 900, 76, W * 0.34, 0.06);
        spacedText(ctx, t.name.toUpperCase(), x0 + W * 0.19, H * 0.105, 0.06);
        ctx.fillStyle = "#ffffff";
        ctx.font = `900 250px ${displayFont()}`;
        ctx.fillText(String(b.score[s]), x0 + W * 0.19, H * 0.53);
        ctx.fillStyle = "#8d96a8";
        ctx.font = `700 40px ${displayFont()}`;
        ctx.fillText(`FOULS ${b.fouls[s]}   T.O. ${b.timeouts[s]}`, x0 + W * 0.19, H * 0.83);
        if (b.bonus[s]) {
          ctx.fillStyle = "#ffd166";
          ctx.fillText("BONUS", x0 + W * 0.19, H * 0.92);
        }
        if (b.possession === s) {
          ctx.fillStyle = "#ffd166";
          ctx.beginPath();
          const px = s === 0 ? x0 + W * 0.37 : x0 + W * 0.01;
          const dir = s === 0 ? 1 : -1;
          ctx.moveTo(px, H * 0.47);
          ctx.lineTo(px + dir * 26, H * 0.53);
          ctx.lineTo(px, H * 0.59);
          ctx.fill();
        }
      }
      ctx.fillStyle = "#ff5a1f";
      ctx.font = `800 64px ${displayFont()}`;
      ctx.fillText(b.period, W / 2, H * 0.17);
      ctx.fillStyle = "#ffd23a";
      ctx.font = `900 150px ${displayFont()}`;
      ctx.fillText(clockStr(b.clock), W / 2, H * 0.44);
      if (b.shotClockOn) {
        ctx.fillStyle = "#ff3b1f";
        ctx.font = `900 120px ${displayFont()}`;
        ctx.fillText(String(Math.ceil(Math.max(0, b.shotClock))), W / 2, H * 0.74);
      }
    }
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(dots, 0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    longTex.needsUpdate = true;
  }

  function drawEnd(hype: number) {
    const W = ec.width;
    const H = ec.height;
    const ctx = ectx;
    const [h] = teams;
    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (message) {
      const c = toneColor(message.tone);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = contrastOn(c, "#ffffff", "#0a0a0a");
      fitText(ctx, message.text, 900, 180, W * 0.9, 0.04);
      spacedText(ctx, message.text, W / 2, H / 2, 0.04);
    } else {
      ctx.fillStyle = "#ffffff";
      fitText(ctx, "NOISE", 900, 120, W * 0.8, 0.2);
      spacedText(ctx, "NOISE", W / 2, H * 0.17, 0.2);
      const bars = 14;
      const lit = Math.round(hype * bars);
      const c = ledColor(h);
      for (let i = 0; i < bars; i++) {
        const bh = H * 0.05 + (i / bars) * H * 0.45;
        ctx.fillStyle = i < lit ? (i > bars * 0.8 ? "#ff3b1f" : c) : "#151820";
        ctx.fillRect(W * 0.08 + i * (W * 0.84) / bars, H * 0.88 - bh, (W * 0.84) / bars - 8, bh);
      }
    }
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(dots, 0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    endTex.needsUpdate = true;
  }

  function drawUnder() {
    const [h] = teams;
    uctx.fillStyle = "#05060a";
    uctx.fillRect(0, 0, 512, 512);
    drawEmblem(uctx, h, 256, 256, 230);
    underTex.needsUpdate = true;
  }

  function setTeams(h: TeamData, a: TeamData) {
    teams = [h, a];
    benchMats[0].color.set(h.primary);
    benchMats[1].color.set(a.primary);
    ribbonKey = "";
    boardKey = "";
    drawRibbon();
    drawLong();
    drawEnd(0.3);
    drawUnder();
  }
  setTeams(home, away);

  return {
    group,
    ribbonMat,
    setTeams,
    setScoreboard(info) {
      board = info;
    },
    flash(text, tone, secs = 3) {
      message = { text, tone, t: secs };
      drawRibbon();
      boardKey = "";
    },
    update(dt, time, hype) {
      ribbonTex.offset.x = (time * 0.018) % 1; // slow crawl: fast scroll smears under TAA and bloom
      if (message) {
        message.t -= dt;
        if (message.t <= 0) {
          message = null;
          drawRibbon();
          boardKey = "";
        }
      }
      const pulse = 1.75 + Math.sin(time * 3) * 0.08 * hype + (message ? 0.5 + Math.sin(time * 14) * 0.25 : 0);
      ribbonMat.color.setScalar(pulse);
      boardT -= dt;
      if (boardT > 0) return;
      boardT = 0.25;
      const b = board;
      const key = message
        ? `m${message.text}`
        : b
          ? `${b.score[0]}|${b.score[1]}|${b.period}|${clockStr(b.clock)}|${Math.ceil(b.shotClock)}|${b.shotClockOn}|${b.fouls}|${b.timeouts}|${b.bonus}|${b.possession}`
          : "idle";
      if (key !== boardKey) {
        boardKey = key;
        drawLong();
      }
      const hq = Math.round(hype * 14);
      if (hq !== hypeShown || message) {
        hypeShown = hq;
        drawEnd(hype);
      }
    },
    dispose() {
      for (const [s, b] of benches) {
        s.dispose();
        b.dispose();
      }
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
    },
  };

  function makeDots() {
    const [dc, dctx] = canvas2d(RW, RH);
    dctx.fillStyle = "#ffffff";
    dctx.fillRect(0, 0, RW, RH);
    dctx.fillStyle = "rgba(0,0,0,0.45)";
    for (let x = 0; x < RW; x += 4) dctx.fillRect(x, 0, 1, RH);
    for (let y = 0; y < RH; y += 4) dctx.fillRect(0, y, RW, 1);
    return dc;
  }
}
