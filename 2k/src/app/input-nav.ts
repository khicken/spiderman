import { useEffect, useRef, type RefObject } from "react";
import type { Device, Input } from "./contracts";
import type { NavDir } from "./input";

// Spatial focus navigation for menus, driven by Input.onNav (pad d-pad / left stick / A / B / bumpers and keyboard
// arrows / WASD / Enter / Esc / Q / E). Owner: input-camera. The UI owns the look; this only moves DOM focus.
//
// Markup contract:
//   - focusable: button, a[href], input, select, [role=button], [tabindex]:not([tabindex="-1"]), [data-nav]
//   - data-nav-default   focused first when the menu opens (else the first focusable)
//   - data-nav-skip      never focused by the pad
//   - data-nav-lr        left/right do not move focus; the element gets a bubbling "nav-lr" CustomEvent (detail -1/1)
//   - input[type=range] and select step their value on left/right (fires input + change, React onChange works)
//   - data-nav-group="x" left/right/up/down prefer elements of the same group, then fall back to the nearest

export interface MenuNavOptions {
  onBack?: () => void;
  onTab?: (dir: -1 | 1) => void;
  onStart?: () => void;
  /** Sound / haptic hook: "move" focus moved, "select" ok, "back", "tab", "edge" no target in that direction. */
  onSound?: (kind: "move" | "select" | "back" | "tab" | "edge") => void;
  wrap?: boolean; // wrap up/down at the ends of a vertical list (default true)
}

const SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), [role="button"], [tabindex]:not([tabindex="-1"]), [data-nav]';

function visible(el: HTMLElement): boolean {
  if (el.hasAttribute("data-nav-skip") || el.closest("[aria-hidden='true'],[inert]")) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function focusables(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
    if (visible(el)) out.push(el);
  });
  return out;
}

function focusEl(el: HTMLElement) {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** Focus the [data-nav-default] element (or the first focusable) if nothing inside root has focus. */
export function focusFirst(root: HTMLElement, force = false): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  if (!force && active && root.contains(active) && active !== root) return active;
  const list = focusables(root);
  const pick = list.find((e) => e.hasAttribute("data-nav-default")) ?? list[0] ?? null;
  if (pick) focusEl(pick);
  return pick;
}

/** Step a range input or select by d (-1/1) and fire the events React listens to. True if it handled the step. */
function stepValue(el: HTMLElement, d: -1 | 1): boolean {
  if (el instanceof HTMLInputElement && el.type === "range") {
    if (d > 0) el.stepUp();
    else el.stepDown();
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  if (el instanceof HTMLSelectElement) {
    const n = el.options.length;
    if (n === 0) return true;
    let i = el.selectedIndex;
    for (let k = 0; k < n; k++) {
      i = (i + d + n) % n;
      if (!el.options[i].disabled) break;
    }
    el.selectedIndex = i;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  if (el.hasAttribute("data-nav-lr")) {
    el.dispatchEvent(new CustomEvent("nav-lr", { detail: d, bubbles: true }));
    return true;
  }
  return false;
}

/** Nearest focusable from `from` in a direction. Elements that overlap on the cross axis win. */
export function nearest(root: HTMLElement, from: HTMLElement, dir: "up" | "down" | "left" | "right", wrap: boolean): HTMLElement | null {
  const list = focusables(root);
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const horiz = dir === "left" || dir === "right";
  const sign = dir === "right" || dir === "down" ? 1 : -1;
  const group = from.getAttribute("data-nav-group");
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (let pass = 0; pass < 2 && !best; pass++) {
    for (const el of list) {
      if (el === from) continue;
      if (pass === 0 && group && el.getAttribute("data-nav-group") !== group) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2;
      const by = b.top + b.height / 2;
      const along = horiz ? (bx - ax) * sign : (by - ay) * sign;
      if (along <= 2) continue;
      const overlap = horiz ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) : Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const cross = overlap > 0 ? 0 : horiz ? Math.abs(by - ay) : Math.abs(bx - ax);
      const score = along + cross * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (!group) break;
  }
  if (!best && wrap && !horiz) {
    // wrap to the far end of the same column
    let far = -Infinity;
    for (const el of list) {
      if (el === from) continue;
      const b = el.getBoundingClientRect();
      const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      if (overlap <= 0) continue;
      const by = (b.top + b.height / 2) * -sign;
      if (by > far) {
        far = by;
        best = el;
      }
    }
  }
  return best;
}

/** Wire Input.onNav to spatial focus navigation inside `root`. Returns an unsubscribe function. */
export function createMenuNav(input: Input, root: HTMLElement, opts: MenuNavOptions = {}): () => void {
  const handler = (d: NavDir, src: Device) => {
    if (!root.isConnected) return;
    const active = document.activeElement as HTMLElement | null;
    const cur = active && root.contains(active) && active !== root ? active : null;
    switch (d) {
      case "up":
      case "down":
      case "left":
      case "right": {
        if (!cur) {
          if (focusFirst(root)) opts.onSound?.("move");
          return;
        }
        if ((d === "left" || d === "right") && stepValue(cur, d === "left" ? -1 : 1)) {
          opts.onSound?.("move");
          return;
        }
        // keyboard: text fields keep their own caret keys
        if (src === "keys" && cur instanceof HTMLInputElement && cur.type === "text") return;
        const next = nearest(root, cur, d, opts.wrap ?? true);
        if (next) {
          focusEl(next);
          opts.onSound?.("move");
        } else opts.onSound?.("edge");
        return;
      }
      case "ok":
        if (!cur) {
          focusFirst(root);
          return;
        }
        opts.onSound?.("select");
        cur.click();
        return;
      case "back":
        if (opts.onBack) {
          opts.onSound?.("back");
          opts.onBack();
        }
        return;
      case "tabLeft":
      case "tabRight":
        if (opts.onTab) {
          opts.onSound?.("tab");
          opts.onTab(d === "tabLeft" ? -1 : 1);
        }
        return;
      case "start":
        opts.onStart?.();
        return;
    }
  };
  return input.onNav(handler as (d: NavDir) => void);
}

/**
 * React hook: spatial menu navigation for the subtree in `root` while `enabled`. Options may change every render.
 *   const ref = useRef<HTMLDivElement>(null);
 *   useMenuNav(game?.input, ref, { enabled: screen === "main", onBack: () => setScreen("title") });
 */
export function useMenuNav(
  input: Input | null | undefined,
  root: RefObject<HTMLElement | null>,
  opts: MenuNavOptions & { enabled?: boolean; autoFocus?: boolean } = {},
): void {
  const ref = useRef(opts);
  ref.current = opts;
  const enabled = opts.enabled ?? true;
  const autoFocus = opts.autoFocus ?? false;
  useEffect(() => {
    const el = root.current;
    if (!input || !el || !enabled) return;
    if (autoFocus) focusFirst(el);
    return createMenuNav(input, el, {
      onBack: () => ref.current.onBack?.(),
      onTab: (d) => ref.current.onTab?.(d),
      onStart: () => ref.current.onStart?.(),
      onSound: (k) => ref.current.onSound?.(k),
      get wrap() {
        return ref.current.wrap;
      },
    });
  }, [input, root, enabled, autoFocus]);
}
