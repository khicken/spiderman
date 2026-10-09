"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { MapData, Quality, TrackFrame } from "../../contracts";
import { createScenery } from "../../scenery";
import { createTrack } from "../../track";
import { createTrackMesh } from "../../track-mesh";
import { mockMap } from "../mock-map";

export default function SceneryLab() {
  const host = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState("loading");
  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    const mapId = qs.get("map");
    const q = (qs.get("q") as Quality) || "high";
    const night = qs.get("night") === "1" ? 1 : +(qs.get("night") || 0);
    let alive = true;
    let cleanup = () => {};
    (async () => {
      let map: MapData = mockMap();
      // Lab-only shim: some generated maps still contain `waterY: auto`.
      (globalThis as unknown as { auto: number }).auto = -1000;
      if (mapId && mapId !== "mock") map = await import(`../../maps/${mapId}.ts`).then((m: { MAP: MapData }) => m.MAP).catch((e) => (console.error("map load", e), mockMap()));
      if (qs.get("style")) map = { ...map, id: qs.get("style") as MapData["id"] };
      if (!alive) return;
      const el = host.current!;
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(2, devicePixelRatio));
      renderer.setSize(el.clientWidth, el.clientHeight);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = night ? 0.9 : 1;
      renderer.shadowMap.enabled = q !== "low";
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const skyCol = new THREE.Color(night ? 0x0b1020 : 0xa9c1d8);
      scene.background = skyCol;
      scene.fog = new THREE.Fog(skyCol, 400, 4500);
      const pm = new THREE.PMREMGenerator(renderer);
      const env = pm.fromScene(new RoomEnvironment(), 0.04);
      pm.dispose();
      scene.environment = env.texture;
      scene.environmentIntensity = night ? 0.08 : 0.6;
      const hemi = new THREE.HemisphereLight(night ? 0x2a3550 : 0xbcd2ec, night ? 0x101010 : 0x5a5040, night ? 0.25 : 0.9);
      const sun = new THREE.DirectionalLight(night ? 0x8ea4d0 : 0xfff0dc, night ? 0.25 : 3);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = sun.shadow.camera.bottom = -150;
      sun.shadow.camera.right = sun.shadow.camera.top = 150;
      sun.shadow.camera.far = 1500;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.4;
      scene.add(hemi, sun, sun.target);
      const t0 = performance.now();
      const track = createTrack(map);
      const mesh = createTrackMesh(track, q);
      scene.add(mesh.group);
      const t1 = performance.now();
      const scenery = createScenery(track, q);
      const t2 = performance.now();
      scenery.setNight(night);
      scene.add(scenery.group);
      const camera = new THREE.PerspectiveCamera(60, el.clientWidth / el.clientHeight, 0.1, q === "low" ? 800 : q === "medium" ? 1500 : q === "high" ? 2500 : 6000);
      const controls = new OrbitControls(camera, renderer.domElement);
      const f: TrackFrame = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3(), width: 0, runoff: 0 };
      const cam = qs.get("cam") || "up";
      const s0 = +(qs.get("s") ?? track.checkpoints[0]);
      const place = (mode: string, s: number) => {
        track.frame(s, f);
        if (mode === "start") {
          camera.position.copy(f.pos).addScaledVector(f.up, 1.2).addScaledVector(f.fwd, -6);
          controls.target.copy(f.pos).addScaledVector(f.fwd, 40).addScaledVector(f.up, 1.0);
        } else if (mode === "up") {
          camera.position.copy(f.pos).addScaledVector(f.fwd, -90).add(new THREE.Vector3(0, 60, 0));
          controls.target.copy(f.pos).addScaledVector(f.fwd, 140);
        } else {
          const c = mode.split(",").map(Number), a = (qs.get("at") || "0,0,0").split(",").map(Number);
          camera.position.set(c[0], c[1], c[2]);
          controls.target.set(a[0], a[1], a[2]);
        }
        controls.update();
      };
      place(cam, s0);
      (window as unknown as { __scenery: unknown }).__scenery = { place, scenery, track, camera, controls, scene, renderer };
      const onResize = () => {
        renderer.setSize(el.clientWidth, el.clientHeight);
        camera.aspect = el.clientWidth / el.clientHeight;
        camera.updateProjectionMatrix();
      };
      addEventListener("resize", onResize);
      let last = performance.now(), frames = 0, acc = 0, raf = 0;
      const loop = () => {
        raf = requestAnimationFrame(loop);
        const now = performance.now();
        const dt = Math.min(1 / 30, (now - last) / 1000);
        last = now;
        controls.update();
        const fo = controls.target;
        sun.position.set(fo.x - 300, fo.y + 380, fo.z - 250);
        sun.target.position.copy(fo);
        scenery.update(dt, camera);
        renderer.render(scene, camera);
        frames++;
        acc += dt;
        if (acc > 0.5) {
          setInfo(
            JSON.stringify({ map: map.id, q, trackMs: Math.round(t1 - t0), sceneryMs: Math.round(t2 - t1), fps: Math.round(frames / acc), calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
          );
          frames = 0;
          acc = 0;
        }
      };
      loop();
      cleanup = () => {
        cancelAnimationFrame(raf);
        removeEventListener("resize", onResize);
        controls.dispose();
        scenery.dispose();
        mesh.dispose();
        env.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
      if (!alive) cleanup();
    })();
    return () => {
      alive = false;
      cleanup();
    };
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000" }}>
      <div ref={host} style={{ position: "absolute", inset: 0 }} />
      <div id="info" style={{ position: "absolute", left: 8, top: 8, right: 8, color: "#fff", font: "12px monospace", textShadow: "0 1px 2px #000", pointerEvents: "none" }}>
        {info} · ?map= ?q= ?night=1 ?cam=start|up|x,y,z&at= ?s=
      </div>
    </div>
  );
}
