import * as THREE from "three";
import type { Action, Controls, Input, VirtualPad } from "./contracts";

const KEYS: Record<string, Action> = {
  Space: "gas",
  ShiftLeft: "dash",
  ShiftRight: "dash",
  KeyE: "attack",
  KeyQ: "lock",
  Tab: "cycle",
  KeyF: "autoHook",
  KeyR: "swap",
  KeyC: "anchorL",
  KeyV: "anchorR",
};
const BUTTONS: Record<number, Action> = { 0: "anchorL", 2: "anchorR" };
const MOVE = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
const SYSTEM = new Set(["Escape", "Enter", "KeyM", "KeyG", "Digit1", "Digit2", "Digit3"]);

export function createInput(canvas: HTMLCanvasElement, onSystem: (code: string) => void): Controls {
  const held = new Set<Action>();
  const pressed = new Set<Action>();
  const released = new Set<Action>();
  const since = new Map<Action, number>();
  const by = new Map<Action, Set<string>>();
  const codes = new Set<string>();
  const stick = { x: 0, y: 0 };
  let enabled = false;
  let dx = 0;
  let dy = 0;
  let lastMouse = performance.now();
  let wheelAcc = 0;

  const state: Input = {
    wish: new THREE.Vector3(),
    look: new THREE.Vector3(0, 0, 1),
    camPos: new THREE.Vector3(),
    held,
    pressed,
    released,
    holdTime: (a) => {
      const s = since.get(a);
      return s === undefined || !held.has(a) ? 0 : (performance.now() - s) / 1000;
    },
  };

  const down = (a: Action, src: string) => {
    if (a === "cycle") return tap(a);
    const s = by.get(a) ?? new Set<string>();
    by.set(a, s);
    s.add(src);
    if (held.has(a)) return;
    held.add(a);
    pressed.add(a);
    since.set(a, performance.now());
  };
  const up = (a: Action, src: string) => {
    const s = by.get(a);
    if (!s?.delete(src) || s.size) return;
    if (held.delete(a)) released.add(a);
  };
  const tap = (a: Action) => {
    pressed.add(a);
    released.add(a);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const a = KEYS[e.code];
    if (SYSTEM.has(e.code)) {
      if (enabled && !e.repeat) onSystem(e.code);
      return;
    }
    if (!enabled) return;
    if (a || MOVE.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (a || MOVE.has(e.code)) codes.add(e.code);
    if (a) down(a, e.code);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    codes.delete(e.code);
    const a = KEYS[e.code];
    if (a) up(a, e.code);
  };
  const onMouseDown = (e: MouseEvent) => {
    const a = BUTTONS[e.button];
    if (enabled && a) {
      e.preventDefault();
      down(a, `m${e.button}`);
    }
  };
  const onMouseUp = (e: MouseEvent) => {
    const a = BUTTONS[e.button];
    if (a) up(a, `m${e.button}`);
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!enabled) return;
    dx += e.movementX;
    dy += e.movementY;
    if (e.movementX || e.movementY) lastMouse = performance.now();
  };
  const onWheel = (e: WheelEvent) => {
    if (!enabled) return;
    wheelAcc += Math.abs(e.deltaY);
    if (wheelAcc >= 40) {
      wheelAcc = 0;
      tap("cycle");
    }
  };
  const noMenu = (e: Event) => e.preventDefault();
  const clear = () => {
    for (const a of held) released.add(a);
    held.clear();
    by.clear();
    codes.clear();
    stick.x = stick.y = 0;
  };
  const virtual: VirtualPad = {
    down: (a) => enabled && down(a, "v"),
    up: (a) => up(a, "v"),
    stick(x, y) {
      const on = enabled && Math.hypot(x, y) > 0.15;
      stick.x = on ? x : 0;
      stick.y = on ? y : 0;
    },
    look(x, y) {
      if (!enabled) return;
      dx += x;
      dy += y;
      if (x || y) lastMouse = performance.now();
    },
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("wheel", onWheel, { passive: true });
  window.addEventListener("blur", clear);
  canvas.addEventListener("contextmenu", noMenu);

  return {
    state,
    virtual,
    get enabled() {
      return enabled;
    },
    set enabled(on: boolean) {
      enabled = on;
      if (!on) clear();
      else lastMouse = performance.now();
    },
    get mouseIdle() {
      return (performance.now() - lastMouse) / 1000;
    },
    takeMouse(out) {
      out.x = dx;
      out.y = dy;
      dx = dy = 0;
      return out;
    },
    aim(yaw, pitch, camPos) {
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const has = (a: string, b: string) => codes.has(a) || codes.has(b);
      const f = (has("KeyW", "ArrowUp") ? 1 : 0) - (has("KeyS", "ArrowDown") ? 1 : 0) + stick.y;
      const r = (has("KeyD", "ArrowRight") ? 1 : 0) - (has("KeyA", "ArrowLeft") ? 1 : 0) + stick.x;
      const w = state.wish.set(fx * f - fz * r, 0, fz * f + fx * r);
      if (w.lengthSq() > 0) w.normalize();
      state.look.set(fx * Math.cos(pitch), Math.sin(pitch), fz * Math.cos(pitch));
      state.camPos.copy(camPos);
    },
    endFrame() {
      pressed.clear();
      released.clear();
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("blur", clear);
      canvas.removeEventListener("contextmenu", noMenu);
    },
  };
}
