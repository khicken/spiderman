import type { BtnName, CreateInput, Input, PlayerState, Settings } from "./contracts";
import { DEFAULT_SETTINGS } from "./contracts";
import { BTN_NAMES, newInputState } from "./state";
import { createPad } from "./input-pad";
import type { NavDir } from "./input-pad";
import { createTouch } from "./input-touch";
import type { TouchContext } from "./input-touch";

// Keyboard + mouse (pointer lock optional, drag-to-look fallback), gamepad, touch overlay. Every source raises
// press latches, so a tap shorter than one frame still produces pressed + released edges.

export type { TouchContext } from "./input-touch";

/** createInput plus the extras the integrator can call. `syncPlayer` relabels and shows touch buttons by context. */
export interface InputPlus extends Input {
  setContext(c: TouchContext | null): void;
  syncPlayer(p: PlayerState): void;
}

const KEYMAP: readonly (readonly [string, BtnName])[] = [
  ["Space", "jump"], ["KeyJ", "attack"], ["KeyK", "block"], ["KeyL", "dodge"], ["ControlLeft", "dodge"],
  ["ControlRight", "dodge"], ["ShiftLeft", "sprint"], ["ShiftRight", "sprint"], ["KeyF", "bow"], ["KeyG", "glide"],
  ["KeyQ", "lock"], ["Tab", "lock"], ["KeyE", "use"], ["KeyM", "map"], ["Escape", "pause"], ["KeyP", "pause"],
];
const MOVE_KEYS = { fwd: ["KeyW", "ArrowUp"], back: ["KeyS", "ArrowDown"], left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"] };
const NAV_KEYS: Record<string, NavDir> = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", KeyW: "up", KeyS: "down", KeyA: "left", KeyD: "right",
  Enter: "ok", Escape: "back",
};
const MOUSE_BTN: Record<number, BtnName> = { 0: "attack", 1: "bow", 2: "block" };

const MOUSE_LOCKED = 0.0022; // rad per px
const MOUSE_DRAG = 0.005;
const TOUCH_LOOK = 0.0055;
const PAD_LOOK_X = 2.7; // rad/s at full stick
const PAD_LOOK_Y = 1.7;
const SHIFT_TAP_S = 0.18;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const createInput = ((canvas: HTMLCanvasElement, container: HTMLElement): InputPlus => {
  const state = newInputState();
  const keyHeld = new Set<string>();
  const mouseHeld = {} as Record<BtnName, boolean>;
  const latch = {} as Record<BtnName, boolean>;
  const prevDown = {} as Record<BtnName, boolean>;
  for (const b of BTN_NAMES) mouseHeld[b] = latch[b] = prevDown[b] = false;
  const navs = new Set<(d: NavDir) => void>();
  const nav = (d: NavDir) => {
    for (const cb of navs) cb(d);
  };

  let enabled = true;
  let sens = DEFAULT_SETTINGS.lookSens;
  let invertY = false;
  let touchVisible = false;
  let touchShown = false;
  let lookX = 0, lookY = 0, wheel = 0;
  let dragging = false, lastX = 0, lastY = 0;
  let shiftDownAt = -1;
  let lockFailed = false;
  let selfExit = false;
  let lastTouchAt = -1e9;
  let disposed = false;

  const setDevice = (d: InputPlus["state"]["device"]) => {
    if (state.device !== d) state.device = d;
  };
  const recentTouch = () => performance.now() - lastTouchAt < 700;

  const touch = createTouch(
    container,
    () => {
      lastTouchAt = performance.now();
      setDevice("touch");
    },
    (ms) => {
      try { navigator.vibrate?.(ms); } catch { /* vibrate can throw without a user gesture */ }
    },
  );
  const pad = createPad(nav);

  const typing = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
  };
  const clearHeld = () => {
    keyHeld.clear();
    for (const b of BTN_NAMES) mouseHeld[b] = false;
    dragging = false;
    shiftDownAt = -1;
    touch.releaseAll();
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    if (typing(ev.target) || ev.metaKey) return;
    if (ev.ctrlKey && ev.code !== "ControlLeft" && ev.code !== "ControlRight") return;
    const nd = NAV_KEYS[ev.code];
    if (nd && !ev.repeat) nav(nd);
    else if (nd && ev.repeat && nd !== "ok" && nd !== "back") nav(nd);
    if (ev.code === "Space" && !ev.repeat && !enabled) nav("ok");
    if (ev.code === "Tab" || (enabled && (ev.code === "Space" || ev.code.startsWith("Arrow")))) ev.preventDefault();
    if (ev.repeat) return;
    keyHeld.add(ev.code);
    if (ev.code === "ShiftLeft" || ev.code === "ShiftRight") shiftDownAt = performance.now();
    setDevice("keys");
    for (const [code, b] of KEYMAP) if (code === ev.code) latch[b] = true;
  };
  const onKeyUp = (ev: KeyboardEvent) => {
    keyHeld.delete(ev.code);
    if ((ev.code === "ShiftLeft" || ev.code === "ShiftRight") && shiftDownAt >= 0) {
      if (performance.now() - shiftDownAt < SHIFT_TAP_S * 1000) latch.dodge = true;
      shiftDownAt = -1;
    }
  };

  const requestLock = () => {
    if (lockFailed || document.pointerLockElement === canvas || state.device === "touch") return;
    try {
      const c = canvas as HTMLCanvasElement & { requestPointerLock(o?: object): Promise<void> | void };
      const r = c.requestPointerLock({ unadjustedMovement: true });
      if (r && typeof r.catch === "function") {
        r.catch(() => {
          try {
            const r2 = canvas.requestPointerLock() as Promise<void> | void;
            if (r2 && typeof r2.catch === "function") r2.catch(() => { lockFailed = true; });
          } catch { lockFailed = true; }
        });
      }
    } catch { lockFailed = true; }
  };
  const onMouseDown = (ev: MouseEvent) => {
    if (!enabled || recentTouch()) return;
    setDevice("keys");
    if (ev.button === 1) ev.preventDefault();
    const b = MOUSE_BTN[ev.button];
    if (b) {
      mouseHeld[b] = true;
      latch[b] = true;
    }
    dragging = true;
    lastX = ev.clientX;
    lastY = ev.clientY;
    requestLock();
  };
  const onMouseUp = (ev: MouseEvent) => {
    const b = MOUSE_BTN[ev.button];
    if (b) mouseHeld[b] = false;
    if (ev.buttons === 0) dragging = false;
  };
  const onMouseMove = (ev: MouseEvent) => {
    if (!enabled || recentTouch()) return;
    if (document.pointerLockElement === canvas) {
      if (Math.abs(ev.movementX) > 250 || Math.abs(ev.movementY) > 250) return;
      lookX += ev.movementX * MOUSE_LOCKED * sens;
      lookY += ev.movementY * MOUSE_LOCKED * sens;
    } else if (dragging) {
      lookX += (ev.clientX - lastX) * MOUSE_DRAG * sens;
      lookY += (ev.clientY - lastY) * MOUSE_DRAG * sens;
      lastX = ev.clientX;
      lastY = ev.clientY;
    }
  };
  const onWheel = (ev: WheelEvent) => {
    if (!enabled) return;
    ev.preventDefault();
    wheel += ev.deltaY * 0.004;
  };
  const onContext = (ev: Event) => ev.preventDefault();
  const onLockChange = () => {
    const locked = document.pointerLockElement === canvas;
    if (!locked && state.pointerLocked && enabled && !selfExit) {
      latch.pause = true;
    }
    selfExit = false;
    state.pointerLocked = locked;
  };
  const onLockError = () => {
    lockFailed = true;
  };
  const onPointerDown = (ev: PointerEvent) => {
    if (ev.pointerType === "touch") {
      lastTouchAt = performance.now();
      if (touchVisible) setDevice("touch");
    }
  };

  const w = window;
  w.addEventListener("keydown", onKeyDown);
  w.addEventListener("keyup", onKeyUp);
  w.addEventListener("blur", clearHeld);
  w.addEventListener("mouseup", onMouseUp);
  w.addEventListener("mousemove", onMouseMove);
  w.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerlockchange", onLockChange);
  document.addEventListener("pointerlockerror", onLockError);
  document.addEventListener("visibilitychange", clearHeld);
  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContext);

  const exitLock = () => {
    if (document.pointerLockElement === canvas) {
      selfExit = true;
      try { document.exitPointerLock(); } catch { /* already gone */ }
    }
  };

  const keyAny = (codes: readonly string[]) => codes.some((c) => keyHeld.has(c));

  const input: InputPlus = {
    state,
    update(dt) {
      pad.poll(dt, !enabled);
      const po = pad.out;
      if (po.active) setDevice("pad");
      const wantShown = touchVisible && state.device === "touch";
      if (wantShown !== touchShown) {
        touchShown = wantShown;
        touch.setVisible(wantShown);
      }
      touch.update(dt);

      let mx = 0, my = 0;
      if (enabled) {
        if (keyAny(MOVE_KEYS.right)) mx += 1;
        if (keyAny(MOVE_KEYS.left)) mx -= 1;
        if (keyAny(MOVE_KEYS.fwd)) my += 1;
        if (keyAny(MOVE_KEYS.back)) my -= 1;
        mx += po.moveX + touch.moveX;
        my += po.moveY + touch.moveY;
        const m = Math.hypot(mx, my);
        if (m > 1) {
          mx /= m;
          my /= m;
        }
      }
      state.move.x = mx;
      state.move.y = my;

      let lx = 0, ly = 0, zm = 0;
      if (enabled) {
        lx = lookX + touch.lookDX * TOUCH_LOOK * sens + po.lookX * PAD_LOOK_X * sens * dt;
        ly = lookY + touch.lookDY * TOUCH_LOOK * sens + po.lookY * PAD_LOOK_Y * sens * dt;
        zm = wheel + touch.zoom;
      }
      lookX = lookY = wheel = 0;
      state.look.x = clamp(lx, -0.8, 0.8);
      state.look.y = clamp(invertY ? -ly : ly, -0.8, 0.8);
      state.zoom = clamp(zm, -4, 4);

      for (const b of BTN_NAMES) {
        let src = false;
        if (enabled) {
          src = mouseHeld[b] || po.down[b] || touch.down[b];
          if (touch.latch[b]) latch[b] = true;
          if (po.latch[b]) latch[b] = true;
        }
        po.latch[b] = false;
        touch.latch[b] = false;
        if (!enabled) latch[b] = false;
        const bs = state.btn[b];
        if (!src && enabled) for (const [code, nb] of KEYMAP) if (nb === b && keyHeld.has(code)) src = true;
        if (b === "sprint" && enabled && touch.sprint) src = true;
        const d = src || latch[b];
        bs.pressed = d && !prevDown[b];
        bs.released = !d && prevDown[b];
        bs.down = d;
        bs.held = d ? bs.held + dt : 0;
        prevDown[b] = d;
        latch[b] = false;
      }
      state.aim = state.btn.bow.down;
    },
    setTouchVisible(on) {
      touchVisible = on;
      if (on && state.device !== "pad") setDevice("touch");
      if (!on) {
        touchShown = false;
        touch.setVisible(false);
        if (state.device === "touch") setDevice("keys");
      }
    },
    setPrompt(label) {
      touch.setPrompt(label);
    },
    setSettings(s: Settings) {
      sens = clamp(s.lookSens, 0.25, 3);
      invertY = s.invertY;
      touch.setScale(s.touchScale);
    },
    setEnabled(on) {
      if (on === enabled) return;
      enabled = on;
      if (!on) {
        clearHeld();
        exitLock();
        lookX = lookY = wheel = 0;
      }
    },
    onNav(cb) {
      navs.add(cb);
      return () => {
        navs.delete(cb);
      };
    },
    rumble(strength, seconds) {
      if (state.device === "touch") {
        try { navigator.vibrate?.(Math.round(Math.min(0.5, seconds) * 1000 * clamp(strength, 0.3, 1))); } catch { /* no vibration */ }
      } else pad.rumble(strength, seconds);
    },
    setContext(c) {
      touch.setContext(c);
    },
    syncPlayer(p) {
      const prev = ctxScratch;
      const airborne = !p.grounded && p.mode !== "climb" && p.mode !== "swim" && p.mode !== "dead";
      const gliding = p.mode === "glide";
      const climbing = p.mode === "climb";
      const swimming = p.mode === "swim";
      if (
        ctxSet && prev.airborne === airborne && prev.gliding === gliding && prev.climbing === climbing &&
        prev.swimming === swimming && prev.hasBow === p.hasBow && prev.locked === p.lockId >= 0
      ) return;
      ctxSet = true;
      prev.airborne = airborne;
      prev.gliding = gliding;
      prev.climbing = climbing;
      prev.swimming = swimming;
      prev.hasBow = p.hasBow;
      prev.locked = p.lockId >= 0;
      touch.setContext(prev);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      w.removeEventListener("keydown", onKeyDown);
      w.removeEventListener("keyup", onKeyUp);
      w.removeEventListener("blur", clearHeld);
      w.removeEventListener("mouseup", onMouseUp);
      w.removeEventListener("mousemove", onMouseMove);
      w.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("pointerlockerror", onLockError);
      document.removeEventListener("visibilitychange", clearHeld);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContext);
      exitLock();
      touch.dispose();
      pad.dispose();
      navs.clear();
    },
  };
  const ctxScratch: TouchContext = { airborne: false, gliding: false, climbing: false, swimming: false, hasBow: false, locked: false };
  let ctxSet = false;
  return input;
}) satisfies CreateInput;
