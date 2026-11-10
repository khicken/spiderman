import type {
  Btn, BtnName, Device, GameEvent, Input, InputBuffer, InputFrame, PadStyle, SimView, Stick,
} from "./contracts";
import { padLabel, padStyleOf } from "./input-glyphs";
import { newInputFrame } from "./state";

// Keyboard + Gamepad API -> one reused InputFrame per rendered frame. Owner: input-camera.
// Physical inputs (keys, pad buttons) keep their own edge queues, so a tap that starts and ends between two frames
// still reports pressed + released, and `held` is measured from event timestamps (shot meter timing).
// Several semantic buttons share one physical button (pad X = shoot + steal); sim picks by context.
// Keyboard pro-stick (v2 feel): hold Space and tap a WASD direction for a dribble move, so the left hand runs moves
// while the right hand stays on J/K/L/I to chain a move into a shot or pass. Arrows still work. Space = hands up on D.

export type NavDir = "up" | "down" | "left" | "right" | "ok" | "back" | "tabLeft" | "tabRight" | "start";
/** The nav callback also receives the source device as a second argument. */
export type NavListener = (dir: NavDir, src: Device) => void;

const BUFFER_WIN = 0.12;

// ---- physical inputs -------------------------------------------------------------------------------------------------
// Keys 0..31, pad buttons PAD + index.
const KEY_CODES = [
  "KeyJ", "KeyK", "KeyL", "KeyI", "KeyE", "KeyR", "KeyQ", "KeyF", "Escape", "KeyC",
  "Digit1", "Digit2", "Digit3", "Digit4", "Numpad1", "Numpad2", "Numpad3", "Numpad4",
] as const;
const K: Record<string, number> = {};
KEY_CODES.forEach((c, i) => (K[c] = i));
const PAD = 32;
const NPHYS = PAD + 18;
const MOVE_KEYS: Record<string, 0 | 1 | 2 | 3> = { KeyW: 0, KeyS: 1, KeyA: 2, KeyD: 3 };
const ARROWS: Record<string, 0 | 1 | 2 | 3> = { ArrowUp: 0, ArrowDown: 1, ArrowLeft: 2, ArrowRight: 3 };
const SHIFT = new Set(["ShiftLeft", "ShiftRight"]);

const BINDS: Record<BtnName, number[]> = {
  shoot: [K.KeyJ, PAD + 2],
  pass: [K.KeyK, PAD + 0],
  bounce: [K.KeyL, PAD + 1],
  lob: [K.KeyI, PAD + 3],
  screen: [K.KeyE, PAD + 4],
  icon: [K.KeyR, PAD + 5],
  post: [K.KeyQ, PAD + 6],
  steal: [K.KeyL, PAD + 2],
  block: [K.KeyJ, PAD + 3],
  switchP: [K.KeyK, PAD + 0],
  charge: [K.KeyF, PAD + 1],
  intense: [K.KeyQ, PAD + 6],
  pause: [K.Escape, PAD + 9],
  camera: [K.KeyC, PAD + 8],
};
const NAMES = Object.keys(BINDS) as BtnName[];
// While `icon` is held, these physical buttons pick a teammate (index = icon slot) instead of their normal meaning.
const ICON_PHYS: [number, number][] = [
  [PAD + 0, 0], [PAD + 1, 1], [PAD + 2, 2], [PAD + 3, 3], [K.KeyK, 0], [K.KeyL, 1], [K.KeyJ, 2], [K.KeyI, 3],
];
const DIGITS: [number, number][] = [
  [K.Digit1, 0], [K.Digit2, 1], [K.Digit3, 2], [K.Digit4, 3], [K.Numpad1, 0], [K.Numpad2, 1], [K.Numpad3, 2], [K.Numpad4, 3],
];

// ---- sticks ----------------------------------------------------------------------------------------------------------
const MOVE_DZ = 0.14; // radial inner deadzone (worn sticks rest at ~0.08..0.12)
const LOOK_DZ = 0.2;
const OUTER = 0.94; // most sticks never reach 1.0 on diagonals
const FLICK_ON = 0.72;
const FLICK_OFF = 0.38;
const NAV_ON = 0.55;
const NAV_OFF = 0.35;
const NAV_DELAY = 0.36;
const NAV_REPEAT = 0.085;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Radial deadzone with rescale and a mild response curve. Writes into `s`. y is up-positive. */
function radial(s: Stick, x: number, y: number, dz: number, curve: number) {
  const m = Math.hypot(x, y);
  if (m < dz) {
    s.x = s.y = s.mag = 0;
    return;
  }
  const t = clamp((m - dz) / (OUTER - dz), 0, 1);
  const mag = Math.pow(t, curve);
  s.x = (x / m) * mag;
  s.y = (y / m) * mag;
  s.mag = mag;
}

type VibrPad = Gamepad & {
  vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown>; reset?: () => Promise<unknown> } | null;
  hapticActuators?: readonly { pulse?: (v: number, ms: number) => Promise<unknown> }[];
};

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA") return true;
  if (el.tagName !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return type !== "range" && type !== "checkbox" && type !== "radio" && type !== "button" && type !== "submit";
};
// Elements the browser itself activates on Enter / Space: keyboard "ok" is left to the browser on those.
const nativeActivates = (el: Element | null) =>
  !!el && /^(BUTTON|A|SUMMARY|SELECT|INPUT|TEXTAREA)$/.test(el.tagName);
const arrowWidget = (el: Element | null) =>
  !!el && (el.tagName === "SELECT" || (el.tagName === "INPUT" && (el as HTMLInputElement).type === "range"));

export function createInput(target: HTMLElement): Input {
  const f: InputFrame = newInputFrame();
  const btns: Record<BtnName, Btn> = {
    shoot: f.shoot, pass: f.pass, bounce: f.bounce, lob: f.lob, screen: f.screen, icon: f.icon, post: f.post,
    steal: f.steal, block: f.block, switchP: f.switchP, charge: f.charge, intense: f.intense, pause: f.pause, camera: f.camera,
  };

  // physical state
  const down = new Uint8Array(NPHYS);
  const tapP = new Uint8Array(NPHYS);
  const tapR = new Uint8Array(NPHYS);
  const masked = new Uint8Array(NPHYS);
  const pressAt = new Float64Array(NPHYS);
  const releaseAt = new Float64Array(NPHYS);
  // semantic press time + buffer
  const btnPressAt: Record<string, number> = {};
  const lastPress: Record<string, number> = {};
  const taken: Record<string, boolean> = {};
  for (const n of NAMES) {
    btnPressAt[n] = 0;
    lastPress[n] = -1e9;
    taken[n] = true;
  }

  const moveKeys = new Uint8Array(4);
  const arrowKeys = new Uint8Array(4);
  let shift = false;
  let space = false;
  let flickQueued = false;
  let flickQX = 0;
  let flickQY = 0;

  let device: Device = "keys";
  let padStyle: PadStyle = "generic";
  let padName: string | null = null;
  let activePad = -1;
  let vibration = true;
  let lastRumble = 0;
  let disposed = false;

  // pad scratch (merged across pads)
  const padVal = new Float32Array(18);
  const padPrevOn = new Uint8Array(18);
  const lAxis = { x: 0, y: 0 };
  const rAxis = { x: 0, y: 0 };
  const padMove: Stick = { x: 0, y: 0, mag: 0 };
  const padLook: Stick = { x: 0, y: 0, mag: 0 };
  let rLatched = false;
  const lastActivity = new Float64Array(8);

  // nav
  const navListeners = new Set<NavListener>();
  const navQueue: NavDir[] = [];
  const navSrc: Device[] = [];
  let navHeld: NavDir | null = null;
  let navTimer = 0;
  let navStickLatched = false;

  const queueNav = (d: NavDir, src: Device) => {
    if (navQueue.length < 16) {
      navQueue.push(d);
      navSrc.push(src);
    }
  };

  const physDown = (i: number, at: number) => {
    if (down[i]) return;
    down[i] = 1;
    tapP[i] = 1;
    pressAt[i] = at;
  };
  const physUp = (i: number, at: number) => {
    if (!down[i]) return;
    down[i] = 0;
    tapR[i] = 1;
    releaseAt[i] = at;
  };

  // ---- keyboard ----------------------------------------------------------------------------------------------------
  const onKeyDown = (e: KeyboardEvent) => {
    if (disposed) return;
    const code = e.code;
    if (typing(e.target)) {
      if (code === "Escape" && !e.repeat) queueNav("back", "keys");
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    device = "keys";
    const active = typeof document !== "undefined" ? document.activeElement : null;
    // menu nav (keyboard repeat drives auto-repeat)
    const ar = ARROWS[code];
    if (ar !== undefined || MOVE_KEYS[code] !== undefined) {
      const d = ar ?? MOVE_KEYS[code];
      queueNav(d === 0 ? "up" : d === 1 ? "down" : d === 2 ? "left" : "right", "keys");
    } else if (!e.repeat) {
      if ((code === "Enter" || code === "NumpadEnter" || code === "Space") && !nativeActivates(active)) queueNav("ok", "keys");
      else if (code === "Escape" || code === "Backspace") queueNav("back", "keys");
      else if (code === "KeyQ" || code === "PageUp") queueNav("tabLeft", "keys");
      else if (code === "KeyE" || code === "PageDown") queueNav("tabRight", "keys");
    }
    if (ar !== undefined || code === "Space") {
      // no page scroll; range/select get their arrows from the nav helper instead of natively (no double steps)
      if (ar !== undefined || !nativeActivates(active)) e.preventDefault();
    } else if (arrowWidget(active) && (code === "Home" || code === "End")) e.preventDefault();
    if (e.repeat) return;
    const at = e.timeStamp || performance.now();
    const k = K[code];
    if (k !== undefined) {
      physDown(k, at);
      if (code !== "Escape") e.preventDefault();
      return;
    }
    const m = MOVE_KEYS[code];
    if (m !== undefined) {
      moveKeys[m] = 1;
      if (space) spaceFlick(m);
      return;
    }
    if (code === "Space") {
      space = true;
      // Space pressed while a direction is already held: move in that direction right away
      const hx = moveKeys[3] - moveKeys[2];
      const hy = moveKeys[0] - moveKeys[1];
      if (hx !== 0 || hy !== 0) {
        flickQueued = true;
        flickQX = hx;
        flickQY = hy;
      }
      return;
    }
    if (ar !== undefined) {
      arrowKeys[ar] = 1;
      flickQueued = true;
      flickQX = arrowKeys[3] - arrowKeys[2];
      flickQY = arrowKeys[0] - arrowKeys[1];
      return;
    }
    if (SHIFT.has(code)) shift = true;
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const code = e.code;
    const at = e.timeStamp || performance.now();
    const k = K[code];
    if (k !== undefined) physUp(k, at);
    const m = MOVE_KEYS[code];
    if (m !== undefined) moveKeys[m] = 0;
    const ar = ARROWS[code];
    if (ar !== undefined) arrowKeys[ar] = 0;
    if (SHIFT.has(code)) shift = false;
    if (code === "Space") space = false;
  };
  /** Space + WASD tap: flick toward the tapped key, plus a held key on the other axis (S held + A = back-left). */
  const spaceFlick = (m: 0 | 1 | 2 | 3) => {
    flickQueued = true;
    if (m === 2 || m === 3) {
      flickQX = m === 3 ? 1 : -1;
      flickQY = moveKeys[0] - moveKeys[1];
    } else {
      flickQX = moveKeys[3] - moveKeys[2];
      flickQY = m === 0 ? 1 : -1;
    }
  };
  const releaseAll = () => {
    const at = performance.now();
    for (let i = 0; i < PAD; i++) physUp(i, at);
    moveKeys.fill(0);
    arrowKeys.fill(0);
    shift = false;
    space = false;
  };
  const onBlur = () => releaseAll();
  const onVis = () => {
    if (document.visibilityState !== "visible") releaseAll();
  };
  const onPointer = () => {
    device = "keys";
  };
  const noMenu = (e: Event) => e.preventDefault();
  const onPadConn = (e: GamepadEvent) => {
    device = "pad";
    padName = padLabel(e.gamepad.id);
    padStyle = padStyleOf(e.gamepad.id);
    activePad = e.gamepad.index;
  };
  const onPadDisc = (e: GamepadEvent) => {
    if (e.gamepad.index === activePad) activePad = -1;
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("pointerdown", onPointer);
  window.addEventListener("gamepadconnected", onPadConn);
  window.addEventListener("gamepaddisconnected", onPadDisc);
  target.addEventListener("contextmenu", noMenu);

  // ---- gamepads ----------------------------------------------------------------------------------------------------
  function pollPads(now: number) {
    padVal.fill(0);
    lAxis.x = lAxis.y = rAxis.x = rAxis.y = 0;
    let any = false;
    let best = -1;
    let bestAt = -1;
    let names: string | null = null;
    const list = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : null;
    if (list) {
      for (let p = 0; p < list.length; p++) {
        const gp = list[p];
        if (!gp || !gp.connected || gp.buttons.length < 4) continue;
        any = true;
        const b = gp.buttons;
        const ax = gp.axes;
        let act = false;
        for (let i = 0; i < 18 && i < b.length; i++) {
          const v = b[i].value || (b[i].pressed ? 1 : 0);
          if (v > padVal[i]) padVal[i] = v;
          if (v > 0.5) act = true;
        }
        const lx = ax[0] ?? 0;
        const ly = -(ax[1] ?? 0);
        const rx = ax[2] ?? 0;
        const ry = -(ax[3] ?? 0);
        if (lx * lx + ly * ly > lAxis.x * lAxis.x + lAxis.y * lAxis.y) {
          lAxis.x = lx;
          lAxis.y = ly;
        }
        if (rx * rx + ry * ry > rAxis.x * rAxis.x + rAxis.y * rAxis.y) {
          rAxis.x = rx;
          rAxis.y = ry;
        }
        if (lx * lx + ly * ly > 0.2 || rx * rx + ry * ry > 0.2) act = true;
        if (p < lastActivity.length && act) lastActivity[p] = now;
        const la = p < lastActivity.length ? lastActivity[p] : 0;
        if (la > bestAt || best < 0) {
          best = p;
          bestAt = la;
          names = gp.id;
        }
        if (act) device = "pad";
      }
    }
    if (!any) {
      activePad = -1;
      padName = null;
      padStyle = "generic";
    } else if (best !== activePad || padName === null) {
      activePad = best;
      padName = names ? padLabel(names) : "Controller";
      padStyle = padStyleOf(names);
    }
    // buttons -> physical edges (triggers get hysteresis)
    for (let i = 0; i < 18; i++) {
      const v = padVal[i];
      const trig = i === 6 || i === 7;
      const on = padPrevOn[i] ? v > (trig ? 0.25 : 0.35) : v > (trig ? 0.4 : 0.5);
      padPrevOn[i] = on ? 1 : 0;
      if (i < 10) {
        if (on) physDown(PAD + i, now);
        else physUp(PAD + i, now);
      }
    }
    radial(padMove, lAxis.x, lAxis.y, MOVE_DZ, 1.15);
    radial(padLook, rAxis.x, rAxis.y, LOOK_DZ, 1);
  }

  // ---- nav from pad ------------------------------------------------------------------------------------------------
  function padNav(dt: number) {
    // edges for ok/back/tabs/start come from the physical press flags
    if (tapP[PAD + 0]) queueNav("ok", "pad");
    if (tapP[PAD + 1]) queueNav("back", "pad");
    if (tapP[PAD + 4]) queueNav("tabLeft", "pad");
    if (tapP[PAD + 5]) queueNav("tabRight", "pad");
    if (tapP[PAD + 9]) queueNav("start", "pad");
    let d: NavDir | null = null;
    if (padVal[12] > 0.5) d = "up";
    else if (padVal[13] > 0.5) d = "down";
    else if (padVal[14] > 0.5) d = "left";
    else if (padVal[15] > 0.5) d = "right";
    else {
      const m = Math.hypot(lAxis.x, lAxis.y);
      const on = navStickLatched ? m > NAV_OFF : m > NAV_ON;
      navStickLatched = on;
      if (on) d = Math.abs(lAxis.x) > Math.abs(lAxis.y) ? (lAxis.x > 0 ? "right" : "left") : lAxis.y > 0 ? "up" : "down";
    }
    if (d === null) {
      navHeld = null;
      return;
    }
    device = "pad";
    if (d !== navHeld) {
      navHeld = d;
      navTimer = NAV_DELAY;
      queueNav(d, "pad");
      return;
    }
    navTimer -= dt;
    if (navTimer <= 0) {
      navTimer += NAV_REPEAT;
      if (navTimer < 0) navTimer = NAV_REPEAT;
      queueNav(d, "pad");
    }
  }

  // ---- buffer ------------------------------------------------------------------------------------------------------
  let nowMs = performance.now();
  const buffer: InputBuffer = {
    has(name, win = BUFFER_WIN) {
      return !taken[name] && (nowMs - lastPress[name]) / 1000 <= win;
    },
    take(name, win = BUFFER_WIN) {
      if (taken[name] || (nowMs - lastPress[name]) / 1000 > win) return false;
      taken[name] = true;
      return true;
    },
    clear(name) {
      if (name) taken[name] = true;
      else for (const n of NAMES) taken[n] = true;
    },
  };
  f.buffer = buffer;

  function read(dt: number): InputFrame {
    nowMs = performance.now();
    pollPads(nowMs);
    padNav(dt);

    // icon picks: mask the physical button for its whole press so it never also shoots / passes
    f.iconPick = -1;
    const iconHeld = (down[K.KeyR] || down[PAD + 5]) && !masked[K.KeyR] && !masked[PAD + 5];
    for (const [i, slot] of ICON_PHYS) {
      if (tapP[i] && iconHeld) {
        masked[i] = 1;
        f.iconPick = slot;
      }
    }
    for (const [i, slot] of DIGITS) if (tapP[i]) f.iconPick = slot;

    let anyPress = false;
    for (let i = 0; i < NPHYS; i++) if (tapP[i]) anyPress = true;

    for (const n of NAMES) {
      const b = btns[n];
      const ids = BINDS[n];
      let nd = false;
      let tp = false;
      let tr = false;
      let pAt = Infinity;
      let rAt = 0;
      for (const i of ids) {
        if (masked[i]) continue;
        if (down[i]) nd = true;
        if (tapP[i]) {
          tp = true;
          if (pressAt[i] < pAt) pAt = pressAt[i];
        }
        if (tapR[i]) {
          tr = true;
          if (releaseAt[i] > rAt) rAt = releaseAt[i];
        }
      }
      const prev = b.down;
      let pressed: boolean;
      let released: boolean;
      if (!prev) {
        pressed = nd || tp;
        released = pressed && !nd;
      } else {
        released = !nd || tr;
        pressed = nd && tr && tp;
      }
      if (pressed) {
        btnPressAt[n] = pAt === Infinity ? nowMs : pAt;
        lastPress[n] = btnPressAt[n];
        taken[n] = false;
      }
      b.down = nd;
      b.pressed = pressed;
      b.released = released;
      if (nd) b.held = Math.max(0, (nowMs - btnPressAt[n]) / 1000);
      else if (released) b.held = Math.max(0, ((rAt || nowMs) - btnPressAt[n]) / 1000);
      else b.held = 0;
    }

    // masks end when the physical button is up
    for (let i = 0; i < NPHYS; i++) if (masked[i] && !down[i]) masked[i] = 0;
    tapP.fill(0);
    tapR.fill(0);

    // move: pad stick wins when deflected, else WASD (normalized diagonals)
    if (padMove.mag > 0) {
      f.move.x = padMove.x;
      f.move.y = padMove.y;
      f.move.mag = padMove.mag;
    } else {
      const kx = moveKeys[3] - moveKeys[2];
      const ky = moveKeys[0] - moveKeys[1];
      const m = Math.hypot(kx, ky);
      f.move.x = m > 0 ? kx / m : 0;
      f.move.y = m > 0 ? ky / m : 0;
      f.move.mag = m > 0 ? 1 : 0;
    }

    // right stick / arrows, flicks
    f.flick = false;
    const ax = arrowKeys[3] - arrowKeys[2];
    const ay = arrowKeys[0] - arrowKeys[1];
    if (padLook.mag > 0) {
      f.rstick.x = padLook.x;
      f.rstick.y = padLook.y;
      f.rstick.mag = padLook.mag;
    } else {
      const m = Math.hypot(ax, ay);
      f.rstick.x = m > 0 ? ax / m : 0;
      f.rstick.y = m > 0 ? ay / m : 0;
      f.rstick.mag = m > 0 ? 1 : 0;
    }
    const rm = Math.hypot(rAxis.x, rAxis.y);
    if (!rLatched && rm > FLICK_ON) {
      rLatched = true;
      f.flick = true;
      f.flickDir.x = rAxis.x / rm;
      f.flickDir.y = rAxis.y / rm;
      f.flickDir.mag = 1;
    } else if (rLatched && rm < FLICK_OFF) rLatched = false;
    if (flickQueued) {
      flickQueued = false;
      // the combo at the latest arrow press (Down held + Left tap = back-left), topped up by arrows still held
      const qx = flickQX !== 0 ? flickQX : ax;
      const qy = flickQY !== 0 ? flickQY : ay;
      const m = Math.hypot(qx, qy);
      if (m > 0) {
        f.flick = true;
        f.flickDir.x = qx / m;
        f.flickDir.y = qy / m;
        f.flickDir.mag = 1;
      }
    }
    if (!f.flick) f.flickDir.x = f.flickDir.y = f.flickDir.mag = 0;
    f.handsUp = rm > 0.5 || ax !== 0 || ay !== 0 || space;

    const rt = padVal[7];
    f.sprint = Math.max(shift ? 1 : 0, rt > 0.06 ? clamp((rt - 0.06) / 0.8, 0, 1) : 0);
    f.any = anyPress || f.flick;
    f.device = device;

    // nav last, so a listener that opens a menu sees a consistent frame
    if (navQueue.length) {
      for (let i = 0; i < navQueue.length; i++) {
        const d = navQueue[i];
        const s = navSrc[i];
        for (const cb of navListeners) {
          try {
            cb(d, s);
          } catch (err) {
            console.error("nav listener", err);
          }
        }
      }
      navQueue.length = 0;
      navSrc.length = 0;
    }
    return f;
  }

  function pulse(strong: number, weak: number, ms: number) {
    if (!vibration || activePad < 0 || typeof navigator === "undefined" || !navigator.getGamepads) return;
    const now = performance.now();
    // a weaker effect must not cut a strong one short
    if (now - lastRumble < 60 && strong + weak < 0.6) return;
    lastRumble = now;
    const gp = navigator.getGamepads()[activePad] as VibrPad | null;
    if (!gp) return;
    const s = clamp(strong, 0, 1);
    const w = clamp(weak, 0, 1);
    const d = clamp(ms, 10, 2000);
    try {
      const va = gp.vibrationActuator;
      if (va && va.playEffect) {
        va.playEffect("dual-rumble", { startDelay: 0, duration: d, strongMagnitude: s, weakMagnitude: w })?.catch(() => {});
        return;
      }
      const h = gp.hapticActuators?.[0];
      h?.pulse?.(Math.max(s, w), d)?.catch(() => {});
    } catch {
      /* unsupported */
    }
  }

  const rumbleFor = (e: GameEvent, view: SimView) => {
    const ut = view.userTeam;
    if (ut === -1) return;
    const us = view.userSlot;
    const mine = (slot: number) => slot >= 0 && slot < 10 && view.players[slot].team === ut;
    switch (e.type) {
      case "dunk":
        if (mine(e.slot)) pulse(1, 0.7, 280);
        else pulse(0.35, 0.25, 160);
        break;
      case "make":
        if (e.team === ut) pulse(e.points === 3 ? 0.35 : 0.2, 0.55, e.points === 3 ? 160 : 110);
        break;
      case "foul":
        if (e.by === us || e.on === us) pulse(0.65, 0.35, 220);
        else if (mine(e.by) || mine(e.on)) pulse(0.3, 0.2, 140);
        break;
      case "block":
        if (mine(e.by)) pulse(0.75, 0.45, 200);
        else if (e.on === us) pulse(0.55, 0.2, 160);
        break;
      case "steal":
        if (mine(e.by)) pulse(0.45, 0.6, 150);
        else if (e.from === us) pulse(0.5, 0.2, 140);
        break;
      case "ankleBreaker":
        if (e.by === us) pulse(0.55, 0.9, 320);
        else if (e.victim === us) pulse(0.85, 0.25, 380);
        break;
      case "meter":
        if (e.slot === us && e.grade === "perfect") pulse(0.1, 0.6, 70);
        break;
      case "bump":
        if ((e.a === us || e.b === us) && e.strength > 0.35) pulse(0.4 * e.strength, 0.15, 90);
        break;
      case "catch":
        if (e.slot === us) pulse(0, 0.22, 40);
        break;
      case "rim":
        if (view.ball.shot && view.ball.shot.team === ut) pulse(0.12 + 0.2 * e.strength, 0.1, 60);
        break;
      case "buzzer":
        if (e.kind !== "shotClock") pulse(0.35, 0.35, 420);
        break;
      case "gameEnd":
        if (e.winner === ut) pulse(0.5, 0.9, 650);
        break;
      default:
        break;
    }
  };

  const input: Input = {
    read,
    get device() {
      return device;
    },
    get padName() {
      return padName;
    },
    get padStyle() {
      return padStyle;
    },
    rumble(strong, weak, ms) {
      pulse(strong, weak, ms);
    },
    setVibration(on) {
      vibration = on;
      if (!on && activePad >= 0) {
        try {
          (navigator.getGamepads()[activePad] as VibrPad | null)?.vibrationActuator?.reset?.()?.catch(() => {});
        } catch {
          /* ignore */
        }
      }
    },
    handle(events, view) {
      for (const e of events) rumbleFor(e, view);
    },
    onNav(cb) {
      const l = cb as NavListener;
      navListeners.add(l);
      return () => {
        navListeners.delete(l);
      };
    },
    dispose() {
      disposed = true;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("gamepadconnected", onPadConn);
      window.removeEventListener("gamepaddisconnected", onPadDisc);
      target.removeEventListener("contextmenu", noMenu);
      navListeners.clear();
    },
  };
  return input;
}
