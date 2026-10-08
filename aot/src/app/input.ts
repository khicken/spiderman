import * as THREE from "three";
import type { Action, Input } from "./contracts";

const KEYS: Record<string, Action> = {
  Space: "jump",
  ShiftLeft: "boost",
  ShiftRight: "boost",
  KeyE: "slash",
  KeyF: "slash",
  KeyQ: "lock",
  KeyR: "reload",
};
const BUTTONS: Record<number, Action> = { 0: "hookL", 2: "hookR" };
const MOVE = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);

export function createInput(canvas: HTMLCanvasElement, onSystem: (code: string) => void) {
  const held = new Set<Action>();
  const pressed = new Set<Action>();
  const released = new Set<Action>();
  const codes = new Set<string>();
  let enabled = false;
  let dx = 0;
  let dy = 0;
  let lastMouse = 0;

  const state: Input = { wish: new THREE.Vector3(), look: new THREE.Vector3(0, 0, 1), camPos: new THREE.Vector3(), held, pressed, released };

  const down = (a: Action) => {
    if (held.has(a)) return;
    held.add(a);
    pressed.add(a);
  };
  const up = (a: Action) => {
    if (!held.delete(a)) return;
    released.add(a);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!enabled) return;
    const a = KEYS[e.code];
    if (a || MOVE.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (a || MOVE.has(e.code)) codes.add(e.code);
    if (a) down(a);
    else if (!MOVE.has(e.code)) onSystem(e.code);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    codes.delete(e.code);
    const a = KEYS[e.code];
    if (a && !Object.entries(KEYS).some(([k, v]) => v === a && codes.has(k))) up(a);
  };
  const onMouseDown = (e: MouseEvent) => {
    const a = BUTTONS[e.button];
    if (enabled && a) down(a);
  };
  const onMouseUp = (e: MouseEvent) => {
    const a = BUTTONS[e.button];
    if (a) up(a);
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
