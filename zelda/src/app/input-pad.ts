import type { BtnName } from "./contracts";
import { BTN_NAMES } from "./state";

// Standard-mapping gamepad: radial deadzones, curved right stick, trigger thresholds, B tap/hold split, menu nav
// with key repeat, dual-rumble.

export type NavDir = "up" | "down" | "left" | "right" | "ok" | "back";

export interface PadOut {
  connected: boolean;
  active: boolean; // any stick or button beyond its deadzone this poll
  moveX: number;
  moveY: number; // y = +1 forward
  lookX: number; // -1..1 after deadzone and curve (rate, scaled by the caller)
  lookY: number;
  down: Record<BtnName, boolean>;
  latch: Record<BtnName, boolean>; // rising edges not yet consumed
}

export interface Pad {
  readonly out: PadOut;
  poll(dt: number, menu: boolean): void;
  rumble(strength: number, seconds: number): void;
  dispose(): void;
}

const DZ_MOVE = 0.18;
const DZ_LOOK = 0.14;
const TRIGGER = 0.4;
const TAP_S = 0.2;
const NAV_FIRST = 0.4;
const NAV_REPEAT = 0.12;

const MAP: readonly [number, BtnName][] = [
  [0, "jump"], [2, "attack"], [6, "block"], [7, "bow"], [5, "lock"], [3, "use"], [8, "map"], [9, "pause"],
];

function radial(x: number, y: number, dz: number, curve: number, o: { x: number; y: number }) {
  const m = Math.hypot(x, y);
  if (m < dz) {
    o.x = o.y = 0;
    return;
  }
  const t = Math.min(1, (m - dz) / (1 - dz));
  const k = Math.pow(t, curve) / m;
  o.x = x * k;
  o.y = y * k;
}

export function createPad(nav: (d: NavDir) => void): Pad {
  const down = {} as Record<BtnName, boolean>;
  const latch = {} as Record<BtnName, boolean>;
  for (const b of BTN_NAMES) down[b] = latch[b] = false;
  const out: PadOut = { connected: false, active: false, moveX: 0, moveY: 0, lookX: 0, lookY: 0, down, latch };
  const prev = new Array<boolean>(20).fill(false);
  const tmp = { x: 0, y: 0 };
  let bHeld = 0;
  let navDir = "";
  let navT = 0;

  const getPad = (): Gamepad | null => {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return null;
    const list = navigator.getGamepads();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p && p.connected && p.buttons.length >= 10) return p;
    }
    return null;
  };
  const btnDown = (p: Gamepad, i: number, thr: number) => {
    const b = p.buttons[i];
    return !!b && (b.pressed || b.value > thr);
  };

  return {
    out,
    poll(dt, menu) {
      const p = getPad();
      if (!p) {
        if (out.connected) {
          out.connected = out.active = false;
          out.moveX = out.moveY = out.lookX = out.lookY = 0;
          for (const b of BTN_NAMES) down[b] = false;
          prev.fill(false);
        }
        return;
      }
      out.connected = true;
      let active = false;
      radial(p.axes[0] ?? 0, p.axes[1] ?? 0, DZ_MOVE, 1, tmp);
      out.moveX = tmp.x;
      out.moveY = -tmp.y;
      if (tmp.x !== 0 || tmp.y !== 0) active = true;
      radial(p.axes[2] ?? 0, p.axes[3] ?? 0, DZ_LOOK, 1.7, tmp);
      out.lookX = tmp.x;
      out.lookY = tmp.y;
      if (tmp.x !== 0 || tmp.y !== 0) active = true;

      for (const [i, name] of MAP) {
        const d = btnDown(p, i, i === 6 || i === 7 ? TRIGGER : 0.5);
        if (d && !prev[i]) {
          latch[name] = true;
          active = true;
        }
        down[name] = d;
        prev[i] = d;
      }
      // B: held = sprint at once, a short tap = dodge roll on release.
      const b = btnDown(p, 1, 0.5);
      const l3 = btnDown(p, 10, 0.5);
      const bEdge = b && !prev[1];
      if (bEdge) active = true;
      if (b) bHeld += dt;
      else {
        if (prev[1] && bHeld < TAP_S) latch.dodge = true;
        bHeld = 0;
      }
      prev[1] = b;
      if (l3 && !prev[10]) active = true;
      prev[10] = l3;
      down.sprint = b || l3;
      down.dodge = false;
      out.active = active;

      // Menu navigation: d-pad and left stick, with repeat. A = ok, B or Start = back (only while menus own input).
      let dir = "";
      if (btnDown(p, 12, 0.5) || (p.axes[1] ?? 0) < -0.6) dir = "up";
      else if (btnDown(p, 13, 0.5) || (p.axes[1] ?? 0) > 0.6) dir = "down";
      else if (btnDown(p, 14, 0.5) || (p.axes[0] ?? 0) < -0.6) dir = "left";
      else if (btnDown(p, 15, 0.5) || (p.axes[0] ?? 0) > 0.6) dir = "right";
      if (dir) {
        if (dir !== navDir) {
          navDir = dir;
          navT = NAV_FIRST;
          nav(dir as NavDir);
        } else {
          navT -= dt;
          if (navT <= 0) {
            navT = NAV_REPEAT;
            nav(dir as NavDir);
          }
        }
      } else navDir = "";
      if (menu) {
        if (latch.jump) nav("ok");
        if (latch.pause || bEdge) nav("back");
      }
    },
    rumble(strength, seconds) {
      const p = getPad() as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | null;
      const act = p?.vibrationActuator;
      if (!act?.playEffect) return;
      try {
        void act
          .playEffect("dual-rumble", { startDelay: 0, duration: Math.round(seconds * 1000), strongMagnitude: Math.min(1, strength), weakMagnitude: Math.min(1, strength * 0.6) })
          .catch(() => {});
      } catch { /* some browsers throw on a stale actuator */ }
    },
    dispose() {
      navDir = "";
    },
  };
}
