"use client";

import { useCallback, useRef } from "react";
import type { ClickKind, ItemStack } from "../contracts";
import { LINE_HEIGHT, textWidth } from "./font";
import { useGui, Text } from "./gui";
import { ItemIcon } from "./item-icon";
import { disabledSlotUrl, emptySlotUrl, slotUrl, type EmptySlotKind } from "./sprites";

export interface SlotBoxProps {
  x: number; // item top-left; the 18x18 frame starts 1px up-left
  y: number;
  stack: ItemStack | null;
  big?: boolean;
  disabled?: boolean;
  frame?: boolean;
  empty?: EmptySlotKind; // silhouette when the slot has no item
  dragged?: boolean; // part of a drag split
  hovered: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onDown: (e: React.MouseEvent) => void;
}

export function SlotBox({ x, y, stack, big, disabled, frame = true, empty, dragged, hovered, onEnter, onLeave, onDown }: SlotBoxProps) {
  const pad = big ? 5 : 1;
  const size = 16 + pad * 2;
  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onMouseDown={onDown}
      style={{ position: "absolute", left: x - pad, top: y - pad, width: size, height: size, backgroundImage: frame ? `url(${disabled ? disabledSlotUrl() : slotUrl(size)})` : undefined }}
    >
      {!stack && empty && <img alt="" src={emptySlotUrl(empty)} width={16} height={16} draggable={false} style={{ position: "absolute", left: pad, top: pad, imageRendering: "pixelated" }} />}
      {stack && <ItemIcon stack={stack} x={pad} y={pad} />}
      {(hovered || dragged) && !disabled && <div style={{ position: "absolute", left: pad, top: pad, width: 16, height: 16, background: "rgba(255,255,255,0.5)" }} />}
    </div>
  );
}

export function clickKindOf(e: React.MouseEvent): ClickKind {
  if (e.button === 1) return "middle";
  if (e.shiftKey) return "shift";
  return e.button === 2 ? "right" : "left";
}

export function tooltipSize(lines: string[]) {
  const w = lines.length ? Math.max(...lines.map((l) => textWidth(l))) : 0;
  const h = lines.length <= 1 ? 8 : 10 + (lines.length - 1) * (LINE_HEIGHT + 1);
  return { w, h };
}

export function TooltipBox({ lines }: { lines: string[] }) {
  const { w, h } = tooltipSize(lines);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h }}>
      <div style={{ position: "absolute", left: -3, top: -4, width: w + 6, height: h + 8, background: "rgba(16,0,16,0.94)" }} />
      <div style={{ position: "absolute", left: -4, top: -3, width: w + 8, height: h + 6, background: "rgba(16,0,16,0.94)" }} />
      <div
        style={{
          position: "absolute",
          left: -3,
          top: -3,
          width: w + 6,
          height: h + 6,
          boxSizing: "border-box",
          border: "1px solid transparent",
          borderImage: "linear-gradient(rgba(80,0,255,0.31), rgba(40,0,127,0.31)) 1",
        }}
      />
      {lines.map((l, i) => (
        <Text key={i} text={l} x={0} y={i === 0 ? 0 : 2 + i * (LINE_HEIGHT + 1)} />
      ))}
    </div>
  );
}

// The last client mouse position, tracked from page load so a screen opened under a still mouse knows where it is.
const lastClient = { x: -1000, y: -1000 };
if (typeof window !== "undefined") {
  const track = (e: MouseEvent) => {
    lastClient.x = e.clientX;
    lastClient.y = e.clientY;
  };
  window.addEventListener("mousemove", track, { passive: true });
  window.addEventListener("mousedown", track, { passive: true });
}
export const lastMouse = () => lastClient;

// Moves the cursor stack and tooltip with DOM writes, so mouse motion does not re-render React.
export function usePointer(tipLines: string[]) {
  const { scale, width, height } = useGui();
  const cursorRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const mouse = useRef({ x: lastClient.x / scale, y: lastClient.y / scale });
  const size = tooltipSize(tipLines);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const place = useCallback(() => {
    const { x, y } = mouse.current;
    if (cursorRef.current) cursorRef.current.style.transform = `translate(${x - 8}px, ${y - 8}px)`;
    if (tipRef.current) {
      const { w, h } = sizeRef.current;
      let tx = x + 12;
      let ty = y - 12;
      if (tx + w + 4 > width) tx = Math.max(4, x - 16 - w);
      if (ty + h + 6 > height) ty = height - h - 6;
      if (ty < 4) ty = 4;
      tipRef.current.style.transform = `translate(${tx}px, ${ty}px)`;
    }
  }, [width, height]);
  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      mouse.current = { x: e.clientX / scale, y: e.clientY / scale };
      place();
    },
    [scale, place],
  );
  const setTip = useCallback(
    (el: HTMLDivElement | null) => {
      tipRef.current = el;
      if (el) place();
    },
    [place],
  );
  const setCursor = useCallback(
    (el: HTMLDivElement | null) => {
      cursorRef.current = el;
      if (el) place();
    },
    [place],
  );
  return { onMouseMove, setTip, setCursor, mouse };
}

export function PointerLayer({ cursor, tip, setCursor, setTip }: { cursor: ItemStack | null; tip: string[]; setCursor: (el: HTMLDivElement | null) => void; setTip: (el: HTMLDivElement | null) => void }) {
  return (
    <>
      {tip.length > 0 && !cursor && (
        <div ref={setTip} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 60 }}>
          <TooltipBox lines={tip} />
        </div>
      )}
      {cursor && (
        <div ref={setCursor} style={{ position: "absolute", left: 0, top: 0, width: 16, height: 16, pointerEvents: "none", zIndex: 70 }}>
          <ItemIcon stack={cursor} x={0} y={0} />
        </div>
      )}
    </>
  );
}
