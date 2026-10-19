"use client";

import { Fragment, createContext, useContext, useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { textImage, textWidth } from "./font";
import { initPacks, onPacksChanged, stackVersion } from "../packs";

// Vanilla rule: the largest scale where the window still holds 320x240 GUI pixels.
export function computeGuiScale(setting: number, w: number, h: number): number {
  let s = 1;
  const max = setting > 0 ? setting : 4;
  while (s < max && w / (s + 1) >= 320 && h / (s + 1) >= 240) s++;
  return s;
}

export interface GuiSize {
  scale: number;
  width: number; // GUI pixels
  height: number;
}

const GuiContext = createContext<GuiSize>({ scale: 2, width: 427, height: 240 });
export const useGui = () => useContext(GuiContext);

function useWindowSize() {
  const [size, setSize] = useState({ w: 854, h: 480 });
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return size;
}

// Remounts the GUI after a pack change so every sprite, icon and glyph is read again.
function usePackVersion() {
  return useSyncExternalStore(onPacksChanged, stackVersion, () => 0);
}

export function GuiRoot({ guiScale = 0, children, style }: { guiScale?: number; children: ReactNode; style?: CSSProperties }) {
  const { w, h } = useWindowSize();
  const packV = usePackVersion();
  useEffect(() => {
    void initPacks();
  }, []);
  const scale = computeGuiScale(guiScale, w, h);
  const width = Math.ceil(w / scale);
  const height = Math.ceil(h / scale);
  return (
    <GuiContext.Provider value={{ scale, width, height }}>
      <div style={{ position: "fixed", inset: 0, overflow: "hidden", pointerEvents: "none", userSelect: "none", ...style }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width,
            height,
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
            imageRendering: "pixelated",
          }}
        >
          <Fragment key={packV}>{children}</Fragment>
        </div>
      </div>
    </GuiContext.Provider>
  );
}

export interface TextProps {
  text: string;
  color?: number;
  shadow?: boolean;
  amp?: boolean;
  x?: number;
  y?: number;
  align?: "left" | "center" | "right"; // x is the left edge, center or right edge
  scale?: number;
  opacity?: number;
  style?: CSSProperties;
}

export function Text({ text, color = 0xffffff, shadow = true, amp = false, x, y, align = "left", scale = 1, opacity, style }: TextProps) {
  if (!text) return null;
  const img = textImage(text, color, shadow, amp);
  const w = img.width * scale;
  const positioned = x !== undefined || y !== undefined;
  const left = x === undefined ? undefined : align === "center" ? x - (textWidth(text, amp) * scale) / 2 : align === "right" ? x - textWidth(text, amp) * scale : x;
  return (
    <img
      alt={text}
      draggable={false}
      src={img.url}
      width={w}
      height={img.height * scale}
      style={{
        display: "block",
        imageRendering: "pixelated",
        position: positioned ? "absolute" : undefined,
        left,
        top: y,
        opacity,
        pointerEvents: "none",
        maxWidth: "none",
        ...style,
      }}
    />
  );
}

export const rgba = (c: number, a = 1) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
export const argb = (c: number) => rgba(c & 0xffffff, ((c >>> 24) & 255) / 255);
