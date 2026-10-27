"use client";

import type { CSSProperties } from "react";
import type { HudState } from "../contracts";
import { paintBlockTexture } from "../textures";
import { packUrl, pixelUrl } from "./sprites";

const OVERLAY_CSS = `
@keyframes mc-portal{0%{background-position:0 0}100%{background-position:0 100%}}
`;

const full = (w: number, h: number, extra: CSSProperties): CSSProperties => ({ position: "absolute", left: 0, top: 0, width: w, height: h, pointerEvents: "none", ...extra });

let pumpkinUrl = "";
// Vanilla misc/pumpkinblur.png: the inside of a carved pumpkin with the face cut out, stretched over the screen.
function pumpkin(): string {
  if (pumpkinUrl || typeof document === "undefined") return pumpkinUrl;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  if (!g) return "";
  const grad = g.createRadialGradient(128, 128, 20, 128, 128, 190);
  grad.addColorStop(0, "#5a2c00");
  grad.addColorStop(1, "#140700");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  g.globalCompositeOperation = "destination-out";
  g.filter = "blur(6px)";
  g.beginPath();
  g.moveTo(58, 112);
  g.lineTo(110, 112);
  g.lineTo(84, 70);
  g.closePath();
  g.moveTo(146, 112);
  g.lineTo(198, 112);
  g.lineTo(172, 70);
  g.closePath();
  g.moveTo(52, 150);
  g.lineTo(204, 150);
  g.lineTo(186, 196);
  g.lineTo(154, 184);
  g.lineTo(128, 200);
  g.lineTo(102, 184);
  g.lineTo(70, 196);
  g.closePath();
  g.fill();
  pumpkinUrl = c.toDataURL();
  return pumpkinUrl;
}

const portalUrl = () => {
  const tex = typeof document === "undefined" ? null : paintBlockTexture("nether_portal");
  return pixelUrl("portal_overlay", 16, 16, (x, y) => {
    if (!tex) return 0xc05a1aa8;
    const o = (y * 16 + x) * 4;
    return ((tex[o + 3] << 24) | (tex[o] << 16) | (tex[o + 1] << 8) | tex[o + 2]) >>> 0;
  });
};

export function HudOverlays({ state, width, height, vignette }: { state: HudState; width: number; height: number; vignette?: boolean }) {
  const scope = Math.min(width, height);
  const light = state.light ?? 1;
  const vig = 0.6 * (1 - light / (4 - 3 * light)); // vanilla LightTexture.getBrightness curve
  const freeze = state.freeze ?? (state.frozen ? 1 : 0);
  let portal = state.portal ?? 0;
  if (portal > 0 && portal < 1) {
    portal *= portal;
    portal *= portal;
    portal = portal * 0.8 + 0.2;
  }
  return (
    <>
      <style>{OVERLAY_CSS}</style>
      {vignette && (packUrl("misc/vignette") ? (
        <div style={full(width, height, { background: "#000", opacity: vig, transition: "opacity 2s", maskImage: `url(${packUrl("misc/vignette")})`, maskMode: "luminance", maskSize: "100% 100%" })} />
      ) : (
        <div style={full(width, height, { background: "radial-gradient(ellipse 75% 75% at center, transparent 45%, #000 100%)", opacity: vig, transition: "opacity 2s" })} />
      ))}
      {state.spyglass && (
        <div style={full(width, height, { background: `radial-gradient(circle ${scope / 2}px at center, transparent 92%, rgba(0,0,0,0.6) 97%, #000 100%)` })} />
      )}
      {state.pumpkin && <img alt="" src={packUrl("misc/pumpkinblur") || pumpkin()} draggable={false} style={full(width, height, { opacity: 1 })} />}
      {freeze > 0 && (
        <div
          style={full(width, height, {
            opacity: freeze,
            background: "radial-gradient(ellipse 70% 70% at center, transparent 55%, rgba(220,240,255,0.55) 85%, rgba(245,252,255,0.9) 100%)",
            boxShadow: "inset 0 0 24px 6px rgba(255,255,255,0.7)",
          })}
        />
      )}
      {portal > 0 && (
        <div
          style={full(width, height, {
            opacity: portal,
            backgroundImage: `url(${portalUrl()})`,
            backgroundSize: "100% 100%",
            imageRendering: "pixelated",
            animation: "mc-portal 4s linear infinite",
          })}
        />
      )}
    </>
  );
}
