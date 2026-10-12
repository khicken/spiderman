import type { InputApi } from "./input";

const HOLD_MS = 300;
const TAP_MOVE = 10;
const LOOK_GAIN = 1.4;
const DOUBLE_TAP_MS = 350;

export const isTouchDevice = () =>
  typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window) && navigator.maxTouchPoints > 0;

type Btn = "jump" | "sneak" | "attack" | "use" | "inventory" | "pause" | "drop";

const BUTTONS: [Btn, string, string][] = [
  ["jump", "▲", "right:28px;bottom:120px;width:76px;height:76px"],
  ["sneak", "▼", "right:112px;bottom:40px;width:64px;height:64px"],
  ["attack", "⚔", "right:28px;bottom:210px;width:64px;height:64px"],
  ["use", "✋", "right:112px;bottom:150px;width:64px;height:64px"],
  ["inventory", "…", "right:28px;bottom:36px;width:64px;height:64px"],
  ["drop", "Q", "right:184px;bottom:40px;width:52px;height:52px"],
  ["pause", "II", "right:12px;top:12px;width:48px;height:40px"],
];

export function createTouchControls(input: InputApi, guiScale: () => number) {
  const root = document.createElement("div");
  root.style.cssText = "display:none;position:fixed;inset:0;z-index:5;touch-action:none;user-select:none;-webkit-user-select:none;";
  const box = "position:absolute;display:flex;align-items:center;justify-content:center;background:rgba(40,40,40,0.45);border:2px solid rgba(255,255,255,0.35);color:rgba(255,255,255,0.85);font:bold 22px monospace;border-radius:6px;";
  const joyBase = document.createElement("div");
  joyBase.style.cssText = "position:absolute;left:36px;bottom:44px;width:150px;height:150px;border-radius:50%;background:rgba(40,40,40,0.35);border:2px solid rgba(255,255,255,0.3);";
  const knob = document.createElement("div");
  knob.style.cssText = "position:absolute;left:47px;top:47px;width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,0.45);";
  joyBase.dataset.ctl = "joy";
  joyBase.appendChild(knob);
  root.appendChild(joyBase);
  const els = new Map<Btn, HTMLDivElement>();
  for (const [id, label, pos] of BUTTONS) {
    const el = document.createElement("div");
    el.style.cssText = box + pos;
    el.textContent = label;
    el.dataset.ctl = id;
    root.appendChild(el);
    els.set(id, el);
  }
  document.body.appendChild(root);

  let lookDx = 0, lookDy = 0;
  let joyId = -1, joyX = 0, joyY = 0;
  let lookId = -1, lookX = 0, lookY = 0, startX = 0, startY = 0, lookT = 0, lookMoved = false, holding = false;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let sneakOn = false, lastJump = 0;
  const pressed = new Map<number, Btn>();

  const consume = input.consumeMouse.bind(input);
  input.consumeMouse = (out) => {
    consume(out);
    out.dx += lookDx;
    out.dy += lookDy;
    lookDx = lookDy = 0;
    return out;
  };

  function hotbarSlot(x: number, y: number): number {
    const s = guiScale();
    const w = 182 * s;
    const left = (window.innerWidth - w) / 2;
    if (y < window.innerHeight - 22 * s || x < left || x > left + w) return -1;
    return Math.min(8, Math.floor((x - left - s) / (20 * s)));
  }

  function setJoy(x: number, y: number) {
    const r = joyBase.getBoundingClientRect();
    let dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
    const max = r.width / 2;
    const len = Math.hypot(dx, dy);
    if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    const k = Math.min(1, len / max);
    const fx = len > 0 ? dx / len : 0, fy = len > 0 ? dy / len : 0;
    input.forward = k > 0.2 ? -fy * k : 0;
    input.strafe = k > 0.2 ? fx * k : 0;
    input.sprint = k > 0.95 && -fy > 0.8;
  }

  function press(b: Btn) {
    els.get(b)!.style.background = "rgba(200,200,200,0.5)";
    if (b === "jump") {
      input.jump = true;
      const now = performance.now();
      if (now - lastJump < DOUBLE_TAP_MS) { input.trigger("toggle_fly"); lastJump = 0; } else lastJump = now;
    } else if (b === "sneak") {
      sneakOn = !sneakOn;
      input.sneak = sneakOn;
    } else if (b === "attack") { input.left = true; input.leftClicks++; }
    else if (b === "use") { input.right = true; input.rightClicks++; }
    else if (b === "inventory") input.trigger("inventory");
    else if (b === "drop") input.trigger("drop");
    else if (b === "pause") input.trigger("pause");
  }

  function release(b: Btn) {
    els.get(b)!.style.background = b === "sneak" && sneakOn ? "rgba(120,160,255,0.5)" : "";
    if (b === "jump") input.jump = false;
    else if (b === "attack") input.left = false;
    else if (b === "use") input.right = false;
  }

  function endLook() {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    if (holding) input.left = false;
    else if (!lookMoved && performance.now() - lookT < HOLD_MS) input.rightClicks++;
    holding = false;
    lookId = -1;
  }

  function onStart(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const ctl = (t.target as HTMLElement).closest?.("[data-ctl]") as HTMLElement | null;
      const id = ctl?.dataset.ctl;
      if (id === "joy" && joyId < 0) {
        joyId = t.identifier;
        setJoy(t.clientX, t.clientY);
      } else if (id && id !== "joy") {
        pressed.set(t.identifier, id as Btn);
        press(id as Btn);
      } else if (lookId < 0) {
        const slot = hotbarSlot(t.clientX, t.clientY);
        if (slot >= 0) { input.trigger(`hotbar:${slot}`); continue; }
        lookId = t.identifier;
        lookX = startX = t.clientX; lookY = startY = t.clientY; lookT = performance.now();
        lookMoved = false; holding = false;
        holdTimer = setTimeout(() => {
          holdTimer = null;
          if (lookId >= 0 && !lookMoved) { holding = true; input.left = true; input.leftClicks++; }
        }, HOLD_MS);
      }
    }
  }

  function onMove(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === joyId) setJoy(t.clientX, t.clientY);
      else if (t.identifier === lookId) {
        const dx = t.clientX - lookX, dy = t.clientY - lookY;
        lookX = t.clientX; lookY = t.clientY;
        lookDx += dx * LOOK_GAIN;
        lookDy += dy * LOOK_GAIN;
        if (!lookMoved && Math.hypot(t.clientX - startX, t.clientY - startY) > TAP_MOVE) lookMoved = true;
      }
    }
  }

  function onEnd(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === joyId) {
        joyId = -1;
        knob.style.transform = "";
        input.forward = input.strafe = 0;
        input.sprint = false;
      } else if (t.identifier === lookId) endLook();
      const b = pressed.get(t.identifier);
      if (b) { pressed.delete(t.identifier); release(b); }
    }
  }

  root.addEventListener("touchstart", onStart, { passive: false });
  root.addEventListener("touchmove", onMove, { passive: false });
  root.addEventListener("touchend", onEnd, { passive: false });
  root.addEventListener("touchcancel", onEnd, { passive: false });
  const onContext = (e: Event) => e.preventDefault();
  root.addEventListener("contextmenu", onContext);

  let shown = false;
  return {
    update(active: boolean) {
      if (active === shown) return;
      shown = active;
      root.style.display = active ? "" : "none";
      if (!active) {
        joyId = lookId = -1;
        knob.style.transform = "";
        pressed.clear();
        for (const el of els.values()) el.style.background = "";
        sneakOn = false;
      }
    },
    dispose() {
      if (holdTimer) clearTimeout(holdTimer);
      input.consumeMouse = consume;
      root.remove();
    },
  };
}
