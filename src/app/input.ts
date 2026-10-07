import * as THREE from "three";
import type { Action, Input } from "./contracts";

const KEYS: Record<string, Action> = {
  ShiftLeft: "swing",
  ShiftRight: "swing",
  Space: "jump",
  KeyE: "launch",
  KeyF: "strike",
  KeyQ: "dodge",
  KeyC: "wings",
  KeyZ: "dive",
  KeyG: "gadget",
  Tab: "gadgetNext",
  KeyH: "heal",
  KeyX: "finisher",
  KeyV: "scan",
};
const BUTTONS: Record<number, Action> = { 0: "attack", 2: "web" };
const MOVE = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);

export function createInput(canvas: HTMLCanvasElement, onSystem: (code: string) => void) {
  const held = new Set<Action>();
  const pressed = new Set<Action>();
  const released = new Set<Action>();
  const since = new Map<Action, number>();
  const sources = new Map<Action, Set<string>>();
  const codes = new Set<string>();
  let enabled = false;
  let dx = 0;
  let dy = 0;
  let lastMouse = 0;

  const state: Input = {
    wish: new THREE.Vector3(),
    look: new THREE.Vector3(0, 0, 1),
    camPos: new THREE.Vector3(),
    held,
    pressed,
    released,
    holdTime: (a) => (held.has(a) ? (performance.now() - (since.get(a) ?? 0)) / 1000 : 0),
  };

  const down = (a: Action, src: string) => {
    let s = sources.get(a);
    if (!s) sources.set(a, (s = new Set()));
    s.add(src);
    if (held.has(a)) return;
    held.add(a);
    pressed.add(a);
    since.set(a, performance.now());
  };
  const up = (a: Action, src: string) => {
    const s = sources.get(a);
    s?.delete(src);
    if (s?.size || !held.has(a)) return;
    held.delete(a);
    released.add(a);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!enabled) return;
    const a = KEYS[e.code];
    if (a || MOVE.has(e.code) || e.code === "Space") e.preventDefault();
    if (e.repeat) return;
    if (a) down(a, e.code);
    else if (MOVE.has(e.code)) codes.add(e.code);
    else onSystem(e.code);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const a = KEYS[e.code];
    if (a) up(a, e.code);
    codes.delete(e.code);
  };
  const onMouseDown = (e: MouseEvent) => {
    const a = BUTTONS[e.button];
    if (enabled && a) down(a, `m${e.button}`);
  };
  const onMouseUp = (e: MouseEvent) => {
    const a = BUTTONS[e.button];
    if (a) up(a, `m${e.button}`);
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!enabled) return;
    dx += e.movementX;
    dy += e.movementY;
    lastMouse = performance.now();
  };
  const noMenu = (e: Event) => e.preventDefault();
  const clear = () => {
    for (const a of held) released.add(a);
    held.clear();
    sources.clear();
    codes.clear();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("mousemove", onMouseMove);
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
    takeMouse(out: { x: number; y: number }) {
      out.x = dx;
      out.y = dy;
      dx = dy = 0;
      return out;
    },
    aim(yaw: number, pitch: number, camPos: THREE.Vector3) {
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const f = (codes.has("KeyW") ? 1 : 0) - (codes.has("KeyS") ? 1 : 0);
      const r = (codes.has("KeyD") ? 1 : 0) - (codes.has("KeyA") ? 1 : 0);
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
      window.removeEventListener("blur", clear);
      canvas.removeEventListener("contextmenu", noMenu);
    },
  };
}

export type Controls = ReturnType<typeof createInput>;
