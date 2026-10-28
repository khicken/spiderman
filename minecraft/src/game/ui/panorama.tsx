"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { PANORAMA_FACES } from "./panorama-faces";
import { dirtUrl } from "./sprites";
import { activeSettings } from "./settings";

const CACHE_KEY = "mc-panorama-v2";
const SPIN_DEG_PER_SEC = 2; // vanilla: 0.1 degrees per tick
const PITCH = (-10 * Math.PI) / 180;

function readCache(): string[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(list) && list.length === 6 && list.every((s) => typeof s === "string") ? (list as string[]) : null;
  } catch {
    return null;
  }
}

function writeCache(faces: string[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(faces));
  } catch {
    // Storage full: the panorama renders again next visit.
  }
}

let spin = 0;

export function Panorama({ blur }: { blur: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [faces, setFaces] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const cached = readCache();
    if (cached) {
      setFaces(cached);
      return;
    }
    let job: { cancel(): void } | null = null;
    let cancelled = false;
    const t = setTimeout(() => {
      void import("./panorama-gen")
        .then(({ generatePanorama }) => {
          if (cancelled) return;
          const j = generatePanorama((window as { __panoSeed?: number }).__panoSeed);
          job = j;
          return j.done.then((f) => {
            if (cancelled) return;
            if (!f) return setFailed(true);
            writeCache(f);
            setFaces(f);
          });
        })
        .catch(() => setFailed(true));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
      job?.cancel();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!faces || !canvas) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
    } catch {
      setFailed(true);
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(85, 1, 0.05, 10);
    const geo = new THREE.PlaneGeometry(2, 2);
    const loader = new THREE.TextureLoader();
    const mats: THREE.MeshBasicMaterial[] = [];
    let loaded = 0;
    PANORAMA_FACES.forEach((f, i) => {
      const tex = loader.load(faces[i], () => {
        loaded++;
        if (loaded === 6) setShown(true);
      });
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      const mat = new THREE.MeshBasicMaterial({ map: tex, depthWrite: false, depthTest: false });
      mats.push(mat);
      const m = new THREE.Mesh(geo, mat);
      m.rotation.set(f.pitch, f.yaw, 0, "YXZ");
      m.position.set(0, 0, -1).applyEuler(m.rotation);
      m.scale.setScalar(1.001);
      scene.add(m);
    });
    const size = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    size();
    window.addEventListener("resize", size);
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      spin = (spin + ((now - last) / 1000) * SPIN_DEG_PER_SEC) % 360;
      last = now;
      camera.rotation.set(PITCH, (-spin * Math.PI) / 180, 0, "YXZ");
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
      geo.dispose();
      for (const m of mats) {
        m.map?.dispose();
        m.dispose();
      }
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, [faces]);

  const ready = shown && !failed;
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#000" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${dirtUrl()})`, backgroundSize: "64px 64px", imageRendering: "pixelated", opacity: ready ? 0 : 1, transition: "opacity 1s" }} />
      {faces && !failed && (
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            inset: blur ? -24 : 0,
            width: blur ? "calc(100% + 48px)" : "100%",
            height: blur ? "calc(100% + 48px)" : "100%",
            filter: blur && activeSettings().menuBlur > 0 ? `blur(${activeSettings().menuBlur * 2}px)` : undefined,
            opacity: ready ? 1 : 0,
            transition: "opacity 1s",
          }}
        />
      )}
    </div>
  );
}
