// v2 onboarding: a passive input probe for the tutorial and the HUD (sprint held, sticks moving, which semantic button
// was pressed). It never calls preventDefault and never feeds the game: game.ts keeps its own Input. Mapping mirrors
// input.ts (keyboard) and the standard gamepad layout.

export type ProbeBtn = "shoot" | "pass" | "bounce" | "lob" | "screen" | "icon" | "post" | "charge" | "dribble" | "tab";
export type ProbeDev = "keys" | "pad";
export type DefBtn = "steal" | "block" | "switch" | "charge";

/** One physical button means different things on defense, and keyboard and pad differ (keys: L steal, pad: X steal). */
export function defenseOf(b: ProbeBtn, dev: ProbeDev): DefBtn | null {
  if (dev === "keys") return b === "bounce" ? "steal" : b === "shoot" ? "block" : b === "pass" ? "switch" : b === "charge" ? "charge" : null;
  return b === "shoot" ? "steal" : b === "lob" ? "block" : b === "pass" ? "switch" : b === "bounce" ? "charge" : null;
}

type Listener = (b: ProbeBtn, dev: ProbeDev) => void;

const KEY_BTN: Record<string, ProbeBtn> = {
  KeyJ: "shoot", KeyK: "pass", KeyL: "bounce", KeyI: "lob", KeyE: "screen", KeyR: "icon", KeyQ: "post", KeyF: "charge",
  ArrowUp: "dribble", ArrowDown: "dribble", ArrowLeft: "dribble", ArrowRight: "dribble", Tab: "tab",
};
// standard mapping: A0 B1 X2 Y3 LB4 RB5 LT6 RT7
const PAD_BTN: [number, ProbeBtn][] = [[2, "shoot"], [0, "pass"], [1, "bounce"], [3, "lob"], [4, "screen"], [5, "icon"], [6, "post"]];

export type Probe = {
  readonly moving: boolean; // move keys / left stick active now
  readonly sprinting: boolean; // sprint held while moving
  readonly rstick: boolean; // right stick / arrows active
  readonly tabHeld: boolean;
  on(fn: Listener): () => void;
  release(): void;
};

let users = 0;
let raf = 0;
const keys = new Set<string>();
const listeners = new Set<Listener>();
const prevPad: boolean[] = [];
let padMove = false;
let padSprint = false;
let padR = false;
let lastRFlick = 0;

function emit(b: ProbeBtn, dev: ProbeDev) {
  for (const l of listeners) {
    try {
      l(b, dev);
    } catch {
      /* a listener must never break input */
    }
  }
}

function onDown(e: KeyboardEvent) {
  if (e.repeat) return;
  keys.add(e.code);
  const b = KEY_BTN[e.code];
  if (b) emit(b, "keys");
}
function onUp(e: KeyboardEvent) {
  keys.delete(e.code);
}
function onBlur() {
  keys.clear();
}

function poll() {
  raf = requestAnimationFrame(poll);
  let pads: (Gamepad | null)[] = [];
  try {
    pads = navigator.getGamepads ? [...navigator.getGamepads()] : [];
  } catch {
    pads = [];
  }
  const g = pads.find((p) => p && p.connected) ?? null;
  if (!g) {
    padMove = padSprint = padR = false;
    return;
  }
  const lx = g.axes[0] ?? 0;
  const ly = g.axes[1] ?? 0;
  const rx = g.axes[2] ?? 0;
  const ry = g.axes[3] ?? 0;
  padMove = Math.hypot(lx, ly) > 0.3;
  const rt = g.buttons[7];
  padSprint = !!rt && (rt.pressed || rt.value > 0.3);
  const r = Math.hypot(rx, ry) > 0.75;
  if (r && !padR && performance.now() - lastRFlick > 250) {
    lastRFlick = performance.now();
    emit("dribble", "pad");
  }
  padR = Math.hypot(rx, ry) > 0.5;
  for (const [i, b] of PAD_BTN) {
    const d = !!g.buttons[i]?.pressed;
    if (d && !prevPad[i]) emit(b, "pad");
    prevPad[i] = d;
  }
}

const MOVE = ["KeyW", "KeyA", "KeyS", "KeyD"];
const ARROWS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

const probe: Probe = {
  get moving() {
    return padMove || MOVE.some((k) => keys.has(k));
  },
  get sprinting() {
    return this.moving && (padSprint || keys.has("ShiftLeft") || keys.has("ShiftRight"));
  },
  get rstick() {
    return padR || ARROWS.some((k) => keys.has(k));
  },
  get tabHeld() {
    return keys.has("Tab");
  },
  on(fn: Listener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  release() {
    if (--users > 0) return;
    users = 0;
    // each tutorial step remounts its card: keep the held keys (sprint, move) across that hand-over
    clearTimeout(teardown);
    teardown = window.setTimeout(stop, 1000);
  },
};

let teardown = 0;
let listening = false;

function stop() {
  if (users > 0) return;
  cancelAnimationFrame(raf);
  window.removeEventListener("keydown", onDown);
  window.removeEventListener("keyup", onUp);
  window.removeEventListener("blur", onBlur);
  listening = false;
  keys.clear();
  listeners.clear();
}

/** Shared probe. Each caller must call release() once when it unmounts. */
export function acquireProbe(): Probe {
  clearTimeout(teardown);
  if (users++ === 0 && !listening) {
    listening = true;
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    raf = requestAnimationFrame(poll);
  }
  return probe;
}
