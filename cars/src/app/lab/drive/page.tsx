"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { CamMode, CarId, CarSpec, GameEvent, MapData, Quality, TrackFrame, VehicleState } from "../../contracts";
import { CARS } from "../../cars";
import { createVehicle, collideCars, setWet, type VehicleBody } from "../../vehicle";
import { createInput } from "../../input";
import { createCameraRig } from "../../camera";
import { createTrack } from "../../track";
import { createTrackMesh } from "../../track-mesh";
import { mockMap } from "../mock-map";
import { createPilot } from "./pilot";

const DT = 1 / 120;
const SNAPS = 300;

function carBox(spec: CarSpec, color: string) {
  const b = spec.body;
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(b.width * 0.86, b.height - b.rideH - 0.25, b.length),
    new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.3 }),
  );
  body.position.y = b.rideH + (b.height - b.rideH - 0.25) / 2 - spec.cgH;
  body.castShadow = true;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(b.width * 0.8, 0.3, b.length * 0.45), new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.1 }));
  cabin.position.set(0, b.height - 0.15 - spec.cgH, -b.length * 0.05);
  g.add(body, cabin);
  const a = b.wheelbase * (1 - spec.frontW);
  const r = b.wheelbase * spec.frontW;
  const wheels: THREE.Object3D[] = [];
  const geo = new THREE.CylinderGeometry(b.wheelR, b.wheelR, spec.tire.width * 1.1, 18);
  geo.rotateZ(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  const rim = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, metalness: 0.8, roughness: 0.3 });
  for (let i = 0; i < 4; i++) {
    const hub = new THREE.Group();
    const tr = i < 2 ? b.trackF : b.trackR;
    hub.position.set(i % 2 === 0 ? tr / 2 : -tr / 2, 0, i < 2 ? a : -r);
    const w = new THREE.Mesh(geo, mat);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(spec.tire.width * 1.15, b.wheelR * 1.6, 0.08), rim);
    w.add(spoke);
    w.castShadow = true;
    hub.add(w);
    g.add(hub);
    wheels.push(hub);
  }
  const sync = (s: VehicleState) => {
    g.position.copy(s.pos);
    g.quaternion.copy(s.quat);
    for (let i = 0; i < 4; i++) {
      const w = s.wheels[i];
      wheels[i].position.y = b.wheelR - spec.cgH - spec.susp.travel * 0.45 + w.compress * spec.susp.travel;
      wheels[i].rotation.y = w.steer;
      wheels[i].children[0].rotation.x = w.spin;
    }
  };
  return { g, sync };
}

type Handle = {
  state: () => VehicleState;
  spec: () => CarSpec;
  events: { t: number; e: GameEvent }[];
  time: () => number;
  setCar: (id: CarId) => void;
  auto: (mode: "off" | "lap", speed?: number) => void;
  place: (s: number, lat?: number) => void;
  steepest: () => number;
  straight: () => number;
  assists: (on: boolean) => void;
  stats: () => { fps: number; physMs: number; cars: number };
  track: () => { length: number };
  wet: (w: number) => void;
  aim: (look: number) => { ang: number; lat: number; speed: number };
};

export default function DriveLab() {
  const host = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    const q = (qs.get("q") as Quality) || "medium";
    let alive = true;
    let cleanup = () => {};
    (async () => {
      const mapId = qs.get("map");
      let map: MapData = mockMap();
      if (mapId && mapId !== "mock") map = await import(`../../maps/${mapId}.ts`).then((m: { MAP: MapData }) => m.MAP).catch(() => mockMap());
      if (!alive) return;
      const track = createTrack(map);
      const el = host.current!;
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(2, devicePixelRatio));
      renderer.setSize(el.clientWidth, el.clientHeight);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.shadowMap.enabled = true;
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x9fb6cc);
      scene.fog = new THREE.Fog(0x9fb6cc, 200, 3000);
      scene.add(new THREE.HemisphereLight(0xbcd2ec, 0x5a5040, 1.1));
      const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = sun.shadow.camera.bottom = -60;
      sun.shadow.camera.right = sun.shadow.camera.top = 60;
      sun.shadow.camera.far = 1200;
      sun.shadow.normalBias = 0.3;
      scene.add(sun, sun.target);
      const mesh = createTrackMesh(track, q);
      scene.add(mesh.group);
      const camera = new THREE.PerspectiveCamera(60, el.clientWidth / el.clientHeight, 0.1, 8000);
      const rig = createCameraRig(camera, track);
      const input = createInput(renderer.domElement);

      const n = Math.max(1, Math.min(12, +(qs.get("n") || 1)));
      let cars: VehicleBody[] = [];
      let boxes: ReturnType<typeof carBox>[] = [];
      const pilots = Array.from({ length: n }, () => createPilot(track));
      const snaps = Array.from({ length: SNAPS }, () => new Float32Array(64));
      let head = 0;
      let count = 0;
      let snapT = 0;
      let autoMode: "off" | "lap" = "off";
      let autoSpeed = 0;
      let simT = 0;
      const events: { t: number; e: GameEvent }[] = [];
      const fr: TrackFrame = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3(), width: 0, runoff: 0 };
      const tmp = new THREE.Vector3();

      const setCar = (id: CarId) => {
        for (const b of boxes) scene.remove(b.g);
        const spec = CARS.find((c) => c.id === id) ?? CARS[0];
        cars = [];
        boxes = [];
        for (let i = 0; i < n; i++) {
          const sp = i === 0 ? spec : CARS[i % CARS.length];
          const v = createVehicle(sp, track, i);
          const g = track.grid[i % track.grid.length];
          v.place(g.pos, g.yaw, g.s);
          cars.push(v);
          const box = carBox(sp, sp.paints[0]);
          scene.add(box.g);
          boxes.push(box);
        }
        count = 0;
        rig.cut();
      };
      setCar((qs.get("car") as CarId) || "jdm");

      const prevVel = new THREE.Vector3();
      const acc = new THREE.Vector3();
      const gs = new THREE.Vector3();
      let physMs = 0;
      const push = (e: GameEvent) => {
        events.push({ t: simT, e });
        if (e.type === "shake") rig.shake(e.strength);
      };
      const step = (dt: number) => {
        const t0 = performance.now();
        const me = cars[0];
        const c = input.read(dt, me.state.speed);
        if (input.pressed("camera")) rig.cycle();
        if (input.pressed("reset")) {
          me.resetToTrack();
          rig.cut();
        }
        const rewinding = input.held("rewind") && count > 0;
        if (rewinding) {
          head = (head - 1 + SNAPS) % SNAPS;
          count--;
          me.load(snaps[head]);
          rig.cut();
        } else {
          let k = Math.round(dt / DT);
          while (k-- > 0) {
            for (let i = 0; i < cars.length; i++) {
              const ctl = i === 0 && autoMode === "off" ? c : pilots[i].drive(cars[i].state, autoSpeed > 0 && i === 0 ? autoSpeed : (s) => track.speed[Math.floor(track.wrap(s)) % track.speed.length] * 0.8);
              for (const e of cars[i].step(DT, ctl)) if (i === 0) push(e);
            }
            if (cars.length > 1) for (const e of collideCars(cars)) push(e);
            simT += DT;
          }
          snapT += dt;
          if (snapT >= 1 / 30) {
            snapT = 0;
            me.snap(snaps[head]);
            head = (head + 1) % SNAPS;
            count = Math.min(SNAPS, count + 1);
          }
        }
        if (events.length > 200) events.splice(0, events.length - 200);
        acc.subVectors(me.state.vel, prevVel).divideScalar(dt);
        prevVel.copy(me.state.vel);
        gs.lerp(tmp.copy(acc).applyQuaternion(tmp2.copy(me.state.quat).invert()), 0.1);
        physMs = physMs * 0.95 + (performance.now() - t0) * 0.05;
      };
      const tmp2 = new THREE.Quaternion();

      const handle: Handle = {
        state: () => cars[0].state,
        spec: () => cars[0].spec,
        events,
        time: () => simT,
        setCar,
        auto: (m, sp = 0) => {
          autoMode = m;
          autoSpeed = sp;
        },
        place: (s, lat = 0) => {
          track.frame(s, fr);
          tmp.copy(fr.pos).addScaledVector(fr.left, lat);
          cars[0].place(tmp, Math.atan2(fr.fwd.x, fr.fwd.z), s);
          rig.cut();
        },
        steepest: () => {
          let best = 0;
          let at = 0;
          for (let s = 0; s < track.length; s += 5) {
            track.frame(s, fr);
            if (Math.abs(fr.fwd.y) > best) {
              best = Math.abs(fr.fwd.y);
              at = s;
            }
          }
          return at;
        },
        straight: () => {
          let best = 0;
          let at = 0;
          const f0 = new THREE.Vector3();
          for (let s = 0; s < track.length; s += 10) {
            track.frame(s, fr);
            f0.copy(fr.fwd);
            let k = 0;
            for (; k < 700; k += 10) {
              track.frame(s + k, fr);
              if (f0.dot(fr.fwd) < 0.995 || Math.abs(fr.fwd.y) > 0.025 || (!track.closed && s + k > track.length)) break;
            }
            if (k > best) {
              best = k;
              at = s;
            }
          }
          return at;
        },
        assists: (on) => {
          cars[0].assists = { abs: on, tcs: on, stability: on, autoGear: true, steer: on };
        },
        stats: () => ({ fps, physMs, cars: cars.length }),
        track: () => ({ length: track.length }),
        aim: (look) => {
          const s = cars[0].state;
          track.frame(track.wrap(s.s + look), fr);
          tmp.copy(fr.pos).sub(s.pos);
          const f = new THREE.Vector3(0, 0, 1).applyQuaternion(s.quat);
          const l = new THREE.Vector3(1, 0, 0).applyQuaternion(s.quat);
          let v = 99;
          for (let k = 0; k <= 150; k += 10) v = Math.min(v, Math.sqrt(track.speed[Math.floor(track.wrap(s.s + k))] ** 2 + 2 * 6 * k));
          return { ang: Math.atan2(tmp.dot(l), tmp.dot(f)), lat: s.lateral, speed: v };
        },
        wet: (w) => {
          setWet(w);
          mesh.setWet(w);
        },
      };
      if (process.env.NODE_ENV !== "production") (window as unknown as { __lab: Handle }).__lab = handle;

      const onResize = () => {
        renderer.setSize(el.clientWidth, el.clientHeight);
        camera.aspect = el.clientWidth / el.clientHeight;
        camera.updateProjectionMatrix();
      };
      addEventListener("resize", onResize);
      let last = performance.now();
      let fps = 60;
      let hudT = 0;
      let fixed = 0;
      let raf = 0;
      const loop = () => {
        raf = requestAnimationFrame(loop);
        const now = performance.now();
        const dt = Math.min(1 / 30, (now - last) / 1000);
        last = now;
        fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
        fixed += dt;
        const steps = Math.floor(fixed / DT);
        if (steps > 0) {
          fixed -= steps * DT;
          step(steps * DT);
        }
        for (let i = 0; i < cars.length; i++) boxes[i].sync(cars[i].state);
        const me = cars[0];
        rig.update(dt, me.state, me.spec, input.look(), input.held("lookBack"));
        sun.position.set(me.state.pos.x - 120, me.state.pos.y + 200, me.state.pos.z - 90);
        sun.target.position.copy(me.state.pos);
        renderer.render(scene, camera);
        hudT += dt;
        if (hudT > 0.1 && hud.current) {
          hudT = 0;
          const s = me.state;
          const w = s.wheels.map((x, i) => `${["FL", "FR", "RL", "RR"][i]} ${String(Math.round(x.load)).padStart(5)}N  k ${x.slipRatio.toFixed(2).padStart(5)}  a ${(x.slipAngle * 57.3).toFixed(1).padStart(5)}°  ${x.surface}${x.skid > 0.05 ? " skid " + x.skid.toFixed(1) : ""}`);
          const recent = events.slice(-5).map((x) => `${x.t.toFixed(1)} ${x.e.type}${"name" in x.e ? " " + x.e.name : ""}${"speed" in x.e ? " " + x.e.speed.toFixed(1) + "m/s" : ""}`);
          hud.current.textContent = [
            `${me.spec.name}  ${(Math.abs(s.speed) * 3.6).toFixed(0)} km/h  ${s.gear < 0 ? "R" : s.gear === 0 ? "N" : s.gear}  ${Math.round(s.rpm)} rpm${s.limiter ? " LIMIT" : ""}${s.shifting ? " shift" : ""}`,
            `thr ${s.throttle.toFixed(2)}  brk ${s.brake.toFixed(2)}  boost ${s.boost.toFixed(2)}  ${s.airborne ? "AIR " : ""}${s.onRoad ? "road" : "off"}`,
            `g  long ${(gs.z / 9.81).toFixed(2)}  lat ${(gs.x / 9.81).toFixed(2)}  vert ${(gs.y / 9.81).toFixed(2)}`,
            ...w,
            `cam ${rig.mode as CamMode}  dev ${input.device}  fps ${fps.toFixed(0)}  phys ${physMs.toFixed(2)} ms × ${cars.length}`,
            ...recent,
          ].join("\n");
        }
      };
      loop();
      cleanup = () => {
        cancelAnimationFrame(raf);
        removeEventListener("resize", onResize);
        input.dispose();
        mesh.dispose();
        renderer.dispose();
        el.removeChild(renderer.domElement);
      };
    })();
    return () => {
      alive = false;
      cleanup();
    };
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000" }}>
      <div ref={host} style={{ position: "absolute", inset: 0 }} />
      <pre ref={hud} style={{ position: "absolute", left: 12, top: 12, margin: 0, padding: 10, font: "12px/1.4 ui-monospace, monospace", color: "#e8f0f8", background: "rgba(0,0,0,0.55)", borderRadius: 6, pointerEvents: "none" }} />
    </div>
  );
}
