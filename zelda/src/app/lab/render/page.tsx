"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { FrameCtx, FxKind, Quality, Weather, World } from "../../contracts";
import { MAX_FRAME_DT, QUALITY } from "../../contracts";
import * as mock from "../../mock";
import { createRender, detectQuality } from "../../render";
import { detectPlatform, newInputState, newPlayerState, newQuest } from "../../state";

// Render lab: a test scene for the Look, sky, day/night, weather, particles and post. Deleted before commit.

const hill = (x: number, z: number) =>
  2 + 2.6 * Math.sin(x * 0.045) * Math.cos(z * 0.038) + 1.2 * Math.sin(x * 0.11 + z * 0.07) - 3 * Math.exp(-((x - 26) ** 2 + (z + 8) ** 2) / 260);

const WATER_FRAG = (glsl: string) => /* glsl */ `
${glsl}
varying vec3 vW;
void main() {
  vec3 n = normalize(vec3(sin(vW.x * 0.8 + uTime * 1.3) * 0.06, 1.0, cos(vW.z * 0.7 + uTime * 1.1) * 0.06));
  vec3 v = normalize(cameraPosition - vW);
  vec3 c = hmShade(vec3(0.24, 0.55, 0.55), n, vW, v);
  c += uSunColor * smoothstep(0.985, 0.99, dot(reflect(-uSunDir, n), v)) * 0.6;
  c = hmFog(c, length(cameraPosition - vW));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const WATER_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

type Lab = {
  setTime(h: number): void;
  setQuality(q: Quality): void;
  setWeather(w: Weather): void;
  setView(angle: number, radius: number, height: number): void;
  burst(k: FxKind): void;
  frames: number;
  stats(): unknown;
};

export default function RenderLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hour, setHour] = useState(7.5);
  const [freeze, setFreeze] = useState(true);
  const [q, setQ] = useState<Quality>("high");
  const [statText, setStatText] = useState("");
  const labRef = useRef<Lab | null>(null);
  const hourRef = useRef(hour);
  const freezeRef = useRef(freeze);
  hourRef.current = hour;
  freezeRef.current = freeze;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const platform = detectPlatform();
    const start = (new URLSearchParams(location.search).get("q") as Quality | null) ?? detectQuality(platform);
    const render = createRender(canvas, start);
    setQ(start);
    const { scene, look, camera } = render;
    const disposables: { dispose(): void }[] = [];
    const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

    // ground with vertex colors
    const gGeo = keep(new THREE.PlaneGeometry(260, 260, 130, 130));
    gGeo.rotateX(-Math.PI / 2);
    const pos = gGeo.getAttribute("position") as THREE.BufferAttribute;
    const cols = new Float32Array(pos.count * 3);
    const cGrass = new THREE.Color("#8fae5a"), cFar = new THREE.Color("#a9c26a"), cDirt = new THREE.Color("#9c7b55"), cSand = new THREE.Color("#e0cc98");
    const tc = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = hill(x, z);
      pos.setY(i, y);
      tc.copy(cGrass).lerp(cFar, 0.5 + 0.5 * Math.sin(x * 0.07 + z * 0.05));
      if (y < 1.2) tc.lerp(cSand, Math.min(1, (1.2 - y) * 2));
      if (Math.abs(x + z * 0.4 - 6) < 1.6) tc.copy(cDirt);
      cols.set([tc.r, tc.g, tc.b], i * 3);
    }
    gGeo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    gGeo.computeVertexNormals();
    const ground = new THREE.Mesh(gGeo, look.toon({ color: "#ffffff", vertexColors: true, rim: 0.1 }));
    ground.receiveShadow = true;
    scene.add(ground);

    // custom ShaderMaterial water using look.glsl
    const wGeo = keep(new THREE.PlaneGeometry(60, 60));
    wGeo.rotateX(-Math.PI / 2);
    const wMat = keep(new THREE.ShaderMaterial({ vertexShader: WATER_VERT, fragmentShader: WATER_FRAG(look.glsl), uniforms: { ...look.uniforms } }));
    const water = new THREE.Mesh(wGeo, wMat);
    water.position.set(26, 0.6, -8);
    scene.add(water);

    // the hero: cloak, tunic, head, hood, lantern
    const h0 = hill(0, 0);
    const hero = new THREE.Group();
    hero.position.set(0, h0, 0);
    const body = new THREE.Mesh(keep(new THREE.CapsuleGeometry(0.42, 0.9, 6, 14)), look.toon({ color: "#2f5f5a" }));
    body.position.y = 0.9;
    const tunic = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.36, 0.46, 0.5, 14)), look.toon({ color: "#c9a77a" }));
    tunic.position.y = 1.05;
    const head = new THREE.Mesh(keep(new THREE.SphereGeometry(0.3, 18, 14)), look.toon({ color: "#e6c4a0" }));
    head.position.y = 1.9;
    const hood = new THREE.Mesh(keep(new THREE.ConeGeometry(0.36, 0.6, 14)), look.toon({ color: "#2f5f5a" }));
    hood.position.y = 2.2;
    const lantern = new THREE.Mesh(keep(new THREE.SphereGeometry(0.11, 12, 10)), look.toon({ color: "#f08a3c", emissive: "#f08a3c", emissiveIntensity: 1.6 }));
    lantern.position.set(0.48, 0.95, 0.15);
    hero.add(body, tunic, head, hood, lantern);
    scene.add(hero);

    // spheres and boxes
    const shapes: [THREE.BufferGeometry, string, number, number, number][] = [
      [keep(new THREE.SphereGeometry(1.2, 32, 24)), "#c9a13b", -5, 1.2, 3],
      [keep(new THREE.SphereGeometry(0.9, 32, 24)), "#b8402b", -3, 0.9, -4],
      [keep(new THREE.SphereGeometry(1.5, 32, 24)), "#8fb9b3", 6, 1.5, 4],
      [keep(new THREE.BoxGeometry(2, 2, 2)), "#8d8473", 4, 1, -3],
      [keep(new THREE.BoxGeometry(1.2, 5, 1.2)), "#a89a82", -8, 2.5, -6],
      [keep(new THREE.BoxGeometry(1.2, 3.5, 1.2)), "#a89a82", -5, 1.75, -8],
      [keep(new THREE.BoxGeometry(5, 0.8, 1.4)), "#a89a82", -6.5, 5.2, -7],
      [keep(new THREE.TorusKnotGeometry(0.8, 0.28, 120, 16)), "#5b3a6e", 9, 2, -2],
    ];
    for (const [g, c, x, y, z] of shapes) {
      const m = new THREE.Mesh(g, look.toon({ color: c }));
      m.position.set(x, hill(x, z) + y - 0.1, z);
      scene.add(m);
    }
    // lantern post and a lit beacon (emissive for bloom), a gloam crystal
    const post = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.08, 0.1, 2.6, 8)), look.toon({ color: "#5a4a3a" }));
    post.position.set(2.5, hill(2.5, 2) + 1.3, 2);
    const flame = new THREE.Mesh(keep(new THREE.SphereGeometry(0.22, 14, 10)), look.toon({ color: "#ffc07a", emissive: "#f08a3c", emissiveIntensity: 2.2 }));
    flame.position.set(2.5, hill(2.5, 2) + 2.75, 2);
    const beacon = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.7, 1, 4, 8)), look.toon({ color: "#c9a13b" }));
    beacon.position.set(-14, hill(-14, 6) + 2, 6);
    const bFire = new THREE.Mesh(keep(new THREE.OctahedronGeometry(0.7)), look.toon({ color: "#ffd27a", emissive: "#f08a3c", emissiveIntensity: 2.5 }));
    bFire.position.set(-14, hill(-14, 6) + 4.8, 6);
    const crystal = new THREE.Mesh(keep(new THREE.OctahedronGeometry(0.8)), look.toon({ color: "#5b3a6e", emissive: "#a47cc6", emissiveIntensity: 1.2 }));
    crystal.position.set(10, hill(10, 7) + 1.2, 7);
    crystal.scale.y = 1.8;
    scene.add(post, flame, beacon, bFire, crystal);

    // instanced trees (instancing path of look.toon)
    const trunkGeo = keep(new THREE.CylinderGeometry(0.18, 0.28, 2, 7));
    trunkGeo.translate(0, 1, 0);
    const crownGeo = keep(new THREE.IcosahedronGeometry(1.6, 1));
    crownGeo.translate(0, 3.2, 0);
    const N = 70;
    const trunks = new THREE.InstancedMesh(trunkGeo, look.toon({ color: "#6b5236" }), N);
    const crowns = new THREE.InstancedMesh(crownGeo, look.toon({ color: "#6f9a46" }), N);
    const mtx = new THREE.Matrix4();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) {
      const a = rnd() * Math.PI * 2, r = 18 + rnd() * 90;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const s = 0.8 + rnd() * 0.9;
      mtx.makeScale(s, s, s).setPosition(x, hill(x, z) - 0.1, z);
      trunks.setMatrixAt(i, mtx);
      crowns.setMatrixAt(i, mtx);
      crowns.setColorAt(i, tc.set(["#4f7a3a", "#6f9a46", "#8fae4c"][i % 3]));
    }
    scene.add(trunks, crowns);
    // distant mountains for fog
    const mtnGeo = keep(new THREE.ConeGeometry(60, 90, 9));
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3, r = 260 + (i % 3) * 90;
      const m = new THREE.Mesh(mtnGeo, look.toon({ color: i % 2 ? "#8d8473" : "#6b625a" }));
      m.position.set(Math.cos(a) * r, 30, Math.sin(a) * r);
      m.scale.setScalar(0.7 + (i % 4) * 0.25);
      scene.add(m);
    }

    // frame context
    const baseWorld = mock.createWorld(1337);
    const world: World = { ...baseWorld, heightAt: hill };
    const player = newPlayerState();
    player.pos.set(0, h0, 0);
    const lanternWorld = new THREE.Vector3();
    const ctx: FrameCtx = {
      dt: 0, realDt: 0, time: 0, world, input: newInputState(), player, enemies: [], env: render.env, quest: newQuest(), camera,
      cameraYaw: 0, combat: { strike() {}, shoot() {} }, fx: render.fx, quality: QUALITY[start],
    };
    const view = { angle: 0.6, radius: 13, height: 4.5, orbit: false };
    const lab: Lab = {
      setTime: (h) => setHour(h),
      setQuality: (nq) => {
        render.setQuality(nq);
        ctx.quality = QUALITY[nq];
        setQ(nq);
      },
      setWeather: (w) => render.setWeather(w),
      setView: (a, r, h) => Object.assign(view, { angle: a, radius: r, height: h, orbit: false }),
      burst: (k) => {
        const p = { x: 0, y: h0 + 1.2, z: 0 };
        render.fx.burst(k, p, 30, { x: 0, y: 1, z: 0 });
      },
      frames: 0,
      stats: () => ({ ...render.stats(), particles: render.particles(), quality: render.quality, env: { ...render.env } }),
    };
    labRef.current = lab;
    (window as unknown as { __lab?: Lab; __render?: unknown }).__lab = lab;
    (window as unknown as { __render?: unknown }).__render = render;
    render.setDynamicRes(true, platform.targetFps);
    render.resize();

    let raf = 0, last = performance.now(), statAcc = 0, swingT = 0;
    const tip = { x: 0, y: 0, z: 0 };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const realDt = Math.min(MAX_FRAME_DT, (now - last) / 1000);
      last = now;
      ctx.realDt = realDt;
      ctx.dt = realDt;
      ctx.time += realDt;
      if (freezeRef.current) render.setTime(hourRef.current);
      if (view.orbit) view.angle += realDt * 0.15;
      camera.position.set(Math.sin(view.angle) * view.radius, h0 + view.height, Math.cos(view.angle) * view.radius);
      camera.lookAt(0, h0 + 1.4, 0);
      lantern.getWorldPosition(lanternWorld);
      player.lanternPos.copy(lanternWorld);
      crystal.rotation.y += realDt * 0.6;
      // sword trail demo: an arc in front of the hero every 1.5 s
      swingT += realDt;
      const st = swingT % 1.5;
      const on = st < 0.25;
      const a = -1.2 + (st / 0.25) * 2.4;
      tip.x = Math.sin(a) * 1.4 + 0.2; tip.y = h0 + 1.2 + Math.cos(a) * 0.5; tip.z = Math.cos(a) * 0.9 + 0.6;
      render.fx.trail(0, tip, on);
      const evs = render.update(ctx);
      render.handle(evs);
      render.render(ctx);
      lab.frames++;
      statAcc += realDt;
      if (statAcc > 0.25) {
        statAcc = 0;
        const s = render.stats();
        const e = render.env;
        setStatText(
          `${s.fps.toFixed(0)} fps  ${s.ms.toFixed(1)} ms  scale ${s.scale.toFixed(2)}  calls ${s.calls}  tris ${(s.tris / 1000).toFixed(0)}k  ` +
            `fx ${render.particles()}  |  ${e.timeOfDay.toFixed(2)}h  day ${e.daylight.toFixed(2)}  ${e.weather} rain ${e.rain.toFixed(2)} wet ${e.wet.toFixed(2)}`,
        );
        if (!freezeRef.current) setHour(Math.round(e.timeOfDay * 100) / 100);
      }
    };
    raf = requestAnimationFrame(loop);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "o") view.orbit = !view.orbit;
    };
    window.addEventListener("keydown", onKey);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      delete (window as unknown as { __lab?: Lab }).__lab;
      delete (window as unknown as { __render?: unknown }).__render;
      baseWorld.dispose?.();
      for (const d of disposables) d.dispose();
      render.dispose();
    };
  }, []);

  const btn = (on: boolean): React.CSSProperties => ({
    padding: "4px 8px", border: "1px solid #2b2118", background: on ? "#2b2118" : "#efe3c8", color: on ? "#efe3c8" : "#2b2118",
    font: "12px sans-serif", cursor: "pointer",
  });
  return (
    <div style={{ position: "fixed", inset: 0, background: "#08191c" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      <div style={{ position: "absolute", left: 10, top: 10, display: "flex", flexDirection: "column", gap: 6, background: "rgba(239,227,200,.85)", padding: 8, font: "12px sans-serif", color: "#2b2118", maxWidth: 560 }}>
        <div id="stats">{statText}</div>
        <label>
          time {hour.toFixed(2)}h{" "}
          <input id="time" type="range" min={0} max={24} step={0.05} value={hour} onChange={(e) => setHour(Number(e.target.value))} style={{ width: 260 }} />{" "}
          <input type="checkbox" checked={freeze} onChange={(e) => setFreeze(e.target.checked)} /> freeze
        </label>
        <div style={{ display: "flex", gap: 4 }}>
          {(["low", "medium", "high", "ultra"] as Quality[]).map((x) => (
            <button key={x} style={btn(q === x)} onClick={() => labRef.current?.setQuality(x)}>{x}</button>
          ))}
          {(["clear", "cloudy", "rain", "storm"] as Weather[]).map((w) => (
            <button key={w} style={btn(false)} onClick={() => labRef.current?.setWeather(w)}>{w}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {(["dust", "spark", "leaf", "splash", "ember", "glimmer", "gloam", "heal", "blood-sap", "beacon"] as FxKind[]).map((k) => (
            <button key={k} style={btn(false)} onClick={() => labRef.current?.burst(k)}>{k}</button>
          ))}
        </div>
        <div>press o to orbit</div>
      </div>
    </div>
  );
}
