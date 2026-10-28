export type InputAction =
  | "advancements" | "inventory" | "pause" | "chat" | "command" | "debug" | "perspective" | "drop" | "drop_stack"
  | "swap_offhand" | "pick_block" | "fullscreen" | "screenshot" | "hide_gui" | "toggle_fly" | "sprint_tap"
  | `hotbar:${number}`;

export interface InputApi {
  enabled: boolean; // false while a screen is open. Setting false clears held keys.
  readonly pointerLocked: boolean;
  readonly lockPending: boolean; // a lock request is still retrying
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
  trigger(a: InputAction): void; // touch buttons send actions the keyboard would
  dispose(): void;
}

const DOUBLE_TAP_MS = 350; // vanilla 7 ticks

const BINDS: Record<string, string> = {
  forward: "KeyW", back: "KeyS", left: "KeyA", right: "KeyD", jump: "Space", sneak: "ShiftLeft", sprint: "ControlLeft",
  inventory: "KeyE", drop: "KeyQ", swap_offhand: "KeyF", chat: "KeyT", command: "Slash", screenshot: "F2", perspective: "F5",
  fullscreen: "F11", hide_gui: "F1", debug: "F3", advancements: "KeyL", attack: "Mouse0", use: "Mouse2", pick_block: "Mouse1",
  "hotbar.1": "Digit1", "hotbar.2": "Digit2", "hotbar.3": "Digit3", "hotbar.4": "Digit4", "hotbar.5": "Digit5",
  "hotbar.6": "Digit6", "hotbar.7": "Digit7", "hotbar.8": "Digit8", "hotbar.9": "Digit9",
};
const TOGGLES = { sneak: false, sprint: false };

// Settings push rebinds and Hold/Toggle modes here; every input instance reads them live.
export function setKeyBinds(map: Record<string, string>, toggles?: { sneak: boolean; sprint: boolean }) {
  Object.assign(BINDS, map);
  if (toggles) Object.assign(TOGGLES, toggles);
}
const bindOf = (code: string): string | null => {
  for (const k in BINDS) if (BINDS[k] === code) return k;
  return null;
};

const PREVENT = new Set(["Space", "Tab", "F1", "F2", "F3", "F5", "F11", "Slash", "KeyQ", "KeyE", "KeyF", "KeyT", "ArrowUp", "ArrowDown"]);

export function createInput(canvas: HTMLElement): InputApi {
  const keys = new Set<string>();
  const listeners = new Set<(a: InputAction) => void>();
  let enabled = true;
  let mdx = 0, mdy = 0, wheel = 0;
  let lastW = 0, lastSpace = 0;
  let sneakOn = false, sprintOn = false;
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
  const ctrl = (e: KeyboardEvent | MouseEvent) => e.ctrlKey || e.metaKey;

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
      lockAt = performance.now();
      tryLock();
    },
    get lockPending() {
      return !locked() && performance.now() - lockAt < LOCK_RETRY_MS;
    },
    onAction(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    trigger: (a) => emit(a),
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
      document.removeEventListener("pointerlockerror", retryLock);
      clearTimeout(lockTimer);
      listeners.clear();
      keys.clear();
    },
  };

  function update() {
    const b = BINDS;
    api.forward = (keys.has(b.forward) ? 1 : 0) - (keys.has(b.back) ? 1 : 0);
    api.strafe = (keys.has(b.right) ? 1 : 0) - (keys.has(b.left) ? 1 : 0);
    api.jump = keys.has(b.jump);
    api.sneak = TOGGLES.sneak ? sneakOn : keys.has(b.sneak) || (b.sneak === "ShiftLeft" && keys.has("ShiftRight"));
    api.sprint = TOGGLES.sprint ? sprintOn : keys.has(b.sprint) || (b.sprint === "ControlLeft" && keys.has("ControlRight"));
  }

  function clear() {
    keys.clear();
    sneakOn = sprintOn = false;
    api.left = api.right = api.middle = false;
    mdx = mdy = wheel = 0;
    update();
  }

  function onKeyDown(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const c = e.code;
    const bind = bindOf(c);
    if (bind === "fullscreen") {
      e.preventDefault();
      if (!e.repeat) emit("fullscreen");
      return;
    }
    if (bind === "screenshot") {
      e.preventDefault();
      if (!e.repeat) emit("screenshot");
      return;
    }
    if (!enabled) return;
    if (PREVENT.has(c) || bind || (ctrl(e) && (c === "KeyQ" || c === "KeyW" || c === "KeyS" || c === "KeyD" || c === "KeyA"))) e.preventDefault();
    if (e.repeat) {
      if (bind === "drop") emit(ctrl(e) ? "drop_stack" : "drop");
      return;
    }
    down(c, bind, ctrl(e));
  }

  // Shared by keys and mouse buttons, so any bind takes either.
  function down(c: string, bind: string | null, ctrlHeld: boolean) {
    keys.add(c);
    if (bind === "attack") {
      api.left = true;
      api.leftClicks++;
    } else if (bind === "use") {
      api.right = true;
      api.rightClicks++;
    } else if (bind === "pick_block") {
      api.middle = true;
      emit("pick_block");
    }
    if (bind === "sneak" && TOGGLES.sneak) sneakOn = !sneakOn;
    if (bind === "sprint" && TOGGLES.sprint) sprintOn = !sprintOn;
    update();
    const now = performance.now();
    if (c === "Escape") emit("pause");
    else if (bind === "forward") {
      if (now - lastW < DOUBLE_TAP_MS) emit("sprint_tap");
      lastW = now;
    } else if (bind === "jump") {
      if (now - lastSpace < DOUBLE_TAP_MS) {
        emit("toggle_fly");
        lastSpace = 0;
      } else lastSpace = now;
    } else if (bind?.startsWith("hotbar.")) emit(`hotbar:${Number(bind.slice(7)) - 1}`);
    else if (bind === "inventory") emit("inventory");
    else if (bind === "drop") emit(ctrlHeld ? "drop_stack" : "drop");
    else if (bind === "swap_offhand") emit("swap_offhand");
    else if (bind === "chat") emit("chat");
    else if (bind === "command") emit("command");
    else if (bind === "hide_gui") emit("hide_gui");
    else if (bind === "debug") emit("debug");
    else if (bind === "perspective") emit("perspective");
    else if (bind === "advancements") emit("advancements");
  }

  function onKeyUp(e: KeyboardEvent) {
    up(e.code);
  }

  function up(c: string) {
    keys.delete(c);
    const bind = bindOf(c);
    if (bind === "attack") api.left = false;
    else if (bind === "use") api.right = false;
    else if (bind === "pick_block") api.middle = false;
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
    const c = `Mouse${e.button}`;
    down(c, bindOf(c), ctrl(e));
  }

  function onMouseUp(e: MouseEvent) {
    up(`Mouse${e.button}`);
  }

  function onWheel(e: WheelEvent) {
    if (!enabled) return;
    e.preventDefault();
    wheel += Math.sign(e.deltaY);
  }

  const onContext = (e: Event) => e.preventDefault();

  // Browsers refuse a re-lock for about 1 s after the user presses Escape, so keep retrying.
  const LOCK_RETRY_MS = 1600;
  let lockAt = -Infinity;
  let lockTimer: ReturnType<typeof setTimeout> | undefined;
  function tryLock() {
    lockTimer = undefined;
    if (locked() || !enabled) return;
    try {
      const r = (canvas as HTMLElement & { requestPointerLock(o?: unknown): Promise<void> | void }).requestPointerLock();
      if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(retryLock);
    } catch {
      retryLock(); // Headless browsers have no pointer lock.
    }
  }
  function retryLock() {
    if (lockTimer === undefined && !locked() && enabled && performance.now() - lockAt < LOCK_RETRY_MS) lockTimer = setTimeout(tryLock, 250);
  }

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
  document.addEventListener("pointerlockerror", retryLock);
  return api;
}
