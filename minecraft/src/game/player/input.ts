export type InputAction =
  | "inventory" | "pause" | "chat" | "command" | "debug" | "perspective" | "drop" | "drop_stack"
  | "swap_offhand" | "pick_block" | "fullscreen" | "screenshot" | "hide_gui" | "toggle_fly" | "sprint_tap"
  | `hotbar:${number}`;

export interface InputApi {
  enabled: boolean; // false while a screen is open. Setting false clears held keys.
  readonly pointerLocked: boolean;
  forward: number;
  strafe: number; // positive is right
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
  left: boolean;
  right: boolean;
  middle: boolean;
  leftClicks: number; // presses since consumeClicks, so a click shorter than a tick still counts
  rightClicks: number;
  isDown(code: string): boolean;
  consumeMouse(out: { dx: number; dy: number }): { dx: number; dy: number };
  consumeWheel(): number; // positive scrolls down (next hotbar slot)
  consumeClicks(): void;
  requestLock(): void;
  onAction(cb: (a: InputAction) => void): () => void;
  dispose(): void;
}

const DOUBLE_TAP_MS = 350; // vanilla 7 ticks

const PREVENT = new Set(["Space", "Tab", "F1", "F2", "F3", "F5", "F11", "Slash", "KeyQ", "KeyE", "KeyF", "KeyT", "ArrowUp", "ArrowDown"]);

export function createInput(canvas: HTMLElement): InputApi {
  const keys = new Set<string>();
  const listeners = new Set<(a: InputAction) => void>();
  let enabled = true;
  let mdx = 0, mdy = 0, wheel = 0;
  let lastW = 0, lastSpace = 0;
  const emit = (a: InputAction) => {
    for (const cb of listeners) {
      try {
        cb(a);
      } catch (e) {
        console.error(e);
      }
    }
  };
  const locked = () => typeof document !== "undefined" && document.pointerLockElement === canvas;
  const ctrl = (e: KeyboardEvent) => e.ctrlKey || e.metaKey;

  const api: InputApi = {
    get enabled() {
      return enabled;
    },
    set enabled(v: boolean) {
      enabled = v;
      if (!v) clear();
    },
    get pointerLocked() {
      return locked();
    },
    forward: 0,
    strafe: 0,
    jump: false,
    sneak: false,
    sprint: false,
    left: false,
    right: false,
    middle: false,
    leftClicks: 0,
    rightClicks: 0,
    isDown: (code) => keys.has(code),
    consumeMouse(out) {
      out.dx = mdx;
      out.dy = mdy;
      mdx = mdy = 0;
      return out;
    },
    consumeWheel() {
      const w = wheel;
      wheel = 0;
      return w;
    },
    consumeClicks() {
      api.leftClicks = 0;
      api.rightClicks = 0;
    },
    requestLock() {
      try {
        const r = (canvas as HTMLElement & { requestPointerLock(o?: unknown): Promise<void> | void }).requestPointerLock();
        if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => {});
      } catch {
        // Headless browsers have no pointer lock.
      }
    },
    onAction(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clear);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContext);
      document.removeEventListener("pointerlockchange", onLockChange);
      listeners.clear();
      keys.clear();
    },
  };

  function update() {
    api.forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    api.strafe = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    api.jump = keys.has("Space");
    api.sneak = keys.has("ShiftLeft") || keys.has("ShiftRight");
    api.sprint = keys.has("ControlLeft") || keys.has("ControlRight");
  }

  function clear() {
    keys.clear();
    api.left = api.right = api.middle = false;
    mdx = mdy = wheel = 0;
    update();
  }

  function onKeyDown(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const c = e.code;
    if (c === "F11") {
      e.preventDefault();
      if (!e.repeat) emit("fullscreen");
      return;
    }
    if (c === "F2") {
      e.preventDefault();
      if (!e.repeat) emit("screenshot");
      return;
    }
    if (!enabled) return;
    if (PREVENT.has(c) || (ctrl(e) && (c === "KeyQ" || c === "KeyW" || c === "KeyS" || c === "KeyD" || c === "KeyA"))) e.preventDefault();
    if (e.repeat) {
      if (c === "KeyQ") emit(ctrl(e) ? "drop_stack" : "drop");
      return;
    }
    keys.add(c);
    update();
    const now = performance.now();
    if (c === "KeyW") {
      if (now - lastW < DOUBLE_TAP_MS) emit("sprint_tap");
      lastW = now;
    } else if (c === "Space") {
      if (now - lastSpace < DOUBLE_TAP_MS) {
        emit("toggle_fly");
        lastSpace = 0;
      } else lastSpace = now;
    } else if (c.startsWith("Digit") && c !== "Digit0") emit(`hotbar:${Number(c.slice(5)) - 1}`);
    else if (c === "KeyE") emit("inventory");
    else if (c === "KeyQ") emit(ctrl(e) ? "drop_stack" : "drop");
    else if (c === "KeyF") emit("swap_offhand");
    else if (c === "KeyT") emit("chat");
    else if (c === "Slash") emit("command");
    else if (c === "F1") emit("hide_gui");
    else if (c === "F3") emit("debug");
    else if (c === "F5") emit("perspective");
    else if (c === "Escape") emit("pause");
  }

  function onKeyUp(e: KeyboardEvent) {
    keys.delete(e.code);
    update();
  }

  function onMouseMove(e: MouseEvent) {
    if (!enabled) return;
    if (locked() || api.left || api.right) {
      mdx += e.movementX || 0;
      mdy += e.movementY || 0;
    }
  }

  function onMouseDown(e: MouseEvent) {
    if (!enabled) return;
    e.preventDefault();
    if (!locked()) api.requestLock();
    if (e.button === 0) {
      api.left = true;
      api.leftClicks++;
    } else if (e.button === 2) {
      api.right = true;
      api.rightClicks++;
    } else if (e.button === 1) {
      api.middle = true;
      emit("pick_block");
    }
  }

  function onMouseUp(e: MouseEvent) {
    if (e.button === 0) api.left = false;
    else if (e.button === 2) api.right = false;
    else if (e.button === 1) api.middle = false;
  }

  function onWheel(e: WheelEvent) {
    if (!enabled) return;
    e.preventDefault();
    wheel += Math.sign(e.deltaY);
  }

  const onContext = (e: Event) => e.preventDefault();

  let wasLocked = false;
  function onLockChange() {
    const now = locked();
    if (wasLocked && !now && enabled) emit("pause");
    wasLocked = now;
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", clear);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContext);
  document.addEventListener("pointerlockchange", onLockChange);
  return api;
}
