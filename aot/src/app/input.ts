import * as THREE from "three";
import type { Action, Controls, Input } from "./contracts";

const KEYS: Record<string, Action> = {
  Space: "gas",
  ShiftLeft: "dash",
  ShiftRight: "dash",
  KeyE: "attack",
  KeyQ: "lock",
  Tab: "cycle",
  KeyF: "autoHook",
  KeyR: "swap",
};
const BUTTONS: Record<number, Action> = { 0: "anchorL", 2: "anchorR" };
const MOVE = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
const SYSTEM = new Set(["Escape", "Enter", "KeyM"]);

export function createInput(canvas: HTMLCanvasElement, onSystem: (code: string) => void): Controls {
  const held = new Set<Action>();
  const pressed = new Set<Action>();
  const released = new Set<Action>();
  const since = new Map<Action, number>();
  const codes = new Set<string>();
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

  const down = (a: Action) => {
    if (held.has(a)) return;
    held.add(a);
    pressed.add(a);
    since.set(a, performance.now());
  };
  const up = (a: Action) => {
    if (!held.delete(a)) return;
    released.add(a);
  };
  const tap = (a: Action) => {
    pressed.add(a);
    released.add(a);
  };
  const keyHeld = (a: Action) => {
    for (const c of codes) if (KEYS[c] === a) return true;
    return false;
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
    if (a === "cycle") tap(a);
    else if (a) down(a);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    codes.delete(e.code);
    const a = KEYS[e.code];
    if (a && a !== "cycle" && !keyHeld(a)) up(a);
  };
  const onMouseDown = (e: MouseEvent) => {
    const a = BUTTONS[e.button];
    if (enabled && a) {
      e.preventDefault();
      down(a);
    }
  };
  const onMouseUp = (e: MouseEvent) => {
    const a = BUTTONS[e.button];
    if (a) up(a);
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
    codes.clear();
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
      const f = (has("KeyW", "ArrowUp") ? 1 : 0) - (has("KeyS", "ArrowDown") ? 1 : 0);
      const r = (has("KeyD", "ArrowRight") ? 1 : 0) - (has("KeyA", "ArrowLeft") ? 1 : 0);
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
