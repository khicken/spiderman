"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { textWidth } from "./font";
import { Text, useGui } from "./gui";
import { buttonUrl, dirtUrl, sliderHandleUrl, sliderTrackUrl } from "./sprites";
import { activeSettings } from "./settings";

let clickSound: (() => void) | null = null;
// The integration layer sets this to play "ui.button.click".
export const setUiClickSound = (fn: (() => void) | null) => {
  clickSound = fn;
};
export const playClick = () => clickSound?.();

export function useKeyDown(handler: (e: KeyboardEvent) => void, active = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const on = (e: KeyboardEvent) => ref.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [active]);
}

const abs = (x: number, y: number, w: number, h: number): CSSProperties => ({ position: "absolute", left: x, top: y, width: w, height: h });

export interface ButtonProps {
  x: number;
  y: number;
  width?: number;
  height?: number;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}

export function Button({ x, y, width = 200, height = 20, label, onClick, disabled }: ButtonProps) {
  const [hover, setHover] = useState(false);
  const look = disabled ? "disabled" : hover ? "hover" : "normal";
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseDown={(e) => {
        if (e.button !== 0 || disabled) return;
        playClick();
        onClick?.();
      }}
      style={{ ...abs(x, y, width, height), backgroundImage: `url(${buttonUrl(width, height, look)})`, pointerEvents: "auto", cursor: disabled ? "default" : "pointer" }}
    >
      <Label text={label} color={disabled ? 0xa0a0a0 : 0xffffff} width={width} height={height} />
    </div>
  );
}

const SCROLL_CSS = `@keyframes mc-scroll{0%,15%{transform:translateX(0)}50%,65%{transform:translateX(var(--mc-d))}100%{transform:translateX(0)}}`;

// Vanilla AbstractWidget.renderScrollingString: a label wider than the widget scrolls back and forth inside it.
function Label({ text, color, width, height }: { text: string; color: number; width: number; height: number }) {
  const y = Math.floor((height - 8) / 2);
  const tw = textWidth(text);
  const room = width - 4;
  if (tw <= room) return <Text text={text} color={color} x={width / 2} y={y} align="center" />;
  const d = room - tw;
  return (
    <div style={{ position: "absolute", left: 2, top: 0, width: room, height, overflow: "hidden" }}>
      <style>{SCROLL_CSS}</style>
      <div style={{ position: "absolute", left: 0, top: y, ["--mc-d" as string]: `${d}px`, animation: `mc-scroll ${Math.max(2, -d / 10) * 2}s ease-in-out infinite` }}>
        <Text text={text} color={color} x={0} y={0} />
      </div>
    </div>
  );
}

export interface SliderProps {
  x: number;
  y: number;
  width?: number;
  height?: number;
  value: number; // 0..1
  label: string;
  onChange: (v: number) => void;
}

export function Slider({ x, y, width = 150, height = 20, value, label, onChange }: SliderProps) {
  const [hover, setHover] = useState(false);
  const [drag, setDrag] = useState(false);
  const set = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const k = r.width / width;
    const v = (clientX - r.left - 4 * k) / (r.width - 8 * k);
    onChange(Math.max(0, Math.min(1, v)));
  };
  return (
    <div
      tabIndex={-1}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(true);
        set(e.clientX, e.currentTarget);
      }}
      onPointerMove={(e) => drag && set(e.clientX, e.currentTarget)}
      onPointerUp={() => {
        if (drag) playClick();
        setDrag(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onChange(Math.max(0, value - 0.01));
        if (e.key === "ArrowRight") onChange(Math.min(1, value + 0.01));
      }}
      style={{ ...abs(x, y, width, height), backgroundImage: `url(${sliderTrackUrl(width, height)})`, pointerEvents: "auto", cursor: "pointer", outline: "none" }}
    >
      <div style={{ ...abs(Math.round(value * (width - 8)), 0, 8, height), backgroundImage: `url(${sliderHandleUrl(8, height, hover || drag)})` }} />
      <Label text={label} color={0xffffff} width={width} height={height} />
    </div>
  );
}

export interface TextFieldProps {
  x: number;
  y: number;
  width?: number;
  height?: number;
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  onKey?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  hint?: string;
  maxLength?: number;
  autoFocus?: boolean;
  bordered?: boolean;
  textColor?: number;
  amp?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  password?: boolean;
}

// A hidden native input keeps paste, selection and IME; the visible text is drawn with the pixel font.
export function TextField({ x, y, width = 200, height = 20, value, onChange, onEnter, onKey, hint, maxLength = 32, autoFocus, bordered = true, textColor = 0xe0e0e0, amp, inputRef, password }: TextFieldProps) {
  const own = useRef<HTMLInputElement | null>(null);
  const ref = inputRef ?? own;
  const [focus, setFocus] = useState(false);
  const [sel, setSel] = useState<[number, number]>([value.length, value.length]);
  const [blink, setBlink] = useState(true);
  useEffect(() => {
    if (!focus) return;
    const id = setInterval(() => setBlink((b) => !b), 300);
    return () => clearInterval(id);
  }, [focus]);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus, ref]);
  const sync = () => {
    const el = ref.current;
    if (el) setSel([el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length]);
  };
  const pad = bordered ? 4 : 0;
  const inner = width - pad * 2;
  const text = password ? "*".repeat(value.length) : value;
  const cur = Math.min(sel[0], text.length);
  let start = 0;
  while (start < cur && textWidth(text.slice(start, cur)) > inner - 6) start++;
  let end = text.length;
  while (end > cur && textWidth(text.slice(start, end)) > inner) end--;
  const shown = text.slice(start, end);
  const caretX = pad + textWidth(text.slice(start, cur));
  const selA = Math.max(start, Math.min(sel[0], sel[1]));
  const selB = Math.min(end, Math.max(sel[0], sel[1]));
  const ty = Math.floor((height - 8) / 2);
  return (
    <div style={{ ...abs(x, y, width, height), background: bordered ? "#000" : undefined, boxShadow: bordered ? `inset 0 0 0 1px ${focus ? "#fff" : "#a0a0a0"}` : undefined, pointerEvents: "auto" }}>
      {shown ? <Text text={shown} color={textColor} x={pad} y={ty} amp={amp} /> : !focus && hint ? <Text text={hint} color={0x808080} x={pad} y={ty} /> : null}
      {focus && selB > selA && (
        <div style={{ ...abs(pad + textWidth(text.slice(start, selA)), ty - 1, textWidth(text.slice(selA, selB)), 10), background: "rgba(0,0,255,0.6)" }} />
      )}
      {focus && blink && (cur < text.length ? <div style={{ ...abs(caretX - 1, ty - 1, 1, 10), background: "#d0d0d0" }} /> : <Text text="_" color={textColor} x={caretX} y={ty} />)}
      <input
        ref={ref}
        type={password ? "password" : "text"}
        value={value}
        maxLength={maxLength}
        spellCheck={false}
        autoComplete="off"
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onChange={(e) => {
          onChange(e.target.value);
          setSel([e.target.selectionStart ?? 0, e.target.selectionEnd ?? 0]);
        }}
        onSelect={sync}
        onKeyUp={sync}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") onEnter?.();
          onKey?.(e);
          if (e.key === "Escape") (e.target as HTMLInputElement).blur();
        }}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, border: 0, padding: 0, font: "8px monospace", cursor: "text" }}
      />
    </div>
  );
}

export type BackgroundKind = "dirt" | "ingame" | "none" | "death" | "menu";

export function Screen({ background = "dirt", children, onMouseDown }: { background?: BackgroundKind; children: ReactNode; onMouseDown?: (e: React.MouseEvent) => void }) {
  const { width, height } = useGui();
  const bg: CSSProperties =
    background === "dirt"
      ? { backgroundImage: `url(${dirtUrl()})`, backgroundSize: "32px 32px", imageRendering: "pixelated" }
      : background === "ingame"
        ? { background: "linear-gradient(rgba(16,16,16,0.75), rgba(16,16,16,0.82))", backdropFilter: `blur(${activeSettings().menuBlur}px)`, WebkitBackdropFilter: `blur(${activeSettings().menuBlur}px)` }
        : background === "death"
          ? { background: "linear-gradient(rgba(80,0,0,0.38), rgba(128,48,48,0.63))" }
          : {};
  return (
    <div onMouseDown={onMouseDown} onContextMenu={(e) => e.preventDefault()} style={{ ...abs(0, 0, width, height), ...bg, pointerEvents: "auto" }}>
      {children}
    </div>
  );
}

export function ListArea({ top, bottom, children }: { top: number; bottom: number; children?: ReactNode }) {
  const { width } = useGui();
  return (
    <div style={{ ...abs(0, top, width, bottom - top), background: "rgba(0,0,0,0.45)", boxShadow: "inset 0 1px 0 rgba(0,0,0,0.9), inset 0 2px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(255,255,255,0.18), inset 0 -2px 0 rgba(0,0,0,0.9)", overflow: "hidden" }}>
      {children}
    </div>
  );
}

export const onOff = (b: boolean) => (b ? "ON" : "OFF");
