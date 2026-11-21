"use client";

import { useEffect, useRef } from "react";
import type { LandmarkId, QuestStage } from "./contracts";
import { BEACON_COLOR, BEACON_LANDMARK, CLIFFS, FOREST, LAKE, LANDMARKS, MOUNTAIN, RIVER } from "./contracts";
import { Flame } from "./ui-ink";

// Painted parchment map of the island. Relief comes from world.heightAt; rivers, lake, forest, cliffs and labels come
// from the contract layout, so the map reads well even before the real terrain lands.

export interface MapData {
  heightAt(x: number, z: number): number;
  player: { x: number; z: number };
  heading: number;
  beacons: readonly boolean[];
  visited: readonly LandmarkId[];
  barrierDown: boolean;
  stage: QuestStage;
}

const EXT = 620; // world half-extent shown
const RES = 288; // relief samples per side
const PX = 900; // canvas pixels per side

const toU = (x: number) => (x + EXT) / (2 * EXT);

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function mix(a: number[], b: number[], t: number) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
const SEA_SHALLOW = [176, 204, 190];
const SEA_DEEP = [98, 146, 146];
const LOW = [232, 218, 178];
const MID = [217, 196, 146];
const HIGH = [190, 166, 120];
const PEAK = [150, 132, 112];
const FOREST_C = [168, 176, 120];

function paintRelief(ctx: CanvasRenderingContext2D, heightAt: (x: number, z: number) => number) {
  const H = new Float32Array(RES * RES);
  for (let j = 0; j < RES; j++)
    for (let i = 0; i < RES; i++) {
      const x = -EXT + ((i + 0.5) / RES) * 2 * EXT, z = -EXT + ((j + 0.5) / RES) * 2 * EXT;
      H[j * RES + i] = heightAt(x, z);
    }
  const img = ctx.createImageData(RES, RES);
  const r = rng(11);
  const cell = (2 * EXT) / RES;
  for (let j = 0; j < RES; j++)
    for (let i = 0; i < RES; i++) {
      const k = j * RES + i;
      const h = H[k];
      const hl = H[j * RES + Math.max(0, i - 1)], hr = H[j * RES + Math.min(RES - 1, i + 1)];
      const hu = H[Math.max(0, j - 1) * RES + i], hd = H[Math.min(RES - 1, j + 1) * RES + i];
      let c: number[];
      if (h < 0) {
        c = mix(SEA_SHALLOW, SEA_DEEP, Math.min(1, -h / 22));
      } else {
        const x = -EXT + ((i + 0.5) / RES) * 2 * EXT, z = -EXT + ((j + 0.5) / RES) * 2 * EXT;
        c = h < 50 ? mix(LOW, MID, h / 50) : h < 120 ? mix(MID, HIGH, (h - 50) / 70) : mix(HIGH, PEAK, Math.min(1, (h - 120) / 70));
        const fd = Math.hypot(x - FOREST.x, z - FOREST.z) / FOREST.r;
        if (fd < 1) c = mix(c, FOREST_C, 0.55 * Math.min(1, (1 - fd) * 3));
        const sx = (hr - hl) / (2 * cell), sz = (hd - hu) / (2 * cell);
        const shade = Math.max(-0.35, Math.min(0.3, (-sx * 0.7 - sz * 0.7) * 0.9));
        c = [c[0] * (1 + shade), c[1] * (1 + shade), c[2] * (1 + shade * 1.1)];
        const band = Math.floor(h / 25);
        if (h > 6 && (Math.floor(hr / 25) !== band || Math.floor(hd / 25) !== band)) c = mix(c, [110, 84, 58], 0.35);
      }
      const coast = (h >= 0) !== (hr >= 0) || (h >= 0) !== (hd >= 0) || (h >= 0) !== (hl >= 0) || (h >= 0) !== (hu >= 0);
      if (coast) c = [55, 42, 30];
      const n = (r() - 0.5) * 10;
      img.data[k * 4] = c[0] + n;
      img.data[k * 4 + 1] = c[1] + n;
      img.data[k * 4 + 2] = c[2] + n;
      img.data[k * 4 + 3] = 255;
    }
  const tmp = document.createElement("canvas");
  tmp.width = tmp.height = RES;
  tmp.getContext("2d")!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(tmp, 0, 0, PX, PX);
  return H;
}

function P(x: number) {
  return toU(x) * PX;
}

function paintFeatures(ctx: CanvasRenderingContext2D, H: Float32Array) {
  const ink = "#2b2118";
  const k = PX / (2 * EXT);
  const landAt = (x: number, z: number) => {
    const i = Math.floor(toU(x) * RES), j = Math.floor(toU(z) * RES);
    if (i < 0 || j < 0 || i >= RES || j >= RES) return -1;
    return H[j * RES + i];
  };
  const r = rng(5);
  ctx.strokeStyle = "rgba(31,90,94,0.35)";
  ctx.lineWidth = 1.4;
  for (let n = 0; n < 90; n++) {
    const x = -EXT + r() * 2 * EXT, z = -EXT + r() * 2 * EXT;
    if (landAt(x, z) >= -2 || landAt(x + 30, z) >= -2 || landAt(x - 30, z) >= -2) continue;
    const px = P(x), pz = P(z);
    ctx.beginPath();
    ctx.moveTo(px - 10, pz);
    ctx.quadraticCurveTo(px - 5, pz - 4, px, pz);
    ctx.quadraticCurveTo(px + 5, pz + 4, px + 10, pz);
    ctx.stroke();
  }
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(P(LAKE.x), P(LAKE.z), LAKE.r * k, LAKE.r * k * 0.92, 0.2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(111,170,165,0.85)";
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.clip();
  ctx.strokeStyle = "rgba(248,240,221,0.6)";
  ctx.lineWidth = 1.2;
  for (let i = -4; i <= 4; i++) {
    ctx.beginPath();
    ctx.ellipse(P(LAKE.x), P(LAKE.z), (LAKE.r - 14 - Math.abs(i) * 6) * k, 4, 0.2, Math.PI * 0.1, Math.PI * 0.9);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = "#cbb68a";
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(P(250), P(-330), 18 * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let pass = 0; pass < 2; pass++)
    for (let i = 1; i < RIVER.length; i++) {
      const a = RIVER[i - 1], b = RIVER[i];
      ctx.beginPath();
      ctx.moveTo(P(a.x), P(a.z));
      ctx.quadraticCurveTo(P(a.x + (b.x - a.x) * 0.3 + 10), P(a.z + (b.z - a.z) * 0.6 - 8), P(b.x), P(b.z));
      ctx.strokeStyle = pass === 0 ? ink : "#6fb2aa";
      ctx.lineWidth = Math.max(2.5, ((a.w + b.w) / 2) * k * 1.6) + (pass === 0 ? 3 : 0);
      ctx.stroke();
    }
  const t = rng(21);
  for (let n = 0; n < 260; n++) {
    const a = t() * Math.PI * 2, d = Math.sqrt(t()) * FOREST.r * 0.95;
    const x = FOREST.x + Math.cos(a) * d, z = FOREST.z + Math.sin(a) * d;
    if (landAt(x, z) < 2) continue;
    if (Math.hypot(x + 360, z + 190) < 30) continue;
    const px = P(x), pz = P(z), s = 5 + t() * 3;
    ctx.beginPath();
    ctx.moveTo(px, pz - s * 1.6);
    ctx.lineTo(px + s * 0.8, pz + s * 0.3);
    ctx.lineTo(px - s * 0.8, pz + s * 0.3);
    ctx.closePath();
    ctx.fillStyle = t() < 0.5 ? "#5d7a47" : "#4c6a3f";
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px, pz + s * 0.3);
    ctx.lineTo(px, pz + s * 0.8);
    ctx.stroke();
  }
  for (let n = 0; n < 70; n++) {
    const x = -EXT + t() * 2 * EXT, z = -EXT + t() * 2 * EXT;
    const h = landAt(x, z);
    if (h < 4 || h > 70 || Math.hypot(x - FOREST.x, z - FOREST.z) < FOREST.r || Math.hypot(x - MOUNTAIN.x, z - MOUNTAIN.z) < 150) continue;
    const px = P(x), pz = P(z);
    ctx.beginPath();
    ctx.arc(px, pz - 3, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#7f9a52";
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(43,33,24,0.55)";
  ctx.lineWidth = 1.1;
  for (let n = 0; n < 80; n++) {
    const a = (n / 80) * Math.PI * 2;
    const r0 = 45 + (n % 3) * 10, r1 = 110 + (n % 4) * 18;
    ctx.beginPath();
    ctx.moveTo(P(MOUNTAIN.x + Math.cos(a) * r0), P(MOUNTAIN.z + Math.sin(a) * r0));
    ctx.lineTo(P(MOUNTAIN.x + Math.cos(a) * r1), P(MOUNTAIN.z + Math.sin(a) * r1));
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(P(MOUNTAIN.x), P(MOUNTAIN.z), 38 * k, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(150,132,112,0.6)";
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  const cx0 = P(CLIFFS.x0), cz0 = P(CLIFFS.z0), cx1 = P(CLIFFS.x1), cz1 = P(CLIFFS.z1);
  const len = Math.hypot(cx1 - cx0, cz1 - cz0), nx = -(cz1 - cz0) / len, nz = (cx1 - cx0) / len;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(cx0, cz0);
  ctx.lineTo(cx1, cz1);
  ctx.stroke();
  ctx.lineWidth = 1.3;
  for (let s = 0; s <= 1; s += 0.045) {
    const x = cx0 + (cx1 - cx0) * s, z = cz0 + (cz1 - cz0) * s;
    ctx.beginPath();
    ctx.moveTo(x, z);
    ctx.lineTo(x - nx * 11, z - nz * 11);
    ctx.stroke();
  }
  const rx = PX * 0.86, rz = PX * 0.85, R = PX * 0.06;
  ctx.save();
  ctx.translate(rx, rz);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const big = i % 2 === 0, L = big ? R : R * 0.55;
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.moveTo(0, -L);
    ctx.lineTo(R * 0.12, 0);
    ctx.lineTo(-R * 0.12, 0);
    ctx.closePath();
    ctx.fillStyle = big ? (i === 6 ? "#b8402b" : "#2b2118") : "#c9a13b";
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = "#b8402b";
  ctx.font = `700 ${PX * 0.032}px Georgia, serif`;
  ctx.textAlign = "center";
  ctx.fillText("N", rx, rz - R - 6);
}

function paintFog(ctx: CanvasRenderingContext2D, clear: { x: number; z: number; r: number }[]) {
  ctx.clearRect(0, 0, PX, PX);
  ctx.globalCompositeOperation = "source-over";
  const r = rng(99);
  ctx.fillStyle = "rgba(236,224,196,0.66)";
  ctx.fillRect(0, 0, PX, PX);
  for (let n = 0; n < 60; n++) {
    const x = r() * PX, y = r() * PX, s = 40 + r() * 120;
    const g = ctx.createRadialGradient(x, y, 0, x, y, s);
    g.addColorStop(0, "rgba(214,196,156,0.35)");
    g.addColorStop(1, "rgba(214,196,156,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - s, y - s, s * 2, s * 2);
  }
  ctx.globalCompositeOperation = "destination-out";
  const k = PX / (2 * EXT);
  for (const c of clear) {
    const x = P(c.x), y = P(c.z), rad = c.r * k;
    const g = ctx.createRadialGradient(x, y, rad * 0.55, x, y, rad);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

const reliefCache = new WeakMap<object, HTMLCanvasElement>();

export function IslandMap({ data, fog = true }: { data: MapData; fog?: boolean }) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const fogRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = baseRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const key = data.heightAt as unknown as object;
    let cached = reliefCache.get(key);
    if (!cached) {
      cached = document.createElement("canvas");
      cached.width = cached.height = PX;
      const cc = cached.getContext("2d")!;
      const H = paintRelief(cc, data.heightAt);
      paintFeatures(cc, H);
      reliefCache.set(key, cached);
    }
    ctx.drawImage(cached, 0, 0);
  }, [data.heightAt]);

  const visitedKey = data.visited.join(",");
  useEffect(() => {
    const c = fogRef.current;
    if (!c || !fog) return;
    const clear = LANDMARKS.filter((l) => data.visited.includes(l.id) || l.id === "shrine").map((l) => ({ x: l.x, z: l.z, r: Math.max(110, l.r * 1.5) }));
    clear.push({ x: data.player.x, z: data.player.z, r: 140 });
    paintFog(c.getContext("2d")!, clear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitedKey, fog, Math.round(data.player.x / 20), Math.round(data.player.z / 20)]);

  const pct = (v: number) => `${toU(v) * 100}%`;
  const seen = (id: LandmarkId) => !fog || data.visited.includes(id) || id === "shrine";
  const labels = LANDMARKS.filter((l) => !l.id.startsWith("beacon") && l.id !== "spire");

  return (
    <div className="relative h-full w-full" style={{ containerType: "size" }} data-testid="map">
      <canvas ref={baseRef} width={PX} height={PX} className="absolute inset-0 h-full w-full" style={{ borderRadius: "0.2rem" }} />
      {fog && <canvas ref={fogRef} width={PX} height={PX} className="absolute inset-0 h-full w-full" />}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ fontSize: "max(9px, 2.6cqh)" }}>
        {labels.map((l) =>
          seen(l.id) ? (
            <span key={l.id} className="font-display absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap italic" style={{ left: pct(l.x), top: pct(l.z + (l.id === "cinder" ? 75 : l.id === "shrine" ? 40 : l.id === "cliffs" ? -45 : l.id === "lake" ? 40 : 0)), fontSize: l.id === "cinder" || l.id === "whisperwood" ? "1.35em" : "1.1em", fontWeight: 700, color: "var(--color-ink)", textShadow: "0 0 0.3em #f3e7cc, 0 0 0.15em #f3e7cc" }}>
              {l.name}
            </span>
          ) : null,
        )}
        {BEACON_LANDMARK.map((id, i) => {
          const l = LANDMARKS.find((x) => x.id === id)!;
          const lit = !!data.beacons[i];
          return (
            <div key={id} className="absolute flex -translate-x-1/2 -translate-y-[85%] flex-col items-center" style={{ left: pct(l.x), top: pct(l.z) }}>
              <Flame color={BEACON_COLOR[i]} lit={lit} style={{ width: "1.5em", height: "1.9em", filter: lit ? `drop-shadow(0 0 0.5em ${BEACON_COLOR[i]})` : "drop-shadow(0 0 0.1em #f3e7cc)" }} />
            </div>
          );
        })}
        <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: pct(MOUNTAIN.x), top: pct(MOUNTAIN.z) }}>
          <svg viewBox="0 0 30 30" style={{ width: "2em", height: "2em" }} aria-hidden>
            <path d="M15 2L19 26H11Z" fill={data.barrierDown ? "#a47cc6" : "#5b3a6e"} stroke="#2b2118" strokeWidth="1.2" />
            {!data.barrierDown && <circle cx="15" cy="16" r="13" fill="rgba(164,124,198,0.25)" stroke="#5b3a6e" strokeWidth="1.2" strokeDasharray="2 2" />}
          </svg>
        </div>
        <div className="absolute" style={{ left: pct(data.player.x), top: pct(data.player.z), transform: `translate(-50%, -50%) rotate(${data.heading}rad)` }} data-testid="map-player">
          <svg viewBox="0 0 24 24" style={{ width: "2.1em", height: "2.1em", filter: "drop-shadow(0 0 0.35em rgb(240 138 60 / 0.9))" }} aria-hidden>
            <path d="M12 2L19 21L12 16.5L5 21Z" fill="var(--color-ember)" stroke="#2b2118" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M12 6L15 16L12 14Z" fill="var(--color-ember-hi)" />
          </svg>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-0" style={{ boxShadow: "inset 0 0 0 1px #2b2118, inset 0 0 2.5rem rgb(143 109 34 / 0.45)" }} />
    </div>
  );
}
