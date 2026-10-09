import type { CameraRig } from "./camera";
import type { Render } from "./render";
import type { Sfx } from "./contracts";

export const PHOTO_FILTERS = [
  { id: "none", label: "None", css: "none" },
  { id: "noir", label: "Noir", css: "grayscale(1) contrast(1.35) brightness(0.95)" },
  { id: "warm", label: "Warm", css: "sepia(0.35) saturate(1.3) hue-rotate(-10deg) brightness(1.04)" },
  { id: "cool", label: "Cool", css: "sepia(0.3) hue-rotate(165deg) saturate(1.25) brightness(1.02)" },
  { id: "comic", label: "Comic", css: "contrast(1.9) saturate(1.8) brightness(1.05)" },
] as const;
export const PHOTO_FRAMES = [
  { id: "none", label: "None" },
  { id: "white", label: "White" },
  { id: "comic", label: "Comic" },
] as const;
export type PhotoFilter = (typeof PHOTO_FILTERS)[number]["id"];
export type PhotoFrame = (typeof PHOTO_FRAMES)[number]["id"];

const SPEED = 8;
const FAST = 22;
const KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "Space", "KeyZ", "ShiftLeft", "ShiftRight"]);

export function createPhoto(view: Render, rig: CameraRig, canvas: HTMLCanvasElement, sfx: (name: Sfx) => void = () => {}) {
  let active = false;
  let filter: PhotoFilter = "none";
  let dragging = false;
  const keys = new Set<string>();
  const listeners = new Set<(on: boolean) => void>();

  const onKeyDown = (e: KeyboardEvent) => {
    if (!active) return;
    if (e.code === "Escape") {
      e.preventDefault();
      photo.exit();
      return;
    }
    if (!KEYS.has(e.code) || (e.target as HTMLElement)?.tagName === "INPUT") return;
    e.preventDefault();
    keys.add(e.code);
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  const onDown = (e: MouseEvent) => {
    if (active && e.button === 0) dragging = true;
  };
  const onUp = () => {
    dragging = false;
  };
  const onMove = (e: MouseEvent) => {
    if (active && (dragging || document.pointerLockElement === canvas)) rig.mouse(e.movementX, e.movementY);
  };
  const onBlur = () => {
    keys.clear();
    dragging = false;
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mouseup", onUp);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("blur", onBlur);
  canvas.addEventListener("mousedown", onDown);

  const set = (on: boolean) => {
    if (on === active) return;
    active = on;
    keys.clear();
    dragging = false;
    rig.setFree(on);
    canvas.style.filter = "";
    if (on) {
      filter = "none";
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    }
    for (const fn of listeners) fn(on);
  };

  const photo = {
    get active() {
      return active;
    },
    get filter() {
      return filter;
    },
    get fov() {
      return rig.freeFov;
    },
    enter: () => set(true),
    exit: () => set(false),
    onChange(fn: (on: boolean) => void) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    setFilter(id: PhotoFilter) {
      filter = id;
      const f = PHOTO_FILTERS.find((x) => x.id === id) ?? PHOTO_FILTERS[0];
      canvas.style.filter = f.css === "none" ? "" : f.css;
    },
    setFov: (v: number) => rig.setFov(v),
    update(dt: number) {
      if (!active || !keys.size) return;
      const k = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? FAST : SPEED) * dt;
      const ax = (a: string, b: string) => (keys.has(a) ? 1 : 0) - (keys.has(b) ? 1 : 0);
      rig.fly(ax("KeyW", "KeyS") * k, ax("KeyD", "KeyA") * k, ax("Space", "KeyZ") * k);
    },
    // Renders and reads back in one task, so it works without preserveDrawingBuffer.
    capture(frame: PhotoFrame = "none"): Promise<Blob> {
      view.render();
      const w = canvas.width;
      const h = canvas.height;
      const out = document.createElement("canvas");
      out.width = w;
      out.height = h;
      const ctx = out.getContext("2d")!;
      const f = PHOTO_FILTERS.find((x) => x.id === filter) ?? PHOTO_FILTERS[0];
      if (f.css !== "none") ctx.filter = f.css;
      ctx.drawImage(canvas, 0, 0, w, h);
      ctx.filter = "none";
      drawFrame(ctx, frame, w, h);
      sfx("shutter");
      return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error("Capture failed"))), "image/png"));
    },
    dispose() {
      set(false);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("blur", onBlur);
      canvas.removeEventListener("mousedown", onDown);
    },
  };
  return photo;
}

function drawFrame(ctx: CanvasRenderingContext2D, frame: PhotoFrame, w: number, h: number) {
  const u = Math.max(2, Math.round(Math.min(w, h) / 100));
  if (frame === "white") {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = u * 2;
    ctx.strokeRect(u * 3, u * 3, w - u * 6, h - u * 6);
  } else if (frame === "comic") {
    ctx.fillStyle = "#f4f1e8";
    const m = u * 4;
    ctx.fillRect(0, 0, w, m);
    ctx.fillRect(0, h - m, w, m);
    ctx.fillRect(0, 0, m, h);
    ctx.fillRect(w - m, 0, m, h);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = u * 1.5;
    ctx.strokeRect(m, m, w - m * 2, h - m * 2);
    ctx.fillStyle = "#e2231a";
    ctx.fillRect(m, h - m - u * 2, w - m * 2, u * 2);
  }
}

export type Photo = ReturnType<typeof createPhoto>;
