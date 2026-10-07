import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { createCity, type Box } from "./city";
import { createHero, SUITS, type HeroPose, type SuitName } from "./hero";
import { createAudio, type MusicState } from "./audio";
import { createMissions, type MissionEvent, type MissionHud } from "./missions";

export type Quality = "low" | "medium" | "high";

export const QUALITIES: Record<Quality, { label: string; detail: string; pixelRatio: number; shadow: number; range: number; bloom: boolean; snow: number; cars: number; fog: number; env: boolean }> = {
  low: { label: "Performance", detail: "No shadows, short view, high frame rate", pixelRatio: 0.75, shadow: 0, range: 0, bloom: false, snow: 0, cars: 80, fog: 650, env: false },
  medium: { label: "Balanced", detail: "Shadows, snow, reflections", pixelRatio: 1, shadow: 1024, range: 110, bloom: false, snow: 3000, cars: 180, fog: 1100, env: true },
  high: { label: "Fidelity", detail: "Sharp shadows, bloom, heavy snow, far view", pixelRatio: 2, shadow: 4096, range: 200, bloom: true, snow: 10000, cars: 320, fog: 1800, env: true },
};

export type Stats = {
  speed: number; height: number; fps: number; playing: boolean; mode: string; quality: Quality; suit: SuitName; muted: boolean;
  x: number; z: number; heading: number; prompt: string | null; combo: number; hud: MissionHud;
};
export type UiEvent = { type: "toast"; title: string; text?: string } | { type: "xp"; amount: number; reason: string };

type Mode = "ground" | "air" | "swing" | "wall" | "zip";

const G = 24;
const R = 0.95;
const RUN = 11;
const SPRINT = 20;
const JUMP = 11;
const CLIMB = 15;
const ZIP = 70;
const MAX_SPEED = 75;
const MAX_SNOW = 10000;
const UP = new THREE.Vector3(0, 1, 0);

function rayBox(o: THREE.Vector3, d: THREE.Vector3, b: Box) {
  let tmin = -Infinity;
  let tmax = Infinity;
  let axis = 0;
  const lo = [b.minX, 0, b.minZ];
  const hi = [b.maxX, b.maxY, b.maxZ];
  const oo = [o.x, o.y, o.z];
  const dd = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dd[i]) < 1e-9) {
      if (oo[i] < lo[i] || oo[i] > hi[i]) return null;
      continue;
    }
    let t1 = (lo[i] - oo[i]) / dd[i];
    let t2 = (hi[i] - oo[i]) / dd[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) {
      tmin = t1;
      axis = i;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmin < 0) return null;
  const n = new THREE.Vector3();
  n.setComponent(axis, dd[axis] > 0 ? -1 : 1);
  return { t: tmin, n };
}

export function startGame(canvas: HTMLCanvasElement, onStats: (s: Stats) => void, onEvent: (e: UiEvent) => void, initial: Quality, initialSuit: SuitName) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.75;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(68, 1, 0.1, 2000);

  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(88.5), THREE.MathUtils.degToRad(215));
  const sky = new Sky();
  sky.scale.setScalar(10000);
  const su = sky.material.uniforms;
  su.turbidity.value = 10;
  su.rayleigh.value = 3.2;
  su.mieCoefficient.value = 0.01;
  su.mieDirectionalG.value = 0.86;
  su.cloudCoverage.value = 0.45;
  su.sunPosition.value.copy(sunDir);
  scene.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene();
  const skyCopy = new Sky();
  skyCopy.scale.setScalar(10000);
  Object.assign(skyCopy.material.uniforms.sunPosition.value, sunDir);
  for (const k of ["turbidity", "rayleigh", "mieCoefficient", "mieDirectionalG", "cloudCoverage"]) skyCopy.material.uniforms[k].value = su[k].value;
  skyScene.add(skyCopy);
  const envMap = pmrem.fromScene(skyScene).texture;
  scene.environmentIntensity = 0.7;

  scene.fog = new THREE.Fog("#b98a86", 120, 1100);
  scene.add(new THREE.HemisphereLight("#ffd7c2", "#2e3048", 0.9));
  const sun = new THREE.DirectionalLight("#ffb27a", 3.2);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.06;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 1400;
  scene.add(sun, sun.target);

  const city = createCity();
  scene.add(city.group);
  const hero = createHero();
  scene.add(hero.root);

  const web = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 5).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: "#f4f6ff" }));
  web.visible = false;
  scene.add(web);

  const snowPos = new Float32Array(MAX_SNOW * 3);
  for (let i = 0; i < MAX_SNOW; i++) snowPos.set([(Math.random() - 0.5) * 120, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 120], i * 3);
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute("position", new THREE.BufferAttribute(snowPos, 3));
  const flake = document.createElement("canvas");
  flake.width = flake.height = 32;
  const fg = flake.getContext("2d")!;
  const grad = fg.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  fg.fillStyle = grad;
  fg.fillRect(0, 0, 32, 32);
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ size: 0.18, map: new THREE.CanvasTexture(flake), transparent: true, depthWrite: false, opacity: 0.9 }));
  snow.frustumCulled = false;
  scene.add(snow);

  const missions = createMissions(scene, city);
  hero.setSuit(initialSuit);
  let suit = initialSuit;

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.55, 0.95);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const start = city.roofSpots.reduce((a, b) => (b.y > 25 && b.y < 70 && Math.hypot(b.x - 60, b.z - 160) < Math.hypot(a.x - 60, a.z - 160) ? b : a));
  const p = new THREE.Vector3(start.x, start.y + R, start.z);
  const v = new THREE.Vector3();
  let mode: Mode = "ground";
  const anchor = new THREE.Vector3();
  let rope = 0;
  let webSide = 1;
  let webHand: "L" | "R" = "R";
  let webGrow = 0;
  const wallN = new THREE.Vector3();
  let wallBox: Box | null = null;
  const zipTarget = new THREE.Vector3();
  const zipDir = new THREE.Vector3();
  let zipT = 0;
  let grounded = false;
  let wallContact = false;
  let yaw = Math.PI;
  let pitch = -0.15;
  let lastMouse = 0;
  let phase = 0;
  let quality = initial;
  let playing = false;
  let audio: ReturnType<typeof createAudio> | null = null;
  let trick: { kind: "flip" | "spin"; t: number } | null = null;
  let airTime = 0;
  let combo = 0;
  let kickT = 1;
  let landT = 1;
  let striking = false;
  let shake = 0;
  let strikeQueued = false;
  let prompt: string | null = null;
  let promptT = 0;
  const facing = new THREE.Vector3(0, 0, -1);

  const keys = new Set<string>();
  let swingHeld = false;
  let swingQueued = false;
  let zipQueued = false;
  let jumpQueued = false;

  const applyQuality = (q: Quality) => {
    quality = q;
    const Q = QUALITIES[q];
    try {
      localStorage.setItem("spiderman-quality", q);
    } catch {}
    const pr = Q.pixelRatio === 2 ? Math.min(window.devicePixelRatio, 2) : Q.pixelRatio;
    renderer.setPixelRatio(pr);
    composer.setPixelRatio(pr);
    renderer.shadowMap.enabled = Q.shadow > 0;
    sun.castShadow = Q.shadow > 0;
    if (Q.shadow) {
      sun.shadow.mapSize.set(Q.shadow, Q.shadow);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      const c = sun.shadow.camera;
      c.left = c.bottom = -Q.range;
      c.right = c.top = Q.range;
      c.updateProjectionMatrix();
    }
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
    });
    const fog = scene.fog as THREE.Fog;
    fog.far = Q.fog;
    fog.near = Q.fog * 0.1;
    camera.far = Q.fog + 200;
    snow.visible = Q.snow > 0;
    snowGeo.setDrawRange(0, Q.snow);
    city.setTraffic(Q.cars);
    const detail = q === "low" ? 0 : q === "medium" ? 1 : 2;
    city.setDetail(detail);
    missions.setDetail(detail);
    scene.environment = Q.env ? envMap : null;
    resize();
  };

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  const camForward = () => new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const lookDir = () => new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));

  const wishDir = () => {
    const f = camForward();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const w = new THREE.Vector3();
    if (keys.has("KeyW")) w.add(f);
    if (keys.has("KeyS")) w.sub(f);
    if (keys.has("KeyD")) w.add(r);
    if (keys.has("KeyA")) w.sub(r);
    return w.lengthSq() ? w.normalize() : w;
  };

  const attachWeb = () => {
    const flat = new THREE.Vector3(v.x, 0, v.z);
    const dir = flat.lengthSq() > 16 ? flat.normalize() : camForward();
    dir.addScaledVector(wishDir(), 0.6).normalize();
    webSide = -webSide;
    const right = new THREE.Vector3(-dir.z, 0, dir.x);
    const speed = v.length();
    const ideal = p.clone().addScaledVector(dir, 24 + speed * 0.2).addScaledVector(UP, 20 + Math.min(speed, 50) * 0.3).addScaledVector(right, webSide * 9);
    let best = Infinity;
    const cp = new THREE.Vector3();
    for (const b of city.near(ideal.x, ideal.z, 100)) {
      if (b.maxY < p.y + 6) continue;
      cp.set(THREE.MathUtils.clamp(ideal.x, b.minX, b.maxX), THREE.MathUtils.clamp(ideal.y, 0, b.maxY - 0.5), THREE.MathUtils.clamp(ideal.z, b.minZ, b.maxZ));
      if (cp.x > b.minX && cp.x < b.maxX && cp.z > b.minZ && cp.z < b.maxZ) {
        const faces = [cp.x - b.minX, b.maxX - cp.x, cp.z - b.minZ, b.maxZ - cp.z];
        const f = faces.indexOf(Math.min(...faces));
        if (f === 0) cp.x = b.minX;
        else if (f === 1) cp.x = b.maxX;
        else if (f === 2) cp.z = b.minZ;
        else cp.z = b.maxZ;
      }
      const to = cp.clone().sub(p);
      const len = to.length();
      if (len > 110 || len < 8 || to.y < 5 || to.dot(dir) < -4) continue;
      const score = cp.distanceTo(ideal);
      if (score < best) {
        best = score;
        anchor.copy(cp);
      }
    }
    if (best === Infinity) {
      audio?.sfx("whoosh");
      return false;
    }
    rope = p.distanceTo(anchor);
    webHand = webSide > 0 ? "R" : "L";
    webGrow = 0;
    mode = "swing";
    audio?.sfx("thwip");
    return true;
  };

  const startZip = () => {
    const o = camera.position;
    const d = lookDir();
    const far = o.distanceTo(p) + 160;
    let hit: { t: number; n: THREE.Vector3 } | null = null;
    for (const b of city.boxes) {
      const h = rayBox(o, d, b);
      if (h && h.t < far && h.t > o.distanceTo(p) && (!hit || h.t < hit.t)) hit = h;
    }
    if (!hit) return;
    anchor.copy(o).addScaledVector(d, hit.t);
    zipTarget.copy(anchor).addScaledVector(hit.n, R + 0.2);
    if (hit.n.y > 0.5) zipTarget.y += 0.5;
    zipDir.copy(zipTarget).sub(p).normalize();
    webHand = "R";
    webGrow = 0;
    zipT = 0;
    mode = "zip";
    audio?.sfx("zip");
  };

  const handle = (events: MissionEvent[]) => {
    for (const e of events) {
      if (e.type === "sfx") audio?.sfx(e.name);
      else if (e.type === "shake") shake = Math.max(shake, e.strength);
      else onEvent(e);
    }
  };

  const startStrike = () => {
    const target = missions.strikeTarget(p, 40);
    if (!target) return;
    zipTarget.copy(target);
    zipDir.copy(target).sub(p).normalize();
    anchor.copy(target);
    webHand = "R";
    webGrow = 0;
    zipT = 0;
    striking = true;
    trick = null;
    mode = "zip";
    audio?.sfx("zip");
  };

  const collide = () => {
    grounded = false;
    wallContact = false;
    if (p.y < R) {
      p.y = R;
      if (v.y < 0) v.y = 0;
      grounded = true;
    }
    for (const b of city.near(p.x, p.z, 8)) {
      const x0 = b.minX - R, x1 = b.maxX + R, z0 = b.minZ - R, z1 = b.maxZ + R, top = b.maxY + R;
      if (p.x <= x0 || p.x >= x1 || p.z <= z0 || p.z >= z1 || p.y >= top) continue;
      const pen = [p.x - x0, x1 - p.x, p.z - z0, z1 - p.z, top - p.y];
      const m = pen.indexOf(Math.min(...pen));
      if (m === 4) {
        p.y = top;
        if (v.y < 0) v.y = 0;
        grounded = true;
        continue;
      }
      const n = new THREE.Vector3([-1, 1, 0, 0][m], 0, [0, 0, -1, 1][m]);
      if (m === 0) p.x = x0;
      else if (m === 1) p.x = x1;
      else if (m === 2) p.z = z0;
      else p.z = z1;
      const vn = v.dot(n);
      if (vn < 0) v.addScaledVector(n, -vn);
      wallContact = true;
      wallN.copy(n);
      wallBox = b;
    }
  };

  const step = (dt: number) => {
    const wish = wishDir();
    const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const wasMode = mode;

    if (swingQueued && mode !== "swing" && mode !== "zip") {
      swingQueued = false;
      if (attachWeb()) {
        if (wasMode === "ground") v.y = Math.max(v.y, JUMP);
        if (wasMode === "wall") v.copy(wallN).multiplyScalar(10).addScaledVector(UP, 6);
      }
    }
    if (!swingHeld && mode === "swing") {
      mode = "air";
      const flat = new THREE.Vector3(v.x, 0, v.z).normalize();
      v.addScaledVector(UP, 5).addScaledVector(flat, 3);
    }
    if (zipQueued) {
      zipQueued = false;
      striking = false;
      startZip();
    }
    if (strikeQueued) {
      strikeQueued = false;
      startStrike();
    }

    switch (mode) {
      case "ground": {
        const speed = sprint ? SPRINT : RUN;
        const k = Math.min(1, 10 * dt);
        v.x += (wish.x * speed - v.x) * k;
        v.z += (wish.z * speed - v.z) * k;
        v.y -= G * dt;
        if (jumpQueued) {
          v.y = JUMP + (sprint ? 3 : 0);
          mode = "air";
        }
        break;
      }
      case "air":
        if (jumpQueued && !trick) {
          trick = { kind: Math.random() < 0.5 ? "flip" : "spin", t: 0 };
          audio?.sfx("whoosh");
        }
        v.y -= G * (sprint && v.y < 0 ? 1.8 : 1) * dt;
        v.addScaledVector(wish, 10 * dt);
        break;
      case "swing": {
        v.y -= G * dt;
        const n = anchor.clone().sub(p).normalize();
        const steer = wish.clone().multiplyScalar(14 * dt);
        v.add(steer.addScaledVector(n, -steer.dot(n)));
        if (p.y < anchor.y) {
          const t = v.clone().addScaledVector(n, -v.dot(n));
          if (t.lengthSq() > 0.01) v.addScaledVector(t.normalize(), 11 * dt);
        }
        rope = Math.max(6, rope - (rope > anchor.y - 7 ? 22 : 3) * dt);
        break;
      }
      case "wall": {
        const along = wish.clone().addScaledVector(wallN, -wish.dot(wallN));
        const into = -wish.dot(wallN);
        v.set(along.x * 8, wish.lengthSq() ? CLIMB * Math.max(0.3, into) : 0, along.z * 8).addScaledVector(wallN, -3);
        if (jumpQueued) {
          v.copy(wallN).multiplyScalar(13).addScaledVector(UP, 10);
          mode = "air";
        } else if (wish.dot(wallN) > 0.5) {
          v.copy(wallN).multiplyScalar(5);
          mode = "air";
        }
        if (wallBox && p.y > wallBox.maxY + R - 0.6) {
          v.set(0, 9, 0).addScaledVector(wallN, -7);
          mode = "air";
        }
        break;
      }
      case "zip":
        v.copy(zipDir).multiplyScalar(ZIP);
        zipT += dt;
        break;
    }
    jumpQueued = false;

    if (v.length() > MAX_SPEED) v.setLength(MAX_SPEED);
    p.addScaledVector(v, dt);

    if (mode === "swing") {
      const d = p.clone().sub(anchor);
      const len = d.length();
      if (len > rope) {
        d.multiplyScalar(rope / len);
        p.copy(anchor).add(d);
        const n = d.normalize();
        const vr = v.dot(n);
        if (vr > 0) v.addScaledVector(n, -vr);
      }
      if (p.y > anchor.y - 1) mode = "air";
    }

    const fallSpeed = -v.y;
    collide();

    if (mode === "zip" && striking && p.distanceTo(zipTarget) < 2.4) {
      handle(missions.strike(p, 1));
      audio?.sfx("hit");
      shake = Math.max(shake, 0.35);
      v.copy(zipDir).multiplyScalar(-7).addScaledVector(UP, 10);
      kickT = 0;
      striking = false;
      mode = "air";
    }
    if (mode === "zip" && (p.distanceTo(zipTarget) < 2 || (zipT > 0.15 && (wallContact || grounded)) || zipT > 4)) {
      v.copy(zipDir).multiplyScalar(16).addScaledVector(UP, 14);
      striking = false;
      mode = "air";
    }
    if (grounded && (mode === "air" || mode === "swing")) {
      if (fallSpeed > 28) {
        handle(missions.strike(p, 2));
        audio?.sfx("bigLand");
        shake = Math.max(shake, 0.7);
        landT = 0;
      } else audio?.sfx("land");
      trick = null;
      combo = 0;
      mode = "ground";
    }
    if (mode === "ground" && !grounded) mode = "air";
    if (wallContact && Math.abs(wallN.y) < 0.1 && mode !== "wall" && mode !== "zip") {
      const into = -wish.dot(wallN);
      if (mode === "swing" || (mode === "air" && into > 0.2) || (mode === "ground" && into > 0.6)) mode = "wall";
    }
    if (mode === "wall" && !wallContact) {
      if (v.y > 0) v.y = Math.max(v.y, 6);
      mode = "air";
    }
  };

  const tmp = new THREE.Vector3();
  const handPos = new THREE.Vector3();
  const quatTarget = new THREE.Quaternion();
  const basis = new THREE.Matrix4();

  const orient = (up: THREE.Vector3, fwd: THREE.Vector3, dt: number) => {
    const u = up.clone().normalize();
    let f = fwd.clone().addScaledVector(u, -fwd.dot(u));
    if (f.lengthSq() < 1e-4) f = facing.clone().addScaledVector(u, -facing.dot(u));
    f.normalize();
    const x = new THREE.Vector3().crossVectors(u, f);
    basis.makeBasis(x, u, f);
    quatTarget.setFromRotationMatrix(basis);
    hero.root.quaternion.slerp(quatTarget, 1 - Math.exp(-10 * dt));
  };

  let t = 0;
  let frames = 0;
  let fps = 60;
  let fpsT = 0;
  let statT = 0;
  let camFov = 68;
  let wallCam = 0;
  let last = performance.now();
  let raf = 0;
  const camPos = new THREE.Vector3().copy(p).addScaledVector(lookDir(), -6);

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    t += dt;
    frames++;
    fpsT += dt;
    if (fpsT > 0.5) {
      fps = Math.round(frames / fpsT);
      frames = 0;
      fpsT = 0;
    }

    if (playing) for (let i = 0; i < 3; i++) step(dt / 3);
    const speed = v.length();
    airTime = mode === "air" || mode === "swing" || mode === "zip" ? airTime + dt : 0;
    kickT = Math.min(1, kickT + dt / 0.45);
    landT = Math.min(1, landT + dt / 0.5);
    if (trick) {
      trick.t += dt / 0.6;
      if (mode !== "air") trick = null;
      else if (trick.t >= 1) {
        combo++;
        handle(missions.trick(trick.kind, airTime));
        audio?.sfx("trick");
        trick = null;
      }
    }
    if (mode === "ground" || mode === "wall") combo = 0;
    const flat = new THREE.Vector3(v.x, 0, v.z);
    if (flat.lengthSq() > 0.25) facing.copy(flat).normalize();

    let pose: HeroPose = "idle";
    if (mode === "ground") {
      pose = landT < 1 ? "land" : flat.length() > 0.5 ? "run" : keys.has("KeyC") ? "crouch" : "idle";
      phase += flat.length() * dt * 0.85;
      orient(UP, facing, dt);
    } else if (mode === "air") {
      const dive = THREE.MathUtils.clamp((-v.y - 12) / 20, 0, 1);
      pose = trick ? trick.kind : kickT < 1 ? "kick" : dive > 0.4 ? "dive" : "air";
      const vn = v.clone().normalize();
      orient(UP.clone().lerp(vn, dive), facing.clone().lerp(new THREE.Vector3(0, -1, 0), dive), dt);
    } else if (mode === "swing") {
      pose = "swing";
      phase += dt * 2.2;
      orient(anchor.clone().sub(p), v.lengthSq() > 1 ? v : facing, dt);
    } else if (mode === "wall") {
      pose = "wall";
      phase += Math.max(v.length(), 3) * dt * 0.85;
      orient(wallN, Math.abs(v.y) > 1 || !(v.x || v.z) ? UP : v, dt);
    } else {
      pose = striking && zipT > 0.1 ? "kick" : "zip";
      orient(UP, zipDir, dt);
    }
    hero.root.position.copy(p);
    const progress = pose === "flip" || pose === "spin" ? trick!.t : pose === "kick" ? (striking ? 0.3 : kickT) : pose === "land" ? landT : phase;
    hero.animate(pose, progress, webHand, t, dt);
    hero.root.updateMatrixWorld(true);

    if (mode === "swing" || mode === "zip") {
      webGrow = Math.min(1, webGrow + dt * 9);
      hero.handWorld(webHand, handPos);
      tmp.copy(anchor).sub(handPos);
      const len = tmp.length() * webGrow;
      web.position.copy(handPos);
      web.quaternion.setFromUnitVectors(UP, tmp.normalize());
      web.scale.set(1, len, 1);
      web.visible = true;
    } else web.visible = false;

    if (playing && now - lastMouse > 1500 && flat.length() > 8 && mode !== "ground") {
      const target = Math.atan2(v.x, v.z);
      let dy = target - yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      yaw += dy * Math.min(1, 1.6 * dt);
    }
    const look = lookDir();
    const focus = p.clone().addScaledVector(UP, 0.9);
    const right = new THREE.Vector3(-look.z, 0, look.x).normalize();
    focus.addScaledVector(right, 0.55);
    const dist = 4.6 + Math.min(speed, 70) * 0.04;
    const want = focus.clone().addScaledVector(look, -dist);
    wallCam += ((mode === "wall" ? 1 : 0) - wallCam) * (1 - Math.exp(-5 * dt));
    if (wallCam > 0.01) want.lerp(focus.clone().addScaledVector(wallN, 7).addScaledVector(UP, -3), wallCam);
    const step01 = new THREE.Vector3();
    for (let i = 1; i <= 10; i++) {
      step01.lerpVectors(focus, want, i / 10);
      const blocked = step01.y < 0.4 || city.near(step01.x, step01.z, 2).some((b) => step01.x > b.minX - 0.3 && step01.x < b.maxX + 0.3 && step01.z > b.minZ - 0.3 && step01.z < b.maxZ + 0.3 && step01.y < b.maxY + 0.3);
      if (blocked) {
        want.lerpVectors(focus, want, (i - 1) / 10);
        break;
      }
    }
    camPos.lerp(want, 1 - Math.exp(-20 * dt));
    camera.position.copy(camPos);
    shake *= Math.exp(-6 * dt);
    if (shake > 0.01) camera.position.add(tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shake));
    camera.lookAt(focus.addScaledVector(look, 2 * (1 - wallCam)).addScaledVector(UP, 4 * wallCam));
    if (!playing) {
      yaw += dt * 0.08;
    }
    const goalFov = 66 + Math.min(Math.max(speed - 10, 0), 55) * 0.42;
    camFov += (goalFov - camFov) * (1 - Math.exp(-4 * dt));
    camera.fov = camFov;
    camera.updateProjectionMatrix();

    sun.position.copy(p).addScaledVector(sunDir, 600);
    sun.target.position.copy(p);
    su.time.value = t;

    if (snow.visible) {
      const n = QUALITIES[quality].snow;
      const c = camera.position;
      for (let i = 0; i < n; i++) {
        const k = i * 3;
        snowPos[k + 1] -= (1.6 + (i % 5) * 0.35) * dt;
        snowPos[k] += Math.sin(t * 0.7 + i) * 0.6 * dt;
        if (snowPos[k] - c.x > 60) snowPos[k] -= 120;
        else if (snowPos[k] - c.x < -60) snowPos[k] += 120;
        if (snowPos[k + 1] - c.y > 40) snowPos[k + 1] -= 80;
        else if (snowPos[k + 1] - c.y < -40) snowPos[k + 1] += 80;
        if (snowPos[k + 2] - c.z > 60) snowPos[k + 2] -= 120;
        else if (snowPos[k + 2] - c.z < -60) snowPos[k + 2] += 120;
      }
      snowGeo.attributes.position.needsUpdate = true;
    }

    if (playing) handle(missions.update(dt, t, { pos: p, vel: v, mode, camera }));
    promptT -= dt;
    if (promptT <= 0) {
      promptT = 0.25;
      prompt = mode !== "zip" && missions.strikeTarget(p, 40) ? "F  Web strike" : null;
    }
    const hud = missions.hud();
    city.updateTraffic(dt);
    city.update(dt, t);
    const music: MusicState = !playing ? "menu" : hud.activity && /race/i.test(hud.activity.title) ? "race" : prompt ? "combat" : speed > 20 ? "swing" : "explore";
    audio?.update(dt, playing ? speed : 0, music);

    if (QUALITIES[quality].bloom) composer.render();
    else renderer.render(scene, camera);

    statT += dt;
    if (statT > 0.12) {
      statT = 0;
      onStats({
        speed: speed * 3.6, height: p.y - R, fps, playing, mode, quality, suit, muted: audio?.muted ?? false,
        x: p.x, z: p.z, heading: yaw, prompt, combo, hud,
      });
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!playing) return;
    if (e.code === "Escape") pause();
    if (e.code === "Space") {
      jumpQueued = true;
      e.preventDefault();
    }
    if (e.code === "KeyE") zipQueued = true;
    if (e.code === "KeyF") strikeQueued = true;
    if (e.code === "KeyV") setSuit(SUITS[(SUITS.findIndex((x) => x.id === suit) + 1) % SUITS.length].id);
    if (e.code === "KeyM") audio?.setMuted(!audio.muted);
    if (e.code === "Digit1") applyQuality("low");
    if (e.code === "Digit2") applyQuality("medium");
    if (e.code === "Digit3") applyQuality("high");
    if (e.code === "KeyR") {
      p.set(start.x, start.y + R, start.z);
      v.set(0, 0, 0);
      mode = "ground";
    }
    keys.add(e.code);
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  const onMouseDown = (e: MouseEvent) => {
    if (!playing) return;
    if (e.button === 0) {
      swingHeld = true;
      swingQueued = true;
    }
    if (e.button === 2) zipQueued = true;
  };
  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) {
      swingHeld = false;
      swingQueued = false;
    }
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!playing) return;
    yaw -= e.movementX * 0.0022;
    pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.0022, -1.25, 0.9);
    lastMouse = performance.now();
  };
  const pause = () => {
    playing = false;
    keys.clear();
    swingHeld = false;
  };
  const setSuit = (id: SuitName) => {
    suit = id;
    hero.setSuit(id);
    try {
      localStorage.setItem("spiderman-suit", id);
    } catch {}
  };
  const onLock = () => {
    if (document.pointerLockElement !== canvas) pause();
  };
  const noMenu = (e: Event) => e.preventDefault();

  window.addEventListener("resize", resize);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("mousemove", onMouseMove);
  document.addEventListener("pointerlockchange", onLock);
  canvas.addEventListener("contextmenu", noMenu);

  applyQuality(initial);
  raf = requestAnimationFrame(frame);

  return {
    setQuality: applyQuality,
    setSuit,
    play() {
      if (!audio) {
        audio = createAudio();
        audio.sfx("start");
      }
      audio.resume();
      playing = true;
      lastMouse = performance.now();
      canvas.requestPointerLock()?.catch?.(() => {});
    },
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onLock);
      canvas.removeEventListener("contextmenu", noMenu);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      audio?.dispose();
      missions.dispose();
      composer.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}

export type Game = ReturnType<typeof startGame>;
