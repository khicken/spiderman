"use client";

import { useEffect, useRef } from "react";

// The newest mounted root owns arrows and Esc. Gamepads call nav() from the input loop.

export type NavDir = "up" | "down" | "left" | "right" | "ok" | "back";

type Root = { el: () => HTMLElement | null; back?: () => void };
const roots: Root[] = [];
let byKey = false;
let listeners = 0;

const FOCUSABLE = "button:not(:disabled), a[href], input:not(:disabled), [data-nav]";

export function focusByKey() {
  return byKey;
}

function visible(e: HTMLElement) {
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
}

function stepRange(el: HTMLInputElement, sign: number) {
  const v = Math.min(+el.max, Math.max(+el.min, +el.value + sign * (+el.step || 1)));
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, String(v));
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function nav(dir: NavDir) {
  byKey = true;
  const root = roots[roots.length - 1];
  const host = root?.el();
  if (!root || !host) return;
  if (dir === "back") return root.back?.();
  const cur = document.activeElement as HTMLElement | null;
  const inside = !!cur && host.contains(cur) && cur !== host;
  if (dir === "ok") {
    if (inside) cur!.click();
    return;
  }
  const all = [...host.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
  if (!inside) {
    (host.querySelector<HTMLElement>("[data-autofocus]") ?? all[0])?.focus();
    return;
  }
  if (cur instanceof HTMLInputElement && cur.type === "range" && (dir === "left" || dir === "right")) return stepRange(cur, dir === "left" ? -1 : 1);
  const a = cur!.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const dx = dir === "left" ? -1 : dir === "right" ? 1 : 0;
  const dy = dir === "up" ? -1 : dir === "down" ? 1 : 0;
  let best: HTMLElement | null = null;
  let score = Infinity;
  for (const e of all) {
    if (e === cur) continue;
    const r = e.getBoundingClientRect();
    // Nearest edge along the move, center offset across it.
    const along = dx ? (dx > 0 ? r.left - a.right : a.left - r.right) : dy > 0 ? r.top - a.bottom : a.top - r.bottom;
    const cx = r.left + r.width / 2 - ax;
    const cy = r.top + r.height / 2 - ay;
    if ((dx ? cx * dx : cy * dy) <= 1 || along < -Math.min(a.width, a.height) * 0.5) continue;
    const across = dx ? Math.abs(cy) : Math.abs(cx);
    const s = Math.max(0, along) + across * 2;
    if (s < score) {
      score = s;
      best = e;
    }
  }
  best?.focus();
  best?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}

function onKey(e: KeyboardEvent) {
  byKey = true;
  const t = e.target as HTMLElement | null;
  const text = t instanceof HTMLInputElement && t.type === "text";
  const range = t instanceof HTMLInputElement && t.type === "range";
  if (e.key === "Escape") {
    if (text) return t.blur();
    e.preventDefault();
    return nav("back");
  }
  const keys: Record<string, NavDir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
  const dir = keys[e.key];
  if (!dir || ((text || range) && (dir === "left" || dir === "right"))) return;
  e.preventDefault();
  nav(dir);
}

function onPointer() {
  byKey = false;
}

export function useNavRoot(ref: React.RefObject<HTMLElement | null>, back?: () => void, autofocus = true) {
  const backRef = useRef(back);
  useEffect(() => {
    backRef.current = back;
  });
  useEffect(() => {
    const root: Root = { el: () => ref.current, back: () => backRef.current?.() };
    roots.push(root);
    if (listeners++ === 0) {
      window.addEventListener("keydown", onKey);
      window.addEventListener("pointerdown", onPointer, true);
    }
    if (autofocus) ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    return () => {
      roots.splice(roots.indexOf(root), 1);
      if (--listeners === 0) {
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("pointerdown", onPointer, true);
      }
    };
  }, [ref, autofocus]);
}
