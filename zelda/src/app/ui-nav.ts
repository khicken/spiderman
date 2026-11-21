// Gamepad / arrow-key menu navigation over elements tagged data-nav inside a root.

export type NavDir = "up" | "down" | "left" | "right" | "ok" | "back";

function items(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-nav]")).filter((el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null);
}

function mark(el: HTMLElement | null) {
  document.querySelectorAll("[data-focus='1']").forEach((x) => x.removeAttribute("data-focus"));
  if (!el) return;
  el.setAttribute("data-focus", "1");
  el.focus({ preventScroll: false });
  el.scrollIntoView?.({ block: "nearest" });
}

function setRange(el: HTMLInputElement, dir: number) {
  const step = Number(el.step) || 1;
  const v = Math.max(Number(el.min), Math.min(Number(el.max), Number(el.value) + dir * step));
  // React tracks the value through the native setter; assign through it so onChange fires.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, String(v));
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Returns true when the direction was used. `keyboard` = the nav came from a key the browser already handles. */
export function navigate(root: HTMLElement | null, dir: NavDir, keyboard: boolean): boolean {
  if (!root || dir === "back") return false;
  const list = items(root);
  if (!list.length) return false;
  const active = document.activeElement as HTMLElement | null;
  const i = active ? list.indexOf(active) : -1;
  const kind = active?.getAttribute("data-nav");
  if (dir === "ok") {
    if (keyboard || i < 0) return false;
    active!.click();
    return true;
  }
  if (dir === "left" || dir === "right") {
    const d = dir === "left" ? -1 : 1;
    if (kind === "range") {
      if (!keyboard) setRange(active as HTMLInputElement, d);
      return true;
    }
    if (kind === "seg" || kind === "tab") {
      const sibs = list.filter((x) => x.getAttribute("data-nav") === kind && x.parentElement === active!.parentElement);
      const j = sibs.indexOf(active!);
      const next = sibs[(j + d + sibs.length) % sibs.length];
      if (next) {
        mark(next);
        next.click();
      }
      return true;
    }
    if (kind === "toggle") {
      active!.click();
      return true;
    }
    return false;
  }
  if (keyboard && kind === "range") return true;
  const d = dir === "up" ? -1 : 1;
  mark(list[i < 0 ? 0 : (i + d + list.length) % list.length]);
  return true;
}
