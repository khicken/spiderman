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
  KeyT: "trick",
  KeyR: "reset",
};
const BUTTONS: Record<number, Action> = { 2: "web" };
const MOVE = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);

// Standard gamepad layout. Button 2 (X) follows the LMB rule, 8 (View) opens the map, 9 (Start) pauses.
const PAD: (Action | null)[] = ["jump", "dodge", null, "strike", "web", "launch", "dive", "swing", null, null, "wings", "finisher", "gadget", "heal", "scan", "gadgetNext"];
const PAD_SRC = PAD.map((_, i) => `p${i}`);
const PAD_X = 2;
const PAD_VIEW = 8;
const PAD_START = 9;
const MOVE_DEAD = 0.22;
const LOOK_DEAD = 0.12;
const LOOK_YAW = 3.4;
const LOOK_PITCH = 2.2;
const BASE_SENS = 0.0022;

export const padMenu = { map: false };

const stick = (v: number, dead: number) => {
  const a = Math.abs(v);
  if (a < dead) return 0;
  const x = Math.min(1, (a - dead) / (1 - dead));
  return Math.sign(v) * (0.25 * x + 0.75 * x * x * x);
};

export function createInput(canvas: HTMLCanvasElement, onSystem: (code: string) => void) {
  const held = new Set<Action>();
  const pressed = new Set<Action>();
  const released = new Set<Action>();
  const since = new Map<Action, number>();
  const sources = new Map<Action, Set<string>>();
  const codes = new Set<string>();
  let enabled = false;
  let fight = false;
  let leftAction: Action = "swing";
  let padX: Action = "swing";
  const padPrev = new Uint8Array(PAD.length);
  let padT = performance.now();
  let padF = 0;
  let padR = 0;
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
    swingFromMouse: false,
    chain: true,
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
  const fromPointer = () => {
    for (const k of sources.get("swing") ?? []) if (k.startsWith("Shift")) return false;
    return true;
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
    if (a === "swing") state.swingFromMouse = false;
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
    if (e.button === 0) leftAction = fight ? "attack" : "swing";
    const a = e.button === 0 ? leftAction : BUTTONS[e.button];
    if (!enabled || !a) return;
    down(a, `m${e.button}`);
    if (a === "swing") state.swingFromMouse = fromPointer();
  };
  const onMouseUp = (e: MouseEvent) => {
    const a = e.button === 0 ? leftAction : BUTTONS[e.button];
    if (a) up(a, `m${e.button}`);
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!enabled) return;
    dx += e.movementX;
    dy += e.movementY;
    lastMouse = performance.now();
  };
  const noMenu = (e: Event) => e.preventDefault();
  const pad = (dt: number) => {
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : null;
    let gp: Gamepad | null = null;
    for (let i = 0; pads && i < pads.length && !gp; i++) {
      const g = pads[i];
      if (g && g.connected && g.mapping === "standard") gp = g;
    }
    if (!gp) return 0;
    for (let i = 0; i < PAD.length && i < gp.buttons.length; i++) {
      const b = gp.buttons[i];
      const on = b.pressed || b.value > 0.35 ? 1 : 0;
      if (on === padPrev[i]) continue;
      padPrev[i] = on;
      if (!on) {
        const a = i === PAD_X ? padX : PAD[i];
        if (a) up(a, PAD_SRC[i]);
        continue;
      }
      if (!enabled) continue;
      if (i === PAD_START || i === PAD_VIEW) {
        padMenu.map = i === PAD_VIEW;
        onSystem("Escape");
        continue;
      }
      if (i === PAD_X) padX = fight ? "attack" : "swing";
      const a = i === PAD_X ? padX : PAD[i];
      if (!a) continue;
      down(a, PAD_SRC[i]);
      if (a === "swing") state.swingFromMouse = fromPointer();
    }
    if (!enabled) return 0;
    const ax = gp.axes;
    const rx = stick(ax[2] ?? 0, LOOK_DEAD);
    const ry = stick(ax[3] ?? 0, LOOK_DEAD);
    if (rx || ry) {
      dx += (rx * LOOK_YAW * dt) / BASE_SENS;
      dy += (ry * LOOK_PITCH * dt) / BASE_SENS;
      lastMouse = performance.now();
    }
    const lx = ax[0] ?? 0;
    const ly = ax[1] ?? 0;
    const m = Math.hypot(lx, ly);
    if (m < MOVE_DEAD) return 0;
    padF = -ly / m;
    padR = lx / m;
    return 1;
  };
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
    set fight(on: boolean) {
      fight = on;
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
    release(a: Action) {
      held.delete(a);
      sources.delete(a);
    },
    aim(yaw: number, pitch: number, camPos: THREE.Vector3) {
      const now = performance.now();
      const stickOn = pad(Math.min(0.1, (now - padT) / 1000));
      padT = now;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const f = (codes.has("KeyW") ? 1 : 0) - (codes.has("KeyS") ? 1 : 0) + (stickOn ? padF : 0);
      const r = (codes.has("KeyD") ? 1 : 0) - (codes.has("KeyA") ? 1 : 0) + (stickOn ? padR : 0);
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
