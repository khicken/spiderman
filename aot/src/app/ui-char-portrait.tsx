"use client";

import { useEffect, useRef } from "react";
import type { ScoutLook } from "./progression-chars";

const INK = "#1a1714";

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, k < 0 ? v * (1 + k) : v + (255 - v) * k)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

function draw(g: CanvasRenderingContext2D, L: ScoutLook, locked: boolean) {
  const W = 200;
  const H = 240;
  g.lineJoin = "round";
  g.lineCap = "round";
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#2a3a2e");
  bg.addColorStop(1, "#0d0b0a");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(195,22,28,0.55)";
  g.beginPath();
  g.moveTo(-10, 150);
  g.quadraticCurveTo(100, 120, 215, 70);
  g.lineTo(215, 100);
  g.quadraticCurveTo(100, 150, -10, 178);
  g.fill();

  const stroke = (fill: string, w = 3) => {
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = w;
    g.strokeStyle = INK;
    g.stroke();
  };
  const cx = 100;
  const s = L.scale < 0.95 ? 0.97 : 1;

  g.beginPath();
  g.moveTo(10, H + 4);
  g.quadraticCurveTo(18, 178, 62, 168);
  g.lineTo(138, 168);
  g.quadraticCurveTo(182, 178, 190, H + 4);
  g.closePath();
  stroke("#2f5a3c");
  g.beginPath();
  g.moveTo(70, 168);
  g.lineTo(100, 228);
  g.lineTo(130, 168);
  g.closePath();
  stroke("#8c5a34", 2.5);
  g.beginPath();
  g.moveTo(84, 170);
  g.lineTo(100, 212);
  g.lineTo(116, 170);
  g.closePath();
  stroke("#f4f1ea", 2);
  g.strokeStyle = INK;
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(76, 176);
  g.lineTo(92, 240);
  g.moveTo(124, 176);
  g.lineTo(108, 240);
  g.stroke();

  g.beginPath();
  g.moveTo(88, 140);
  g.lineTo(88, 172);
  g.quadraticCurveTo(100, 180, 112, 172);
  g.lineTo(112, 140);
  stroke(L.skin, 2.5);

  if (L.scarf) {
    g.beginPath();
    g.ellipse(cx, 166, 30, 11, 0, 0, Math.PI * 2);
    stroke(L.scarf);
    g.beginPath();
    g.moveTo(108, 168);
    g.quadraticCurveTo(122, 196, 116, 226);
    g.lineTo(100, 222);
    g.quadraticCurveTo(104, 196, 96, 172);
    stroke(shade(L.scarf, -0.15), 2.5);
  }
  if (L.cravat) {
    g.beginPath();
    g.ellipse(cx, 166, 20, 7, 0, 0, Math.PI * 2);
    stroke("#f4f1ea", 2.5);
    g.beginPath();
    g.moveTo(92, 168);
    g.quadraticCurveTo(100, 210, 108, 168);
    stroke("#f4f1ea", 2.5);
  }

  g.save();
  g.translate(cx, 96);
  g.scale(s, s);
  const faceW = 40;
  const back = () => {
    if (L.hairStyle === "bob") {
      g.beginPath();
      g.moveTo(-50, 24);
      g.quadraticCurveTo(-58, -40, 0, -60);
      g.quadraticCurveTo(58, -40, 50, 24);
      g.lineTo(42, 34);
      g.lineTo(-42, 34);
      g.closePath();
      stroke(L.hair);
    } else {
      g.beginPath();
      g.ellipse(0, -14, faceW + 8, 50, 0, Math.PI, Math.PI * 2);
      g.lineTo(faceW + 6, 10);
      g.lineTo(-faceW - 6, 10);
      g.closePath();
      stroke(L.hair);
    }
  };
  back();

  g.beginPath();
  g.moveTo(-faceW, -20);
  g.quadraticCurveTo(-faceW, 22, -16, 44);
  g.quadraticCurveTo(0, 56, 16, 44);
  g.quadraticCurveTo(faceW, 22, faceW, -20);
  g.quadraticCurveTo(0, -46, -faceW, -20);
  stroke(L.skin);
  g.fillStyle = shade(L.skin, -0.12);
  g.beginPath();
  g.moveTo(-faceW + 2, -10);
  g.quadraticCurveTo(-faceW + 4, 18, -16, 40);
  g.quadraticCurveTo(-26, 16, -faceW + 2, -10);
  g.fill();

  const narrow = L.hairStyle === "undercut";
  for (const sx of [-1, 1]) {
    g.save();
    g.translate(sx * 17, 6);
    const eh = narrow ? 6 : 10;
    g.beginPath();
    g.ellipse(0, 0, 11, eh, 0, 0, Math.PI * 2);
    g.fillStyle = "#fbf8f2";
    g.fill();
    g.beginPath();
    g.ellipse(sx * -1, 1, 6.5, eh - 1, 0, 0, Math.PI * 2);
    g.fillStyle = L.eyes;
    g.fill();
    g.beginPath();
    g.ellipse(sx * -1, 1, 3, eh * 0.45, 0, 0, Math.PI * 2);
    g.fillStyle = INK;
    g.fill();
    g.fillStyle = "#fff";
    g.fillRect(sx * -1 + 1, -eh * 0.5, 2.5, 2.5);
    g.lineWidth = 3.5;
    g.strokeStyle = INK;
    g.beginPath();
    g.moveTo(-13, -eh + 1);
    g.quadraticCurveTo(0, -eh - 3, 13, -eh + 1 + sx * 1.5);
    g.stroke();
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(sx * -12, -eh - 9 + (narrow ? 4 : 0));
    g.lineTo(sx * 12, -eh - 6 - (narrow ? -1 : 2));
    g.stroke();
    g.restore();
  }
  g.lineWidth = 2;
  g.strokeStyle = INK;
  g.beginPath();
  g.moveTo(-1, 18);
  g.lineTo(2, 24);
  g.moveTo(-6, 34);
  g.lineTo(6, 34);
  g.stroke();

  g.fillStyle = L.hair;
  g.strokeStyle = INK;
  g.lineWidth = 3;
  if (L.hairStyle === "bob") {
    g.beginPath();
    g.moveTo(-46, 18);
    g.quadraticCurveTo(-52, -44, 0, -52);
    g.quadraticCurveTo(52, -44, 46, 18);
    g.lineTo(38, 26);
    g.quadraticCurveTo(36, -2, 30, -10);
    for (let i = 0; i <= 6; i++) g.lineTo(30 - i * 10, i % 2 ? -6 : -14);
    g.quadraticCurveTo(-36, -2, -38, 26);
    g.closePath();
    g.fill();
    g.stroke();
  } else if (L.hairStyle === "undercut") {
    g.fillStyle = shade(L.hair, 0.35);
    g.beginPath();
    g.moveTo(-faceW - 1, -2);
    g.quadraticCurveTo(-faceW - 2, -22, -30, -30);
    g.lineTo(30, -30);
    g.quadraticCurveTo(faceW + 2, -22, faceW + 1, -2);
    g.closePath();
    g.fill();
    g.fillStyle = L.hair;
    g.beginPath();
    g.moveTo(-44, -22);
    g.quadraticCurveTo(-40, -58, 0, -56);
    g.quadraticCurveTo(40, -58, 44, -22);
    g.lineTo(30, -6);
    g.lineTo(22, -14);
    g.lineTo(14, 2);
    g.lineTo(4, -22);
    g.lineTo(-4, -22);
    g.lineTo(-14, 2);
    g.lineTo(-22, -14);
    g.lineTo(-30, -6);
    g.closePath();
    g.fill();
    g.stroke();
  } else {
    const big = L.hairStyle === "spiky" ? 1.2 : 1;
    g.beginPath();
    g.moveTo(-48, 4);
    g.lineTo(-44, -30);
    g.quadraticCurveTo(-30, -60, 0, -58);
    g.quadraticCurveTo(30, -60, 44, -30);
    g.lineTo(48, 4);
    const tips = [36, 24, 10, -4, -18, -32];
    let x = 40;
    for (const t of tips) {
      g.lineTo((x + t) / 2, -26 + 4 * Math.sin(t));
      g.lineTo(t, -4 * big + (t % 3));
      x = t;
    }
    g.lineTo(-40, -24);
    g.closePath();
    g.fill();
    g.stroke();
  }
  g.restore();

  if (locked) {
    g.fillStyle = "rgba(8,6,5,0.58)";
    g.fillRect(0, 0, W, H);
  }
}

export function Portrait({ look, locked, className = "" }: { look: ScoutLook; locked: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = 200 * dpr;
    c.height = 240 * dpr;
    const g = c.getContext("2d");
    if (!g) return;
    g.scale(dpr, dpr);
    draw(g, look, locked);
  }, [look, locked]);
  return <canvas ref={ref} className={`block aspect-[5/6] w-full ${className}`} />;
}
