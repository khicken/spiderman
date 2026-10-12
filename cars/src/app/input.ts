import type { Controls, Device, Input, Press } from "./contracts";

type Act = "gas" | "brake" | "left" | "right" | "hand" | "up" | "down" | Press;

const KEYS: Record<string, Act> = {
  KeyW: "gas", ArrowUp: "gas", KeyS: "brake", ArrowDown: "brake", KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
  Space: "hand", KeyE: "up", ShiftLeft: "up", ShiftRight: "up", KeyQ: "down", ControlLeft: "down", ControlRight: "down",
  KeyC: "camera", KeyR: "rewind", Backspace: "reset", Escape: "pause", KeyP: "pause", KeyH: "horn", KeyB: "lookBack", KeyF: "photo",
};
// Standard gamepad mapping: A, B, X, Y, LB, RB, Start.
const PAD: [number, Act][] = [[0, "hand"], [1, "up"], [2, "down"], [3, "rewind"], [4, "lookBack"], [5, "camera"], [9, "pause"]];
const PRESSES: Press[] = ["camera", "rewind", "reset", "pause", "horn", "lookBack", "photo"];
const DZ = 0.1;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
function stick(v: number, dz: number) {
  const a = Math.abs(v);
  if (a < dz) return 0;
  const t = (a - dz) / (1 - dz);
  return Math.sign(v) * (0.45 * t + 0.55 * t * t);
}

// Key steering ramp: slower and shorter at speed, quick return to center.
export function keySteerStep(cur: number, want: number, dt: number, v: number): number {
  const goal = want * (1 - 0.3 * clamp(v / 70, 0, 1));
  const back = goal === 0 || Math.sign(goal) !== Math.sign(cur);
  const rate = back ? 7 : 4.2 - 2.6 * clamp(v / 60, 0, 1);
  return cur + clamp(goal - cur, -rate * dt, rate * dt);
}

export function createInput(canvas: HTMLCanvasElement): Input {
  const keys = new Set<Act>();
  const pad = new Set<Act>();
  const touchHeld = new Set<Press>();
  const pending = new Set<Act>();
  const now = new Set<Act>();
  const padPrev = new Uint8Array(17);
  const c: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, shiftUp: false, shiftDown: false };
  const touch = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  const lookV = { x: 0, y: 0 };
  let device: Device = "keys";
  let keySteer = 0;
  let keyGas = 0;
  let keyBrake = 0;
  let padSteer = 0;
  let padGas = 0;
  let padBrake = 0;
  let padLookX = 0;
  let padLookY = 0;
  let padIndex = -1;
  let drag = false;
  let dragX = 0;
  let dragY = 0;

  const typing = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  };
  const onDown = (e: KeyboardEvent) => {
    const a = KEYS[e.code];
    if (!a || typing(e)) return;
    e.preventDefault();
    device = "keys";
    if (e.repeat) return;
    if (!keys.has(a)) pending.add(a);
    keys.add(a);
  };
  const onUp = (e: KeyboardEvent) => {
    const a = KEYS[e.code];
    if (a) keys.delete(a);
  };
  const onBlur = () => {
    keys.clear();
    drag = false;
    dragX = dragY = 0;
  };
  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    drag = true;
    dragX = dragY = 0;
  };
  const onMouseUp = () => {
    drag = false;
    dragX = dragY = 0;
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!drag) return;
    dragX = clamp(dragX + e.movementX / 250, -1, 1);
    dragY = clamp(dragY + e.movementY / 250, -1, 1);
  };
  const noMenu = (e: Event) => e.preventDefault();

  window.addEventListener("keydown", onDown);
  window.addEventListener("keyup", onUp);
  window.addEventListener("blur", onBlur);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("contextmenu", noMenu);

  function pollPad() {
    const list = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    let gp: Gamepad | null = null;
    for (const g of list) if (g && g.connected && (g.mapping === "standard" || !gp)) gp = g;
    pad.clear();
    if (!gp) {
      padIndex = -1;
      padSteer = padGas = padBrake = padLookX = padLookY = 0;
      return;
    }
    padIndex = gp.index;
    const b = gp.buttons;
    const v = (i: number) => (b[i] ? b[i].value : 0);
    padGas = v(7);
    padBrake = v(6);
    padSteer = stick(gp.axes[0] ?? 0, DZ);
    padLookX = stick(gp.axes[2] ?? 0, 0.15);
    padLookY = stick(gp.axes[3] ?? 0, 0.15);
    let active = padGas > 0.1 || padBrake > 0.1 || padSteer !== 0 || padLookX !== 0 || padLookY !== 0;
    for (const [i, a] of PAD) {
      const on = v(i) > 0.5 ? 1 : 0;
      if (on) {
        pad.add(a);
        active = true;
        if (!padPrev[i]) pending.add(a);
      }
      padPrev[i] = on;
    }
    if (active) device = "pad";
  }

  return {
    read(dt, speed) {
      pollPad();
      now.clear();
      for (const a of pending) now.add(a);
      pending.clear();
      const v = Math.abs(speed);
      keySteer = keySteerStep(keySteer, (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0), dt, v);
      keyGas += clamp((keys.has("gas") ? 1 : 0) - keyGas, -dt * 10, dt * 7);
      keyBrake += clamp((keys.has("brake") ? 1 : 0) - keyBrake, -dt * 10, dt * 8);
      c.throttle = Math.max(keyGas, padGas, touch.throttle);
      c.brake = Math.max(keyBrake, padBrake, touch.brake);
      c.steer = padSteer !== 0 ? padSteer : touch.steer !== 0 ? touch.steer : keySteer;
      c.handbrake = keys.has("hand") || pad.has("hand") ? 1 : touch.handbrake;
      c.shiftUp = now.has("up");
      c.shiftDown = now.has("down");
      return c;
    },
    pressed: (p) => now.has(p),
    held: (p) => keys.has(p) || pad.has(p) || touchHeld.has(p),
    look() {
      lookV.x = padLookX !== 0 || padLookY !== 0 ? padLookX : dragX;
      lookV.y = padLookX !== 0 || padLookY !== 0 ? padLookY : dragY;
      return lookV;
    },
    get device() {
      return device;
    },
    setTouch(t) {
      device = "touch";
      if (t.throttle !== undefined) touch.throttle = t.throttle;
      if (t.brake !== undefined) touch.brake = t.brake;
      if (t.steer !== undefined) touch.steer = t.steer;
      if (t.handbrake !== undefined) touch.handbrake = t.handbrake;
      if (t.shiftUp) pending.add("up");
      if (t.shiftDown) pending.add("down");
      if (t.held)
        for (const p of PRESSES) {
          const on = t.held[p];
          if (on === undefined) continue;
          if (on && !touchHeld.has(p)) pending.add(p);
          if (on) touchHeld.add(p);
          else touchHeld.delete(p);
        }
    },
    rumble(strong, weak, ms) {
      if (padIndex < 0 || device !== "pad") return;
      const gp = navigator.getGamepads()[padIndex] as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null;
      gp?.vibrationActuator?.playEffect?.("dual-rumble", { duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) })?.catch(() => {});
    },
    dispose() {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("contextmenu", noMenu);
    },
  };
}
