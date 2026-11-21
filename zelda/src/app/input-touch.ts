import type { BtnName } from "./contracts";
import { BTN_NAMES } from "./state";

// Touch overlay for HOLLOWMERE: plain DOM, inline styles that read the globals.css tokens. Floating left stick, a
// right-hand arc of 64 px parchment buttons, right-side drag to orbit, two-finger pinch to zoom. Every control tracks
// its own pointerId, so any mix of fingers works. The overlay root is pointer-events:none; only the controls take hits.

export interface TouchContext {
  airborne: boolean; // off the ground (jump, fall, glide)
  gliding: boolean;
  climbing: boolean;
  swimming: boolean;
  hasBow: boolean;
  locked: boolean; // lock-on active
}

export interface Touch {
  readonly down: Record<BtnName, boolean>;
  readonly latch: Record<BtnName, boolean>; // press edges the input module has not consumed yet
  moveX: number;
  moveY: number; // -1..1, y = +1 forward (finger up)
  sprint: boolean;
  lookDX: number; // px accumulated since the last consume
  lookDY: number;
  zoom: number; // pinch accumulated (+ = farther)
  update(dt: number): void;
  setVisible(on: boolean): void;
  setScale(k: number): void;
  setPrompt(label: string | null): void;
  setContext(c: TouchContext | null): void;
  releaseAll(): void;
  dispose(): void;
}

interface Spec {
  name: BtnName;
  glyph: string;
  cap: string;
  x: number; // px from the right edge to the button center (before scale)
  y: number; // px from the bottom edge (or the top edge when top is set)
  s: number; // diameter
  dragLook?: boolean; // dragging while held also orbits the camera (aim, charge, guard)
  top?: boolean;
}

// Arc around the bottom-right corner. Centers are measured from the corner, margins included.
export const TOUCH_SPECS: readonly Spec[] = [
  { name: "attack", glyph: "sword", cap: "Strike", x: 64, y: 62, s: 84, dragLook: true },
  { name: "jump", glyph: "jump", cap: "Leap", x: 68, y: 152, s: 64 },
  { name: "dodge", glyph: "roll", cap: "Roll", x: 152, y: 44, s: 58 },
  { name: "block", glyph: "shield", cap: "Guard", x: 226, y: 100, s: 62, dragLook: true },
  { name: "glide", glyph: "glide", cap: "Glide", x: 150, y: 128, s: 60 },
  { name: "bow", glyph: "bow", cap: "Bow", x: 68, y: 232, s: 60, dragLook: true },
  { name: "lock", glyph: "lock", cap: "Lock", x: 152, y: 210, s: 54 },
  { name: "use", glyph: "star", cap: "Use", x: 226, y: 182, s: 58 },
  { name: "map", glyph: "map", cap: "", x: 76, y: 66, s: 38, top: true },
  { name: "pause", glyph: "pause", cap: "", x: 28, y: 66, s: 38, top: true },
];

const GLYPHS: Record<string, string> = {
  sword: '<path d="M19 5 L9.5 14.5"/><path d="M19 5 L19.6 3.6"/><path d="M6.5 12.5 L11.5 17.5"/><path d="M9.5 14.5 L5.2 18.8"/><circle cx="4.4" cy="19.6" r="1.3"/>',
  jump: '<path d="M12 19 V6"/><path d="M6.5 11 L12 5.5 L17.5 11"/><path d="M7 21 H17"/>',
  roll: '<path d="M5.2 12 a6.8 6.8 0 1 1 2.2 5"/><path d="M4.6 18 V12.4 H10"/>',
  shield: '<path d="M12 3.5 L19 6.5 V12 C19 16.4 15.6 19.6 12 21 C8.4 19.6 5 16.4 5 12 V6.5 Z"/><path d="M12 3.5 V21" opacity="0.5"/>',
  bow: '<path d="M7 3.5 C17.5 8 17.5 16 7 20.5"/><path d="M7 3.5 L7 20.5" opacity="0.6"/><path d="M3.5 12 H19.5"/><path d="M16.5 9 L19.5 12 L16.5 15"/>',
  lock: '<path d="M4 9 V4 H9 M15 4 H20 V9 M20 15 V20 H15 M9 20 H4 V15"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/>',
  glide: '<path d="M2.5 15.5 C7 8 10 8.5 12 11.5 C14 8.5 17 8 21.5 15.5 C17.5 13.2 14 13.4 12 16.5 C10 13.4 6.5 13.2 2.5 15.5 Z"/>',
  star: '<path d="M12 3 L14.2 9.8 L21 12 L14.2 14.2 L12 21 L9.8 14.2 L3 12 L9.8 9.8 Z"/>',
  map: '<path d="M4 6.5 L9 4.5 L15 6.5 L20 4.5 V17.5 L15 19.5 L9 17.5 L4 19.5 Z"/><path d="M9 4.5 V17.5 M15 6.5 V19.5" opacity="0.6"/>',
  pause: '<path d="M9 5.5 V18.5 M15 5.5 V18.5" stroke-width="2.6"/>',
};

const mix = (c: string, pct: number) => `color-mix(in srgb, var(${c}) ${pct}%, transparent)`;
const FACE_IDLE = `radial-gradient(circle at 34% 28%, ${mix("--color-parchment-hi", 78)}, ${mix("--color-parchment", 55)} 62%, ${mix("--color-parchment-lo", 55)})`;
const FACE_DOWN = `radial-gradient(circle at 40% 35%, ${mix("--color-gold-hi", 90)}, ${mix("--color-gold", 80)} 70%)`;
const SHADOW_IDLE = `0 2px 8px ${mix("--color-night-deep", 55)}, inset 0 0 0 3px ${mix("--color-parchment-lo", 45)}`;
const SHADOW_ON = `0 0 12px ${mix("--color-gold-hi", 75)}, 0 2px 8px ${mix("--color-night-deep", 55)}, inset 0 0 0 3px ${mix("--color-gold-hi", 70)}`;

interface Ctl {
  spec: Spec;
  el: HTMLDivElement;
  cap: HTMLDivElement;
  pointer: number;
  shown: boolean;
  on: boolean;
  dim: boolean;
  capText: string;
}

const NONE = -1;

export function createTouch(container: HTMLElement, onTouch: () => void, vibrate: (ms: number) => void): Touch {
  const down = {} as Record<BtnName, boolean>;
  const latch = {} as Record<BtnName, boolean>;
  for (const b of BTN_NAMES) down[b] = latch[b] = false;
  const cleanups: (() => void)[] = [];
  const listen = <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (ev: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
    el.addEventListener(type, fn as EventListener, opts);
    cleanups.push(() => el.removeEventListener(type, fn as EventListener, opts));
  };

  const root = document.createElement("div");
  root.setAttribute("data-hm-touch", "");
  root.style.cssText =
    "position:absolute;inset:0;pointer-events:none;touch-action:none;user-select:none;-webkit-user-select:none;" +
    "-webkit-touch-callout:none;z-index:5;display:none;font-family:var(--font-ui),system-ui,sans-serif;";
  root.addEventListener("contextmenu", (e) => e.preventDefault());
  container.appendChild(root);

  const zoneCss = "position:absolute;top:0;bottom:0;pointer-events:auto;touch-action:none;";
  const stickZone = document.createElement("div");
  stickZone.style.cssText = `${zoneCss}left:0;width:42%;`;
  const lookZone = document.createElement("div");
  lookZone.style.cssText = `${zoneCss}left:42%;right:0;`;
  root.append(stickZone, lookZone);

  const base = document.createElement("div");
  const thumb = document.createElement("div");
  base.appendChild(thumb);
  root.appendChild(base);

  let k = 1; // layout scale
  let visible = false;
  let ctxInfo: TouchContext | null = null;
  let prompt: string | null = null;

  const ctls: Ctl[] = [];
  const byName = new Map<BtnName, Ctl>();
  for (const spec of TOUCH_SPECS) {
    const el = document.createElement("div");
    el.setAttribute("data-btn", spec.name);
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", spec.name);
    const icon = document.createElement("div");
    icon.style.cssText = "display:flex;align-items:center;justify-content:center;pointer-events:none;";
    icon.innerHTML =
      `<svg viewBox="0 0 24 24" width="${spec.cap ? Math.round(spec.s * 0.42) : 22}" height="${spec.cap ? Math.round(spec.s * 0.42) : 22}" fill="none" stroke="currentColor" ` +
      `stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[spec.glyph]}</svg>`;
    const cap = document.createElement("div");
    cap.style.cssText =
      "pointer-events:none;font:700 8.5px/1 var(--font-ui),system-ui,sans-serif;letter-spacing:0.09em;text-transform:uppercase;" +
      "color:var(--color-ink-soft);margin-top:2px;max-width:92%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    cap.textContent = spec.cap;
    el.append(icon, cap);
    el.style.cssText =
      "position:absolute;box-sizing:border-box;border-radius:50%;display:flex;flex-direction:column;align-items:center;" +
      `justify-content:center;pointer-events:auto;touch-action:none;color:var(--color-ink);` +
      `border:2px solid ${mix("--color-gold", 90)};background:${FACE_IDLE};box-shadow:${SHADOW_IDLE};` +
      "transition:opacity 0.18s var(--ease-ink),transform 0.08s var(--ease-ink),background 0.1s,box-shadow 0.15s;";
    const ring = document.createElement("div");
    ring.style.cssText = `position:absolute;inset:4px;border-radius:50%;border:1px solid ${mix("--color-gold-lo", 55)};pointer-events:none;`;
    el.appendChild(ring);
    root.appendChild(el);
    const c: Ctl = { spec, el, cap, pointer: NONE, shown: true, on: false, dim: false, capText: spec.cap };
    ctls.push(c);
    byName.set(spec.name, c);
  }

  const layoutScale = () => {
    const h = window.innerHeight || 390;
    return Math.max(0.6, Math.min(k, (h - 24) / 262));
  };
  const styleBase = () => {
    const s = layoutScale();
    const bs = 112 * s, ts = 52 * s;
    base.style.cssText =
      `position:absolute;width:${bs}px;height:${bs}px;margin:${-bs / 2}px 0 0 ${-bs / 2}px;border-radius:50%;pointer-events:none;` +
      `border:2px solid ${mix("--color-gold", 80)};background:${mix("--color-night", 30)};` +
      `box-shadow:inset 0 0 0 4px ${mix("--color-parchment", 12)},0 0 10px ${mix("--color-night-deep", 40)};` +
      "transition:opacity 0.2s var(--ease-ink);";
    thumb.style.cssText =
      `position:absolute;left:50%;top:50%;width:${ts}px;height:${ts}px;margin:${-ts / 2}px 0 0 ${-ts / 2}px;border-radius:50%;` +
      `background:${FACE_IDLE};border:2px solid ${mix("--color-gold", 95)};box-shadow:${SHADOW_IDLE};will-change:transform;`;
  };
  const idleStick = () => {
    const s = layoutScale();
    base.style.left = `calc(env(safe-area-inset-left, 0px) + ${112 * s}px)`;
    base.style.top = "auto";
    base.style.bottom = `${112 * s}px`;
    base.style.marginTop = "0";
    base.style.marginBottom = `${-56 * s}px`;
    thumb.style.transform = "translate(0,0)";
    base.style.opacity = "0.38";
  };
  const layout = () => {
    const s = layoutScale();
    for (const c of ctls) {
      const sp = c.spec;
      const d = sp.s * s;
      const st = c.el.style;
      st.width = st.height = `${d}px`;
      st.right = `calc(env(safe-area-inset-right, 0px) + ${(sp.x - sp.s / 2) * s}px)`;
      if (sp.top) {
        st.top = `calc(env(safe-area-inset-top, 0px) + ${(sp.y - sp.s / 2) * s}px)`;
        st.bottom = "auto";
      } else {
        st.bottom = `calc(env(safe-area-inset-bottom, 0px) + ${(sp.y - sp.s / 2) * s}px)`;
        st.top = "auto";
      }
    }
    if (stickId === NONE) {
      styleBase();
      idleStick();
    } else styleBase();
  };

  const paint = (c: Ctl) => {
    const held = c.pointer !== NONE;
    const st = c.el.style;
    st.background = held ? FACE_DOWN : FACE_IDLE;
    st.boxShadow = held || c.on ? SHADOW_ON : SHADOW_IDLE;
    st.transform = held ? "scale(0.92)" : "scale(1)";
    st.opacity = !c.shown ? "0" : c.dim && !held ? "0.45" : "1";
    st.visibility = c.shown ? "visible" : "hidden";
    st.pointerEvents = c.shown ? "auto" : "none";
  };
  const setCap = (c: Ctl, text: string) => {
    if (c.capText === text) return;
    c.capText = text;
    c.cap.textContent = text;
  };

  const releaseBtn = (c: Ctl) => {
    if (c.pointer === NONE) return;
    c.pointer = NONE;
    down[c.spec.name] = false;
    paint(c);
  };

  let lastVib = 0;
  const bumpLook = (dx: number, dy: number) => {
    lookDX += dx;
    lookDY += dy;
  };
  let lookDX = 0, lookDY = 0, zoomAcc = 0;

  for (const c of ctls) {
    const name = c.spec.name;
    let lx = 0, ly = 0;
    listen(c.el, "pointerdown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (c.pointer !== NONE || !c.shown) return;
      onTouch();
      c.pointer = ev.pointerId;
      try { c.el.setPointerCapture(ev.pointerId); } catch { /* synthetic pointers can lack capture */ }
      lx = ev.clientX;
      ly = ev.clientY;
      down[name] = true;
      latch[name] = true;
      const now = performance.now();
      if (now - lastVib > 40) { lastVib = now; vibrate(name === "attack" ? 12 : 8); }
      paint(c);
    });
    listen(c.el, "pointermove", (ev) => {
      if (ev.pointerId !== c.pointer) return;
      ev.preventDefault();
      if (c.spec.dragLook) {
        bumpLook(ev.clientX - lx, ev.clientY - ly);
        lx = ev.clientX;
        ly = ev.clientY;
      }
    });
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== c.pointer) return;
      ev.preventDefault();
      releaseBtn(c);
    };
    listen(c.el, "pointerup", up);
    listen(c.el, "pointercancel", up);
    listen(c.el, "lostpointercapture", up);
  }

  let stickId = NONE, sx = 0, sy = 0, stickDownT = 0, lastTapEnd = 0, toggled = false, magHeldT = 0;
  let rootLeft = 0, rootTop = 0;
  const maxTravel = () => 46 * layoutScale();
  const moveThumb = (tx: number, ty: number) => {
    thumb.style.transform = `translate(${tx}px,${ty}px)`;
  };
  const placeBase = (x: number, y: number) => {
    base.style.left = `${x}px`;
    base.style.top = `${y}px`;
    base.style.bottom = "auto";
    const s = layoutScale();
    base.style.marginTop = `${-56 * s}px`;
    base.style.marginBottom = "0";
  };
  let bx = 0, by = 0;
  listen(stickZone, "pointerdown", (ev) => {
    ev.preventDefault();
    onTouch();
    if (stickId !== NONE) return;
    stickId = ev.pointerId;
    try { stickZone.setPointerCapture(ev.pointerId); } catch { /* see above */ }
    const r = root.getBoundingClientRect();
    rootLeft = r.left;
    rootTop = r.top;
    bx = ev.clientX - rootLeft;
    by = ev.clientY - rootTop;
    placeBase(bx, by);
    base.style.opacity = "0.92";
    moveThumb(0, 0);
    const now = performance.now();
    toggled = now - lastTapEnd < 320 ? true : false;
    stickDownT = now;
    touchMove.x = touchMove.y = 0;
    magHeldT = 0;
  });
  listen(stickZone, "pointermove", (ev) => {
    if (ev.pointerId !== stickId) return;
    ev.preventDefault();
    let dx = ev.clientX - rootLeft - bx, dy = ev.clientY - rootTop - by;
    const m = Math.hypot(dx, dy), maxT = maxTravel();
    if (m > maxT) {
      // drag-follow: the base trails the thumb so the stick never runs out of reach
      const ex = (dx / m) * (m - maxT), ey = (dy / m) * (m - maxT);
      bx += ex;
      by += ey;
      placeBase(bx, by);
      dx -= ex;
      dy -= ey;
    }
    moveThumb(dx, dy);
    let nx = dx / maxT, ny = dy / maxT;
    const mag = Math.hypot(nx, ny);
    if (mag < 0.1) nx = ny = 0;
    else {
      const sc = Math.min(1, (mag - 0.1) / 0.85) / mag;
      nx *= sc;
      ny *= sc;
    }
    touchMove.x = nx;
    touchMove.y = -ny;
  });
  const stickUp = (ev: PointerEvent) => {
    if (ev.pointerId !== stickId) return;
    const now = performance.now();
    if (now - stickDownT < 220 && Math.hypot(touchMove.x, touchMove.y) < 0.3) lastTapEnd = now;
    else lastTapEnd = 0;
    stickId = NONE;
    touchMove.x = touchMove.y = 0;
    toggled = false;
    magHeldT = 0;
    idleStick();
  };
  listen(stickZone, "pointerup", stickUp);
  listen(stickZone, "pointercancel", stickUp);
  listen(stickZone, "lostpointercapture", stickUp);

  const looks = new Map<number, { x: number; y: number }>();
  let pinchD = 0;
  const pinchDist = () => {
    let ax = 0, ay = 0, bx2 = 0, by2 = 0, i = 0;
    for (const p of looks.values()) {
      if (i === 0) { ax = p.x; ay = p.y; } else if (i === 1) { bx2 = p.x; by2 = p.y; }
      i++;
    }
    return Math.hypot(ax - bx2, ay - by2);
  };
  listen(lookZone, "pointerdown", (ev) => {
    ev.preventDefault();
    onTouch();
    looks.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    try { lookZone.setPointerCapture(ev.pointerId); } catch { /* see above */ }
    if (looks.size === 2) pinchD = pinchDist();
  });
  listen(lookZone, "pointermove", (ev) => {
    const p = looks.get(ev.pointerId);
    if (!p) return;
    ev.preventDefault();
    const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
    p.x = ev.clientX;
    p.y = ev.clientY;
    if (looks.size >= 2) {
      const d = pinchDist();
      zoomAcc += (pinchD - d) * 0.03;
      pinchD = d;
    } else bumpLook(dx, dy);
  });
  const lookUp = (ev: PointerEvent) => {
    if (!looks.delete(ev.pointerId)) return;
    if (looks.size === 2) pinchD = pinchDist();
  };
  listen(lookZone, "pointerup", lookUp);
  listen(lookZone, "pointercancel", lookUp);
  listen(lookZone, "lostpointercapture", lookUp);

  const touchMove = { x: 0, y: 0 };

  const applyContext = () => {
    const c = ctxInfo;
    const glide = byName.get("glide")!, bow = byName.get("bow")!, use = byName.get("use")!;
    const lock = byName.get("lock")!, jump = byName.get("jump")!, dodge = byName.get("dodge")!;
    if (c) {
      glide.shown = (c.airborne || c.gliding) && !c.climbing && !c.swimming;
      glide.dim = false;
      glide.on = c.gliding;
      setCap(glide, c.gliding ? "Close" : "Glide");
      bow.shown = c.hasBow;
      lock.on = c.locked;
      setCap(lock, c.locked ? "Free" : "Lock");
      setCap(jump, c.climbing ? "Hop" : c.swimming ? "Dive" : "Leap");
      setCap(dodge, c.swimming ? "Dash" : "Roll");
    } else {
      glide.shown = true;
      glide.dim = true;
      glide.on = false;
      bow.shown = true;
    }
    use.shown = prompt !== null;
    setCap(use, prompt ? prompt.split(" ")[0].slice(0, 8) : "Use");
    for (const ctl of ctls) {
      if (!ctl.shown) releaseBtn(ctl);
      paint(ctl);
    }
  };

  const onResize = () => layout();
  window.addEventListener("resize", onResize);
  cleanups.push(() => window.removeEventListener("resize", onResize));

  const out: Touch = {
    down,
    latch,
    moveX: 0,
    moveY: 0,
    sprint: false,
    lookDX: 0,
    lookDY: 0,
    zoom: 0,
    update(dt) {
      out.moveX = touchMove.x;
      out.moveY = touchMove.y;
      const mag = Math.hypot(touchMove.x, touchMove.y);
      magHeldT = stickId !== NONE && mag > 0.95 ? magHeldT + dt : 0;
      out.sprint = stickId !== NONE && (magHeldT > 0.4 || (toggled && mag > 0.2));
      out.lookDX = lookDX;
      out.lookDY = lookDY;
      out.zoom = zoomAcc;
      lookDX = lookDY = zoomAcc = 0;
    },
    setVisible(on) {
      if (on === visible) return;
      visible = on;
      root.style.display = on ? "block" : "none";
      if (on) {
        layout();
        applyContext();
      } else out.releaseAll();
    },
    setScale(s) {
      k = Math.max(0.5, Math.min(1.6, s));
      layout();
    },
    setPrompt(label) {
      if (label === prompt) return;
      prompt = label;
      applyContext();
    },
    setContext(c) {
      ctxInfo = c;
      applyContext();
    },
    releaseAll() {
      for (const c of ctls) releaseBtn(c);
      stickId = NONE;
      touchMove.x = touchMove.y = 0;
      looks.clear();
      toggled = false;
      if (visible) idleStick();
    },
    dispose() {
      for (const fn of cleanups) fn();
      cleanups.length = 0;
      root.remove();
    },
  };
  layout();
  applyContext();
  return out;
}
