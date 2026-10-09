"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { GroundHit, MapData, MapId, Quality, TrackFrame } from "../../contracts";
import { createTrack } from "../../track";
import { createTrackMesh } from "../../track-mesh";
import { mockMap } from "../mock-map";

function skyEnv(renderer: THREE.WebGLRenderer) {
  const sc = new THREE.Scene();
  const geo = new THREE.SphereGeometry(100, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader:
      "varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = mix(vec3(0.55,0.62,0.66), vec3(0.32,0.5,0.8), smoothstep(0.0,0.6,h)); c = mix(c, vec3(0.25,0.24,0.22), smoothstep(0.0,-0.2,h)); c += vec3(6.0,5.0,3.6) * pow(max(0.0, dot(normalize(vP), normalize(vec3(-0.5,0.35,-0.6)))), 400.0); gl_FragColor = vec4(c,1.0); }",
  });
  sc.add(new THREE.Mesh(geo, mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(sc, 0.02);
  geo.dispose();
  mat.dispose();
  pm.dispose();
  return rt;
}

export default function TrackLab() {
  const host = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState("loading");
  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    const mapId = qs.get("map");
    const q = (qs.get("q") as Quality) || "high";
    const fly = qs.get("fly") === "1";
    let debug = qs.get("debug") !== "0";
    let alive = true;
    let cleanup = () => {};
    (async () => {
      let map: MapData = mockMap();
      if (mapId && mapId !== "mock") {
        // Some generated maps still say `waterY: auto`; a global keeps them loadable in the lab.
        (globalThis as unknown as { auto: number }).auto ??= 0;
        // Template import: only the map files that exist get bundled, so the lab works while maps arrive.
        map = await import(`../../maps/${mapId}.ts`).then((m: { MAP: MapData }) => m.MAP).catch(() => mockMap());
      }
      if (qs.get("style")) map = { ...map, id: qs.get("style") as MapId };
      if (qs.get("season")) map = { ...map, env: { ...map.env, season: qs.get("season") as MapData["env"]["season"] } };
      if (!alive) return;
      const t0 = performance.now();
      const track = createTrack(map);
      const t1 = performance.now();
      const el = host.current!;
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(2, devicePixelRatio));
      renderer.setSize(el.clientWidth, el.clientHeight);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x9fb6cc);
      scene.fog = new THREE.Fog(0x9fb6cc, 300, 5000);
      const env = skyEnv(renderer);
      scene.environment = env.texture;
      scene.add(new THREE.HemisphereLight(0xbcd2ec, 0x5a5040, 0.9));
      const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = sun.shadow.camera.bottom = -120;
      sun.shadow.camera.right = sun.shadow.camera.top = 120;
      sun.shadow.camera.far = 1500;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.4;
      scene.add(sun, sun.target);
      const t2 = performance.now();
      const mesh = createTrackMesh(track, q);
      const t3 = performance.now();
      scene.add(mesh.group);
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1d4660, roughness: 0.15 }));
      sea.position.y = Number.isFinite(map.waterY) ? map.waterY : 0;
      scene.add(sea);
      mesh.setWet(+(qs.get("wet") || 0));

      const dbg = new THREE.Group();
      const lp: number[] = [], lc: number[] = [];
      const f: TrackFrame = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3(), width: 0, runoff: 0 };
      for (let s = 0; s < track.length; s += 2) {
        track.frame(s, f);
        const i = Math.min(track.line.length - 1, Math.floor(s));
        const p = f.pos.clone().addScaledVector(f.left, track.line[i]).addScaledVector(f.up, 0.15);
        lp.push(p.x, p.y, p.z);
        const v = Math.min(1, track.speed[i] / 80);
        lc.push(1 - v, v, 0.1);
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));
      lg.setAttribute("color", new THREE.Float32BufferAttribute(lc, 3));
      dbg.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ vertexColors: true })));
      for (const c of track.checkpoints) {
        track.frame(c, f);
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.3, 8, 0.3), new THREE.MeshBasicMaterial({ color: c === track.checkpoints[0] ? 0xffffff : 0x22ccff }));
        pole.position.copy(f.pos).addScaledVector(f.left, f.width / 2 + 1).y += 4;
        dbg.add(pole);
      }
      for (const g of track.grid) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.2, 4.4), new THREE.MeshBasicMaterial({ color: 0xff3366, wireframe: true }));
        m.position.copy(g.pos).y += 0.6;
        m.rotation.y = g.yaw;
        dbg.add(m);
      }
      dbg.visible = debug;
      scene.add(dbg);

      // ground() against the rendered road surface.
      // Ray against the two triangle rows around s, found through uv.y = s.
      const road = mesh.group.getObjectByName("road") as THREE.Mesh;
      const rg = road.geometry, rp = rg.attributes.position, ruv = rg.attributes.uv;
      let per = 1;
      while (ruv.getY(per) === ruv.getY(0)) per++;
      const nRows = ruv.count / per;
      const ray = new THREE.Ray();
      const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3(), out = new THREE.Vector3();
      const rayRoad = (x: number, y: number, z: number, s: number) => {
        let lo = 0, hi = nRows - 1;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (ruv.getY(mid * per) <= s) lo = mid;
          else hi = mid;
        }
        ray.set(new THREE.Vector3(x, y + 3, z), new THREE.Vector3(0, -1, 0));
        for (let r = Math.max(0, lo - 1); r <= Math.min(nRows - 2, lo + 1); r++)
          for (let c = 0; c < per - 1; c++) {
            const a = r * per + c, b = a + 1, c2 = a + per, d = c2 + 1;
            A.fromBufferAttribute(rp, a); B.fromBufferAttribute(rp, b); C.fromBufferAttribute(rp, c2); D.fromBufferAttribute(rp, d);
            if (ray.intersectTriangle(A, B, C, false, out) || ray.intersectTriangle(B, D, C, false, out)) return out.y;
          }
        return null;
      };
      const hit: GroundHit = { y: 0, normal: new THREE.Vector3(), surface: "asphalt", grip: 1, s: 0, lateral: 0, onRoad: true, tunnel: false };
      let maxErr = 0, sumErr = 0, nErr = 0, miss = 0;
      const samples: [number, number, number, number][] = [];
      for (let k = 0; k < 2000; k++) {
        const s = Math.random() * track.length;
        track.frame(s, f);
        const l = (Math.random() * 2 - 1) * (f.width / 2) * 0.95;
        const p = f.pos.clone().addScaledVector(f.left, l);
        samples.push([p.x, p.y, p.z, s]);
        const ry = rayRoad(p.x, p.y, p.z, s);
        if (ry === null) { miss++; continue; }
        track.ground(p.x, p.y + 0.5, p.z, s, hit);
        const e = Math.abs(hit.y - ry);
        maxErr = Math.max(maxErr, e);
        sumErr += e;
        nErr++;
      }
      const tg = performance.now();
      let calls = 0;
      for (let r = 0; r < 50; r++) for (const [x, y, z, s] of samples) { track.ground(x, y, z, s, hit); calls++; }
      const perMs = calls / (performance.now() - tg);
      const tg2 = performance.now();
      for (const [x, y, z] of samples) track.ground(x + 30, y, z + 30, -1, hit);
      const offMs = samples.length / (performance.now() - tg2);
      const stats = {
        map: map.id, name: map.name, length: Math.round(track.length), trackMs: Math.round(t1 - t0), meshMs: Math.round(t3 - t2),
        maxErrCm: +(maxErr * 100).toFixed(2), meanErrCm: +((sumErr / Math.max(1, nErr)) * 100).toFixed(3), miss,
        groundPerMs: Math.round(perMs), globalPerMs: Math.round(offMs),
      };
      (window as unknown as { __track: unknown }).__track = { stats, track, mesh, scene };

      const camera = new THREE.PerspectiveCamera(60, el.clientWidth / el.clientHeight, 0.1, 12000);
      const controls = new OrbitControls(camera, renderer.domElement);
      const cam = qs.get("cam")?.split(",").map(Number);
      const at = qs.get("at")?.split(",").map(Number);
      let flyS = +(qs.get("s") || 0);
      const flyV = +(qs.get("v") || 30);
      if (cam && at) {
        camera.position.set(cam[0], cam[1], cam[2]);
        controls.target.set(at[0], at[1], at[2]);
      } else {
        track.frame(flyS, f);
        controls.target.copy(f.pos);
        const off = (qs.get("off") || "40,30,50").split(",").map(Number);
        camera.position.copy(f.pos).addScaledVector(f.left, off[0]).add(new THREE.Vector3(0, off[1], 0)).addScaledVector(f.fwd, -off[2]);
      }
      controls.update();
      let cur = q;
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "d") dbg.visible = debug = !debug;
        if (e.key === "q") {
          const order: Quality[] = ["low", "medium", "high", "ultra"];
          const next = order[(order.indexOf(cur) + 1) % 4];
          cur = next;
          mesh.setQuality(next);
        }
      };
      addEventListener("keydown", onKey);
      const onResize = () => {
        renderer.setSize(el.clientWidth, el.clientHeight);
        camera.aspect = el.clientWidth / el.clientHeight;
        camera.updateProjectionMatrix();
      };
      addEventListener("resize", onResize);
      const look = new THREE.Vector3();
      let last = performance.now(), fps = 0, frames = 0, acc = 0, raf = 0;
      const loop = () => {
        raf = requestAnimationFrame(loop);
        const now = performance.now();
        const dt = Math.min(1 / 30, (now - last) / 1000);
        last = now;
        if (fly) {
          flyS = track.wrap(flyS + flyV * dt);
          track.frame(flyS, f);
          const i = Math.min(track.line.length - 1, Math.floor(flyS));
          camera.position.copy(f.pos).addScaledVector(f.left, track.line[i]).addScaledVector(f.up, 1.15);
          track.frame(flyS + 25, f);
          look.copy(f.pos).addScaledVector(f.left, track.line[Math.min(track.line.length - 1, Math.floor(track.wrap(flyS + 25)))]).addScaledVector(f.up, 0.8);
          camera.lookAt(look);
        } else controls.update();
        const fo = fly ? camera.position : controls.target;
        sun.position.set(fo.x - 300, fo.y + 400, fo.z - 350);
        sun.target.position.copy(fo);
        renderer.render(scene, camera);
        frames++;
        acc += dt;
        if (acc > 0.5) {
          fps = frames / acc;
          frames = 0;
          acc = 0;
          setInfo(JSON.stringify({ ...stats, fps: Math.round(fps), calls: renderer.info.render.calls, tris: renderer.info.render.triangles, s: Math.round(flyS) }));
        }
      };
      loop();
      const done = () => {
        cancelAnimationFrame(raf);
        removeEventListener("keydown", onKey);
        removeEventListener("resize", onResize);
        controls.dispose();
        mesh.dispose();
        env.dispose();
        sea.geometry.dispose();
        (sea.material as THREE.Material).dispose();
        dbg.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
          if (m.material) (m.material as THREE.Material).dispose();
        });
        renderer.dispose();
        renderer.domElement.remove();
      };
      cleanup = done;
      if (!alive) done();
    })();
    return () => {
      alive = false;
      cleanup();
    };
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000" }}>
      <div ref={host} style={{ position: "absolute", inset: 0 }} />
      <div id="info" style={{ position: "absolute", left: 8, top: 8, right: 8, color: "#fff", font: "12px monospace", textShadow: "0 1px 2px #000", pointerEvents: "none", wordBreak: "break-all" }}>
        {info} · ?map= ?q= ?fly=1 ?wet= ?season= ?style= · d: debug · q: quality
      </div>
    </div>
  );
}
