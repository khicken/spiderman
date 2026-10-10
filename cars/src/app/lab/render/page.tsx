"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { MapId, Quality, Scenery, TrackFrame, TrackMesh, Track, Weather } from "../../contracts";
import { MAPS } from "../../maps";
import { createTrack } from "../../track";
import { createTrackMesh } from "../../track-mesh";
import { createScenery } from "../../scenery";
import { createRender, QUALITY, TIER } from "../../render";
import { createFx } from "../../fx";

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function buildScene(scene: THREE.Scene, full: boolean) {
  const root = new THREE.Group();
  if (full) scene.add(root);
  const grass = canvasTex(256, 256, (g) => {
    for (let i = 0; i < 6000; i++) {
      g.fillStyle = `hsl(${85 + Math.random() * 30},${35 + Math.random() * 20}%,${18 + Math.random() * 14}%)`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
    }
  }, 400);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  const asphalt = canvasTex(512, 512, (g) => {
    g.fillStyle = "#3a3b3e";
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 20000; i++) {
      const v = 40 + Math.random() * 40;
      g.fillStyle = `rgb(${v},${v},${v + 3})`;
      g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
    }
    g.fillStyle = "#e8e8e0";
    g.fillRect(0, 20, 512, 10);
    g.fillRect(0, 482, 512, 10);
    for (let x = 0; x < 512; x += 128) g.fillRect(x, 251, 64, 10);
  }, 1);
  asphalt.repeat.set(200, 1);
  const roadMat = new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.85 });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(3000, 14), roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.02;
  road.receiveShadow = true;
  root.add(road);

  const sphereGeo = new THREE.SphereGeometry(1.2, 48, 24);
  const specs: THREE.MeshPhysicalMaterialParameters[] = [
    { color: 0xffffff, metalness: 1, roughness: 0.05 },
    { color: 0xffc860, metalness: 1, roughness: 0.3 },
    { color: 0x2a6cff, metalness: 0, roughness: 0.6 },
    { color: 0xf0f0f0, metalness: 0, roughness: 0.15, clearcoat: 1 },
    { color: 0x111111, metalness: 0.2, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.02 },
  ];
  specs.forEach((p, i) => {
    const s = new THREE.Mesh(sphereGeo, new THREE.MeshPhysicalMaterial(p));
    s.position.set(-12 + i * 6, 1.2, -11);
    s.castShadow = s.receiveShadow = true;
    root.add(s);
  });

  const car = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xb00a14, metalness: 0.4, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.75, 4.5), paint);
  body.position.y = 0.7;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.2), new THREE.MeshPhysicalMaterial({ color: 0x0a0c10, metalness: 0.2, roughness: 0.05, clearcoat: 1 }));
  cabin.position.set(0, 1.3, -0.3);
  car.add(body, cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 24).rotateZ(Math.PI / 2);
  const tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  for (const [x, z] of [[0.9, 1.4], [-0.9, 1.4], [0.9, -1.4], [-0.9, -1.4]]) {
    const w = new THREE.Mesh(wheelGeo, tire);
    w.position.set(x, 0.36, z);
    car.add(w);
  }
  const head = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xfff4e0, emissiveIntensity: 20 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff1010, emissiveIntensity: 10 });
  for (const x of [-0.7, 0.7]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.05), head);
    h.position.set(x, 0.8, 2.26);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.05), tail);
    t.position.set(x, 0.85, -2.26);
    car.add(h, t);
  }
  car.traverse((o) => (o.castShadow = o.receiveShadow = true));
  scene.add(car);

  const neonCols = [0xff2a8a, 0x22e0ff, 0xffe02a, 0x7a3cff];
  for (let i = 0; i < 16; i++) {
    const m = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: neonCols[i % 4], emissiveIntensity: 8 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 6), m);
    b.position.set(-200 + i * 30, 6 + (i % 3) * 3, i % 2 ? 14.5 : -14.5);
    b.rotation.y = Math.PI / 2;
    root.add(b);
  }

  const windows = canvasTex(128, 256, (g) => {
    g.fillStyle = "#000";
    g.fillRect(0, 0, 128, 256);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 8; x++) {
        if (Math.random() < 0.45) continue;
        g.fillStyle = Math.random() < 0.7 ? "#ffcf8a" : "#cfe4ff";
        g.fillRect(x * 16 + 3, y * 16 + 4, 10, 8);
      }
  }, 1);
  const bMat = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.8, emissive: 0xffffff, emissiveMap: windows, emissiveIntensity: 0 });
  const bGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 80; i++) {
    const side = i % 2 ? 1 : -1;
    const h = 8 + ((i * 37) % 11) * 6;
    const b = new THREE.Mesh(bGeo, bMat);
    b.scale.set(18, h, 16);
    b.position.set(-600 + Math.floor(i / 2) * 30, h / 2, side * (32 + ((i * 13) % 3) * 6));
    b.castShadow = b.receiveShadow = true;
    root.add(b);
  }
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffc070, emissiveIntensity: 0 });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.8 });
  const lights: THREE.PointLight[] = [];
  for (let i = 0; i < 40; i++) {
    const x = -600 + i * 30;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 8), poleMat);
    pole.position.set(x, 4, 8.5);
    pole.castShadow = true;
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.3), lampMat);
    bulb.position.set(x, 8, 7.8);
    root.add(pole, bulb);
    if (i % 4 === 0) {
      const l = new THREE.PointLight(0xffb060, 0, 40, 2);
      l.position.set(x, 7.7, 7.8);
      root.add(l);
      lights.push(l);
    }
  }
  return { car, paint, roadMat, bMat, lampMat, lights, head };
}

export default function RenderLab() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    const canvas = ref.current!;
    const p = new URLSearchParams(window.location.search);
    const q = (p.get("q") ?? "high") as Quality;
    for (const kv of (p.get("tier") ?? "").split(",").filter(Boolean)) {
      const [k, v] = kv.split(":");
      (TIER[q] as unknown as Record<string, unknown>)[k] = v === "true" ? true : v === "false" ? false : isNaN(+v) ? v : +v;
    }
    const r = createRender(canvas);
    r.setQuality(q);
    let hour = +(p.get("hour") ?? 13);
    const weather = (p.get("weather") ?? "clear") as Weather;
    const lat = +(p.get("lat") ?? 45);
    const season = (p.get("season") ?? "summer") as "summer" | "autumn" | "winter";
    r.setEnv({ hour, weather, season, lat });
    const fx = createFx(r.scene);
    fx.setQuality(q);
    const mapId = p.get("map") as MapId | null;
    const s = buildScene(r.scene, !mapId);
    let track: Track | null = null;
    let tmesh: TrackMesh | null = null;
    let scen: Scenery | null = null;
    const fr: TrackFrame = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3(), width: 0, runoff: 0 };
    let dist = 0;
    let dead = false;
    if (mapId) {
      MAPS.find((m) => m.id === mapId)!.load().then((data) => {
        if (dead) return;
        track = createTrack(data);
        tmesh = createTrackMesh(track, q);
        scen = createScenery(track, q);
        r.scene.add(tmesh.group, scen.group);
        dist = track.grid[0].s;
        applyNight();
      });
    }
    let speed = +(p.get("speed") ?? 30);
    const cam = p.get("cam") ?? "chase";
    let stress = p.get("stress") === "1";
    const surf = (p.get("surf") ?? "asphalt") as import("../../contracts").Surface;
    const timeRate = +(p.get("rate") ?? 0);
    const focus = new THREE.Vector3();
    const camPos = new THREE.Vector3();
    const look = new THREE.Vector3();
    const vel = new THREE.Vector3();
    const wp = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const UPV = new THREE.Vector3(0, 1, 0);
    const tmpD = new THREE.Vector3();
    const skyDir = new THREE.Vector3(+(p.get("sx") ?? -1), 0, +(p.get("sz") ?? 0)).normalize();
    let x = -150;
    let t = 0;
    let raf = 0;
    let last = performance.now();
    let hud = 0;

    const applyNight = () => {
      s.bMat.emissiveIntensity = r.night * 0.5;
      s.lampMat.emissiveIntensity = r.night * 30;
      for (const l of s.lights) l.intensity = r.night * 400;
      tmesh?.setWet(r.wet);
      scen?.setNight(r.night);
      s.roadMat.roughness = 0.85 - 0.65 * r.wet;
      s.roadMat.color.setScalar(1 - 0.45 * r.wet);
    };
    applyNight();

    const step = (dt: number) => {
      t += dt;
      if (timeRate) {
        hour = (hour + dt * timeRate) % 24;
        r.setEnv({ hour, weather, season, lat });
        applyNight();
      }
      x += speed * dt;
      if (x > 600) x = -600;
      s.car.position.set(x, 0, -3);
      s.car.rotation.y = Math.PI / 2;
      focus.set(x, 0.6, -3);
      if (track) {
        dist = track.wrap(dist + speed * dt);
        track.frame(dist, fr);
        s.car.position.copy(fr.pos);
        s.car.rotation.y = Math.atan2(fr.fwd.x, fr.fwd.z);
        focus.copy(fr.pos).y += 0.6;
        camPos.copy(fr.pos).addScaledVector(fr.fwd, -7.5).y += 2.4;
        look.copy(fr.pos).addScaledVector(fr.fwd, 4).y += 1;
        if (cam === "sky") look.y += 6;
        x = 0;
      } else if (cam === "chase") {
        camPos.set(x - 7.5, 2.3, -3.2);
        look.set(x + 4, 1.0, -3);
      } else if (cam === "orbit") {
        camPos.set(x + Math.cos(t * 0.3) * 7, 2.0, -3 + Math.sin(t * 0.3) * 7);
        look.copy(focus);
      } else if (cam === "top") {
        camPos.set(x - 2, 7, 5);
        look.set(x - 8, 0, -3);
      } else if (cam === "sky") {
        camPos.set(x - 7.5, 2.3, -3.2);
        look.set(x - 7.5 + skyDir.x * 10, 2.3 + 3.2, -3.2 + skyDir.z * 10);
      } else {
        camPos.set(-14, 3.2, 6);
        look.set(-4, 1.2, -6);
        focus.copy(look);
      }
      r.camera.position.copy(camPos);
      r.camera.lookAt(look);
      r.camera.updateMatrixWorld();
      (s.paint as THREE.MeshPhysicalMaterial).envMap = r.envMap;
      vel.set(speed, 0, 0);
      if (stress) {
        dir.set(Math.sin(s.car.rotation.y), 0, Math.cos(s.car.rotation.y));
        vel.copy(dir).multiplyScalar(speed);
        for (let w = 0; w < 4; w++) {
          wp.set(-1.4 * (w < 2 ? -1 : 1), 0.05 - 0.6, 0.9 * (w % 2 ? 1 : -1)).applyAxisAngle(UPV, s.car.rotation.y - Math.PI / 2).add(focus);
          fx.tire(0, w, wp, vel, w >= 2 ? 0.9 : 0.3, surf, r.wet);
        }
        dir.set(Math.sin(s.car.rotation.y), 0, Math.cos(s.car.rotation.y));
        vel.copy(dir).multiplyScalar(speed);
        if (Math.random() < 0.3) fx.sparks(wp.copy(focus).addScaledVector(dir, 2).setY(focus.y - 0.5), tmpD.copy(dir).negate().setY(0.4), 1);
        if (Math.random() < 0.03) fx.backfire(wp.copy(focus).addScaledVector(dir, -2.3).setY(focus.y - 0.2), tmpD.copy(dir).negate());
        if (Math.random() < 0.05) fx.debris(wp.copy(focus).setY(focus.y - 0.4), 0.5, "gravel");
      }
      r.frame(dt, focus, speed);
      fx.update(dt, r.camera);
      scen?.update(dt, r.camera);
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      step(dt);
      r.render();
      hud += dt;
      if (hud > 0.25) {
        hud = 0;
        setText(`${q} ${hour.toFixed(1)}h ${weather} ${JSON.stringify(r.stats())}`);
      }
    };
    const onResize = () => r.resize();
    window.addEventListener("resize", onResize);
    loop();

    const lab = {
      render: r,
      fx,
      bench(n = 60) {
        cancelAnimationFrame(raf);
        const gl = r.renderer.getContext();
        const px = new Uint8Array(4);
        for (let i = 0; i < 40; i++) {
          step(1 / 60);
          r.render();
        }
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const t0 = performance.now();
        for (let i = 0; i < n; i++) {
          step(1 / 60);
          r.render();
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        }
        const msPer = (performance.now() - t0) / n;
        const st = r.stats();
        loop();
        return { q, ms: Math.round(msPer * 100) / 100, fps: Math.round(1000 / msPer), calls: st.calls, tris: st.tris, w: r.renderer.domElement.width, h: r.renderer.domElement.height };
      },
      setStress(v: boolean) {
        stress = v;
      },
      setSpeed(v: number) {
        speed = v;
      },
      quality: QUALITY[q],
    };
    (window as unknown as { __lab: typeof lab }).__lab = lab;
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      (tmesh as TrackMesh | null)?.dispose();
      (scen as Scenery | null)?.dispose();
      window.removeEventListener("resize", onResize);
      fx.dispose();
      r.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m !== undefined) m.geometry.dispose();
      });
      r.dispose();
    };
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000" }}>
      <canvas ref={ref} style={{ width: "100%", height: "100%", display: "block" }} />
      <div style={{ position: "absolute", left: 8, top: 8, color: "#fff", font: "12px monospace", textShadow: "0 0 3px #000" }}>
        {text}
        <button style={{ marginLeft: 8, cursor: "pointer" }} onClick={() => (window as unknown as { __lab: { setStress(v: boolean): void } }).__lab.setStress(true)}>
          stress
        </button>
      </div>
    </div>
  );
}
