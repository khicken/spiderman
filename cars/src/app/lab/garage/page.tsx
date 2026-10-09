"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import type { CarId, CarModel, Quality, VehicleState, WheelState } from "../../contracts";
import { CARS } from "../../cars";
import { createCarModel } from "../../car-model";
import { startDrive } from "./drive";

const IDS: CarId[] = ["hyper", "gt3", "jdm", "muscle", "rally", "v12", "ev", "classic"];

function mockState(): VehicleState {
  const wheel = (): WheelState => ({ compress: 0.4, spin: 0, omega: 0, steer: 0, slipRatio: 0, slipAngle: 0, load: 0, contact: true, surface: "asphalt", skid: 0, pos: new THREE.Vector3() });
  return {
    pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), angVel: new THREE.Vector3(), speed: 0, rpm: 900, gear: 1, throttle: 0, brake: 0, boost: 0,
    limiter: false, shifting: false, wheels: [wheel(), wheel(), wheel(), wheel()], s: 0, lateral: 0, onRoad: true, airborne: false, tunnel: false,
  };
}

// Dark studio with softboxes, for crisp paint reflections.
function studio() {
  const s = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(30, 12, 30), new THREE.MeshBasicMaterial({ color: 0x2a2c30, side: THREE.BackSide }));
  box.position.y = 5;
  s.add(box);
  const soft = (w: number, h: number, x: number, y: number, z: number, rx: number, ry: number, k: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    s.add(m);
  };
  soft(10, 3, 0, 10.5, 0, Math.PI / 2, 0, 6);
  soft(2, 8, -14, 5, -4, 0, Math.PI / 2, 4);
  soft(2, 8, 14, 5, 4, 0, -Math.PI / 2, 4);
  soft(12, 1.2, 0, 3, -14.5, 0, 0, 3);
  soft(8, 1.5, 0, 6, 14.5, 0, Math.PI, 2.5);
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color: 0x141518 }));
  fl.rotation.x = -Math.PI / 2;
  fl.position.y = -0.9;
  s.add(fl);
  return s;
}

export default function GarageLab() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const q = new URLSearchParams(location.search);
    const id = (q.get("car") ?? "hyper") as CarId;
    const all = q.get("all") === "1";
    const anim = q.get("anim") === "1";
    const night = q.get("night") === "1";
    const view = q.get("view") ?? "orbit";
    const quality = (q.get("q") ?? "high") as Quality;
    const paint = q.get("paint");
    const mapId = q.get("map");
    if (mapId) {
      let stop: (() => void) | null = null, dead = false;
      startDrive(canvas, id, mapId as never, quality, Number(q.get("hour") ?? 14)).then((s) => (dead ? s() : (stop = s)));
      return () => {
        dead = true;
        stop?.();
      };
    }

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.setSize(innerWidth, innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = night ? 0.9 : 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(night ? 0x020304 : 0x0d0e10);
    const pm = new THREE.PMREMGenerator(renderer);
    const room = q.get("env") === "room" ? new RoomEnvironment() : studio();
    const envTex = pm.fromScene(room, 0.02).texture;
    scene.environment = envTex;
    scene.environmentIntensity = night ? 0.06 : 0.9;
    const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.05, 200);

    const mirror = new Reflector(new THREE.CircleGeometry(40, 64), { textureWidth: 1024, textureHeight: 1024, color: 0x6a6d72 });
    mirror.rotation.x = -Math.PI / 2;
    scene.add(mirror);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.6, transparent: true, opacity: 0.86 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.002;
    floor.receiveShadow = true;
    scene.add(floor);

    const key = new THREE.DirectionalLight(0xffffff, night ? 0.05 : 2.2);
    key.position.set(5, 9, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 6;
    key.shadow.camera.left = key.shadow.camera.bottom = -14;
    key.shadow.camera.right = key.shadow.camera.top = 14;
    key.shadow.bias = -0.0003;
    scene.add(key);
    const rimL = new THREE.DirectionalLight(0xbcd4ff, night ? 0.03 : 1.4);
    rimL.position.set(-6, 4, -8);
    scene.add(rimL);

    const ids = all ? IDS : [id];
    const models: CarModel[] = [];
    const t0 = performance.now();
    const states: VehicleState[] = [];
    ids.forEach((cid, i) => {
      const spec = CARS.find((c) => c.id === cid)!;
      const m = createCarModel(spec, paint ? "#" + paint : spec.paints[0], quality, !all);
      const s = mockState();
      s.pos.set(all ? (i - (ids.length - 1) / 2) * 2.5 : 0, spec.cgH, 0);
      m.sync(s, 0);
      m.setEnv(null);
      m.setLights(night);
      scene.add(m.group);
      models.push(m);
      states.push(s);
    });

    const buildMs = performance.now() - t0;
    const target = new THREE.Vector3(0, 0.55, 0);
    const placeCam = (t: number) => {
      const r = all ? 17 : 7.2;
      const at = (az: number, el: number, rr = r) => camera.position.set(Math.sin(az) * rr, el, Math.cos(az) * rr);
      if (all && view !== "orbit") at(view === "rear" ? Math.PI - 0.3 : view === "side" ? 0.08 : 0.3, view === "side" ? 1.2 : 3.2);
      else if (view === "front") at(0.75, 1.6);
      else if (view === "nose") at(0, 0.8);
      else if (view === "tail") at(Math.PI, 0.9);
      else if (view === "rear") at(Math.PI - 0.75, 1.6);
      else if (view === "side") at(Math.PI / 2, 0.9);
      else if (view === "chase") at(Math.PI, 1.9, 6.2);
      else if (view === "top") at(0.3, 8, 3);
      else if (view === "low") at(0.5, 0.5, 5.2);
      else if (view === "wheel") at(1.2, 0.6, 3.2);
      else if (view === "rwheel") at(2.0, 0.6, 3.2);
      else at(t * 0.25, 1.5 + Math.sin(t * 0.3) * 0.6);
      camera.lookAt(view === "chase" ? target.clone().setY(0.9) : target);
    };

    let raf = 0, last = performance.now(), t = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;
      t += dt;
      if (anim)
        models.forEach((m, i) => {
          const s = states[i];
          s.speed = 8;
          s.brake = Math.sin(t) > 0.5 ? 1 : 0;
          s.gear = Math.sin(t * 0.5) < -0.8 ? -1 : 1;
          s.wheels.forEach((w, k) => {
            w.spin += dt * 20;
            w.steer = k < 2 ? Math.sin(t) * 0.45 : 0;
            w.compress = 0.4 + 0.25 * Math.sin(t * 2 + (k % 2) * Math.PI);
          });
          m.sync(s, dt);
        });
      placeCam(t);
      renderer.render(scene, camera);
    };
    loop();
    const resize = () => {
      renderer.setSize(innerWidth, innerHeight);
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
    };
    addEventListener("resize", resize);
    (window as unknown as { __garage: unknown }).__garage = { models, renderer, buildMs, calls: () => renderer.info.render.calls, tris: () => renderer.info.render.triangles };
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
      models.forEach((m) => m.dispose());
      mirror.dispose();
      envTex.dispose();
      pm.dispose();
      renderer.dispose();
    };
  }, []);
  return <canvas ref={ref} style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", display: "block" }} />;
}
