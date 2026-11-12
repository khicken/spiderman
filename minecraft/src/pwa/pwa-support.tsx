"use client";

import { useEffect, useState } from "react";
import { initInstallPrompt } from "./install";

const SW_URL = "/minecraft/sw.js";
const SCOPE = "/minecraft";
let updateRequested = false;

function useServiceWorker() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // A worker left over from a production run on localhost would serve stale chunks to the dev server.
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.scope.includes(SCOPE) && void r.unregister()));
      return;
    }
    let reg: ServiceWorkerRegistration | undefined;
    let reloading = false;
    // The first install also fires controllerchange (clients.claim), so only reload after the user asked.
    const onControllerChange = () => {
      if (reloading || !updateRequested) return;
      reloading = true;
      window.location.reload();
    };
    const track = (sw: ServiceWorker | null) => {
      if (!sw) return;
      const check = () => {
        if (sw.state === "installed" && navigator.serviceWorker.controller) setWaiting(sw);
      };
      check();
      sw.addEventListener("statechange", check);
    };
    const register = () => {
      navigator.serviceWorker.register(SW_URL, { scope: SCOPE }).then((r) => {
        reg = r;
        track(r.waiting);
        track(r.installing);
        r.addEventListener("updatefound", () => track(r.installing));
      }, () => {});
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void reg?.update().catch(() => {});
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("load", register);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return [waiting, () => setWaiting(null)] as const;
}

// Phones get fullscreen and a landscape lock on their first tap; installed apps already start fullscreen.
function useImmersive() {
  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)");
    let tried = false;
    const lockOrientation = () => {
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      void o?.lock?.("landscape").catch(() => {});
    };
    const onDown = () => {
      if (!coarse.matches || tried) return;
      tried = true;
      const el = document.documentElement;
      if (document.fullscreenElement || !document.fullscreenEnabled || !el.requestFullscreen) return lockOrientation();
      el.requestFullscreen({ navigationUI: "hide" }).then(lockOrientation, () => {});
    };
    // iOS Safari ignores user-scalable=no for pinch; double-tap zoom is off via touch-action in globals.css.
    const block = (e: Event) => e.preventDefault();
    window.addEventListener("pointerdown", onDown, true);
    document.addEventListener("gesturestart", block);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("gesturestart", block);
    };
  }, []);
}

export function PwaSupport() {
  const [waiting, dismiss] = useServiceWorker();
  useImmersive();
  useEffect(() => initInstallPrompt(), []);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const on = () => setLocked(!!document.pointerLockElement);
    document.addEventListener("pointerlockchange", on);
    return () => document.removeEventListener("pointerlockchange", on);
  }, []);
  if (!waiting || locked) return null;
  return (
    <div role="status" className="pwa-update">
      <span>A new version is available.</span>
      <button type="button" onClick={() => {
          updateRequested = true;
          waiting.postMessage("skip-waiting");
        }}>Reload</button>
      <button type="button" onClick={dismiss}>Later</button>
    </div>
  );
}
