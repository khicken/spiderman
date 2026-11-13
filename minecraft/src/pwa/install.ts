"use client";

import { useSyncExternalStore } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type InstallState = { kind: "none" } | { kind: "prompt" } | { kind: "ios" };

let deferred: BeforeInstallPromptEvent | null = null;
let state: InstallState = { kind: "none" };
const listeners = new Set<() => void>();

function set(next: InstallState) {
  state = next;
  for (const l of listeners) l();
}

function standalone() {
  return window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

let started = false;
// Called once from the root layout so the event is caught even before the title screen mounts.
export function initInstallPrompt() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    set({ kind: "prompt" });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    set({ kind: "none" });
  });
  if (!standalone() && isIos()) set({ kind: "ios" });
}

export async function promptInstall() {
  if (state.kind === "ios") {
    window.alert("To install, tap the Share button, then \"Add to Home Screen\".");
    return;
  }
  const e = deferred;
  if (!e) return;
  deferred = null;
  set({ kind: "none" });
  // A prompt event is single use; Chromium fires a fresh beforeinstallprompt if the user dismisses it.
  await e.prompt().catch(() => {});
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** True while the game can be installed (Chromium prompt available, or iOS Safari outside the home screen app). */
export function useCanInstall() {
  return useSyncExternalStore(subscribe, () => state.kind !== "none", () => false);
}
