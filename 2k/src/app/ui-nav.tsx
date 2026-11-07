"use client";

import { useEffect, useRef } from "react";

// The newest mounted root owns keys and pad nav (page.tsx forwards game.input.onNav pad edges to nav()).
// data-lr="1": the element takes left/right itself as an "lr" CustomEvent (detail -1/1).
// data-tab="1": LB/RB also arrive as "lr" when the root has no tab handler.

export type NavDir = "up" | "down" | "left" | "right" | "ok" | "back" | "tabLeft" | "tabRight" | "start";
export type NavSound = "menuMove" | "menuSelect" | "menuBack" | "menuTab" | "error";

type Root = {
  el: () => HTMLElement | null;
  back?: () => void;
  tab?: (d: -1 | 1) => void;
  start?: () => void;
  any?: () => void;
  enterStart?: boolean;
  since: number;
};

const roots: Root[] = [];
let listeners = 0;
let sound: ((s: NavSound) => void) | null = null;
let lastDir: NavDir | null = null;
let lastAt = 0;

const FOCUSABLE = "button:not(:disabled), a[href]:not([data-nonav]), input:not(:disabled), [data-nav]";
const GRACE = 0.22; // s: a root ignores back/start right after it mounts (the press that opened it)

export function setNavSound(fn: ((s: NavSound) => void) | null) {
  sound = fn;
}

export function navSound(s: NavSound) {
  try {
    sound?.(s);
  } catch {
    /* audio must never break the menu */
  }
}

function visible(e: HTMLElement) {
  // tabIndex=-1 buttons are mouse-only helpers (team strip dots, ◀ ▶ arrows, tab bars): never a nav stop
  if (e.getAttribute("tabindex") === "-1" || e.hasAttribute("data-nav-skip")) return false;
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
}

function stepRange(el: HTMLInputElement, sign: number) {
  const v = Math.min(+el.max, Math.max(+el.min, +el.value + sign * (+el.step || 1)));
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, String(v));
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function nav(dir: NavDir, src: "pad" | "key" = "key") {
  const now = performance.now();
  if (src === "pad" && dir === lastDir && now - lastAt < 60) return;
  lastDir = dir;
  lastAt = now;
  const root = roots[roots.length - 1];
  const host = root?.el();
  if (!root || !host) return;
  if (root.any) return root.any();
  const fresh = (now - root.since) / 1000 < GRACE;
  if (dir === "back") {
    if (fresh || !root.back) return;
    navSound("menuBack");
    return root.back();
  }
  if (dir === "start") {
    if (fresh) return;
    if (root.start) {
      navSound("menuSelect");
      return root.start();
    }
    dir = "ok";
  }
  const cur = document.activeElement as HTMLElement | null;
  const inside = !!cur && host.contains(cur) && cur !== host;
  if (dir === "tabLeft" || dir === "tabRight") {
    const d = dir === "tabLeft" ? -1 : 1;
    if (root.tab) {
      navSound("menuTab");
      return root.tab(d);
    }
    if (inside && cur!.dataset.tab === "1") {
      navSound("menuTab");
      cur!.dispatchEvent(new CustomEvent("lr", { detail: d }));
    }
    return;
  }
  if (dir === "ok") {
    if (inside) {
      navSound("menuSelect");
      cur!.click();
    } else focusFirst(host);
    return;
  }
  if (!inside) return focusFirst(host);
  if ((dir === "left" || dir === "right") && cur!.dataset.lr === "1") {
    navSound("menuMove");
    cur!.dispatchEvent(new CustomEvent("lr", { detail: dir === "left" ? -1 : 1 }));
    return;
  }
  if (cur instanceof HTMLInputElement && cur.type === "range" && (dir === "left" || dir === "right")) {
    navSound("menuMove");
    return stepRange(cur, dir === "left" ? -1 : 1);
  }
  const all = [...host.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
  const a = cur!.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const dx = dir === "left" ? -1 : dir === "right" ? 1 : 0;
  const dy = dir === "up" ? -1 : dir === "down" ? 1 : 0;
  let best: HTMLElement | null = null;
  let score = Infinity;
  for (const e of all) {
    if (e === cur || e.contains(cur) || cur!.contains(e)) continue;
    const r = e.getBoundingClientRect();
    const along = dx ? (dx > 0 ? r.left - a.right : a.left - r.right) : dy > 0 ? r.top - a.bottom : a.top - r.bottom;
    const cx = r.left + r.width / 2 - ax;
    const cy = r.top + r.height / 2 - ay;
    if ((dx ? cx * dx : cy * dy) <= 1 || along < -Math.min(a.width, a.height) * 0.5) continue;
    const overlap = dx ? Math.min(r.bottom, a.bottom) - Math.max(r.top, a.top) : Math.min(r.right, a.right) - Math.max(r.left, a.left);
    const across = overlap > 0 ? 0 : dx ? Math.abs(cy) : Math.abs(cx);
    const s = Math.max(0, along) + across * 2.5;
    if (s < score) {
      score = s;
      best = e;
    }
  }
  if (best) {
    navSound("menuMove");
    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }
}

function focusFirst(host: HTMLElement) {
  const all = [...host.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
  (host.querySelector<HTMLElement>("[data-autofocus]") ?? all[0])?.focus({ preventScroll: true });
}

const KEYS: Record<string, NavDir> = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", KeyQ: "tabLeft", KeyE: "tabRight",
  KeyW: "up", KeyS: "down", KeyA: "left", KeyD: "right",
};

function onKey(e: KeyboardEvent) {
  const root = roots[roots.length - 1];
  if (!root) return;
  if (root.any) {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    return root.any();
  }
  const t = e.target as HTMLElement | null;
  const text = t instanceof HTMLInputElement && t.type === "text";
  const range = t instanceof HTMLInputElement && t.type === "range";
  if (e.key === "Escape" || e.key === "Backspace") {
    if (text) return t.blur();
    e.preventDefault();
    return nav("back");
  }
  // screens with a start action (team select: TIP OFF): Enter starts from carousels, pickers and info rows
  // (data-start="1"); a real action button keeps its own Enter
  const actionBtn = !!t && (t.tagName === "BUTTON" || t.tagName === "A") && t.dataset.start !== "1";
  if (e.key === "Enter" && root.start && root.enterStart && !e.repeat && !text && !actionBtn && !!t && t !== document.body) {
    e.preventDefault();
    return nav("start");
  }
  if (e.key === "Enter" || e.key === " ") {
    if (t && (t.tagName === "BUTTON" || t.tagName === "A" || text)) {
      if (e.key === "Enter" && !e.repeat) navSound("menuSelect");
      return;
    }
    e.preventDefault();
    return nav("ok");
  }
  if (text) return;
  const dir = KEYS[e.code];
  if (!dir || (range && (dir === "left" || dir === "right"))) return;
  e.preventDefault();
  nav(dir);
}

export type NavOpts = {
  back?: () => void;
  tab?: (d: -1 | 1) => void;
  start?: () => void;
  any?: () => void;
  enterStart?: boolean; // Enter starts (root.start) unless focus is on an action button
  autofocus?: boolean;
  active?: boolean;
};

export function useNavRoot(ref: React.RefObject<HTMLElement | null>, opts: NavOpts = {}) {
  const o = useRef(opts);
  useEffect(() => {
    o.current = opts;
  });
  const active = opts.active ?? true;
  const autofocus = opts.autofocus ?? true;
  // the element that had focus when this root last went inactive (an overlay opened over it): restored on return
  const lastFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const root: Root = {
      el: () => ref.current,
      back: () => o.current.back?.(),
      tab: opts.tab ? (d) => o.current.tab?.(d) : undefined,
      start: opts.start ? () => o.current.start?.() : undefined,
      any: opts.any ? () => o.current.any?.() : undefined,
      enterStart: !!opts.enterStart,
      since: performance.now(),
    };
    if (!opts.back) root.back = undefined;
    roots.push(root);
    if (listeners++ === 0) window.addEventListener("keydown", onKey);
    if (autofocus) {
      const id = requestAnimationFrame(() => {
        const host = ref.current;
        if (!host || host.contains(document.activeElement)) return;
        const prev = lastFocus.current;
        lastFocus.current = null;
        if (prev && prev.isConnected && host.contains(prev) && visible(prev)) prev.focus({ preventScroll: true });
        else focusFirst(host);
      });
      root.since = performance.now();
      return () => {
        const host = ref.current;
        const cur = document.activeElement as HTMLElement | null;
        if (host && cur && host.contains(cur)) lastFocus.current = cur;
        cancelAnimationFrame(id);
        roots.splice(roots.indexOf(root), 1);
        if (--listeners === 0) window.removeEventListener("keydown", onKey);
      };
    }
    return () => {
      roots.splice(roots.indexOf(root), 1);
      if (--listeners === 0) window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, active, autofocus]);
}

export function useLR(ref: React.RefObject<HTMLElement | null>, fn: (d: -1 | 1) => void) {
  const f = useRef(fn);
  useEffect(() => {
    f.current = fn;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = (e: Event) => f.current((e as CustomEvent<number>).detail < 0 ? -1 : 1);
    el.addEventListener("lr", h);
    return () => el.removeEventListener("lr", h);
  }, [ref]);
}
