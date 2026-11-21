import * as THREE from "three";
import type {
  Audio, Box, BtnName, CameraRig, Combat, Enemies, EnemyState, Fx, FrameCtx, GameEvent, Input, Landmarks, Look, Nature,
  Platform, Player, Prop, Quality, Render, RayHit, SaveData, ScreenPoint, Settings, Shot, Strike, Terrain, ToonOpts, V3, World,
} from "./contracts";
import { DAY_SECONDS, ENEMY, LANDMARKS, PLAYER, PLAYER_SPAWN, QUALITY, WORLD } from "./contracts";
import { BTN_NAMES, newEnemyState, newEnv, newInputState, newPlayerState } from "./state";

// Stand-ins for every module. Frozen for builders (owner: integrator).
// Each export has the REAL factory name and signature, so game.ts swaps a module by changing only the import path.
// Lab pages import what they need from here: `import * as mock from "../../mock"`.

const MOCK_GROUND = 2; // flat island height (m) so the sea (y = 0) stays below it

// ---------------------------------------------------------------------------------------------------------------------
// World: flat ground at y = 2 inside the island radius, boxes in a plain list.
// ---------------------------------------------------------------------------------------------------------------------
export function createWorld(seed: number): World {
  const boxes = new Map<number, Box>();
  const nearSet = new Set<Box>();
  let nextId = 1;
  const inIsland = (x: number, z: number) => x * x + z * z < WORLD.islandR * WORLD.islandR;
  const heightAt = (x: number, z: number) => (inIsland(x, z) ? MOCK_GROUND : WORLD.oceanFloor);
  const byR = [...LANDMARKS].sort((a, b) => a.r - b.r);
  return {
    seed,
    landmarks: LANDMARKS,
    heightAt,
    normalAt: (_x, _z, out) => out.set(0, 1, 0),
    groundAt(x, y, z) {
      let g = heightAt(x, z);
      for (const b of boxes.values()) {
        if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && b.maxY <= y + 0.5 && b.maxY > g) g = b.maxY;
      }
      return g;
    },
    waterAt: (x, z) => (inIsland(x, z) ? -Infinity : 0),
    isWater: (x, y, z) => !inIsland(x, z) && y < 0,
    isClimbable: (n, box) => (box ? box.tag === "climbable" || box.tag === "solid" : n.y < 0.64),
    surfaceAt: () => "grass",
    biomeAt: (x, z) => (inIsland(x, z) ? "meadow" : "sea"),
    raycast(ox, oy, oz, dx, dy, dz, maxDist, out: RayHit) {
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len; dy /= len; dz /= len;
      let best = maxDist;
      let hitBox: Box | null = null;
      out.hit = false;
      if (dy < 0) {
        const t = (MOCK_GROUND - oy) / dy;
        if (t >= 0 && t < best) {
          best = t;
          out.hit = true;
          out.kind = "terrain";
          out.normal.set(0, 1, 0);
        }
      }
      for (const b of boxes.values()) {
        let t0 = 0, t1 = best;
        const ax = [ox, oy, oz], ad = [dx, dy, dz], mn = [b.minX, b.minY, b.minZ], mx = [b.maxX, b.maxY, b.maxZ];
        let axis = -1;
        let ok = true;
        for (let i = 0; i < 3 && ok; i++) {
          if (Math.abs(ad[i]) < 1e-9) { if (ax[i] < mn[i] || ax[i] > mx[i]) ok = false; continue; }
          let ta = (mn[i] - ax[i]) / ad[i], tb = (mx[i] - ax[i]) / ad[i];
          if (ta > tb) { const s = ta; ta = tb; tb = s; }
          if (ta > t0) { t0 = ta; axis = i; }
          if (tb < t1) t1 = tb;
          if (t0 > t1) ok = false;
        }
        if (ok && t0 < best) {
          best = t0;
          hitBox = b;
          out.hit = true;
          out.kind = "box";
          out.normal.set(0, 0, 0);
          if (axis >= 0) out.normal.setComponent(axis, -Math.sign(ad[axis]));
        }
      }
      out.box = hitBox;
      out.dist = best;
      out.point.set(ox + dx * best, oy + dy * best, oz + dz * best);
      return out.hit;
    },
    addBox(b) {
      const id = nextId++;
      boxes.set(id, { ...b, id });
      return id;
    },
    moveBox(id, minX, minY, minZ, maxX, maxY, maxZ) {
      const b = boxes.get(id);
      if (b) Object.assign(b, { minX, minY, minZ, maxX, maxY, maxZ });
    },
    setBoxTag(id, tag) {
      const b = boxes.get(id);
      if (b) b.tag = tag;
    },
    removeBox: (id) => void boxes.delete(id),
    near(x, z, r) {
      nearSet.clear();
      for (const b of boxes.values()) if (x + r >= b.minX && x - r <= b.maxX && z + r >= b.minZ && z - r <= b.maxZ) nearSet.add(b);
      return nearSet;
    },
    areaAt(x, z) {
      for (const l of byR) if ((x - l.x) ** 2 + (z - l.z) ** 2 < l.r * l.r) return l;
      return null;
    },
    dispose() {
      boxes.clear();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Render: plain WebGL renderer, Lambert materials, flat sky color, a ticking clock. No post, no particles.
// ---------------------------------------------------------------------------------------------------------------------
export function detectQuality(p: Platform): Quality {
  if (p.weakGpu) return "low";
  if (p.touch) return "medium";
  return "high";
}

const MOCK_GLSL = /* glsl */ `
uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyColor; uniform vec3 uGroundColor;
uniform vec3 uRimColor; uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar; uniform vec2 uWind;
uniform float uRain; uniform vec3 uPlayerPos; uniform vec3 uLanternPos; uniform vec3 uLanternColor;
vec3 hmShade(vec3 albedo, vec3 n, vec3 worldPos, vec3 viewDir) {
  float d = max(dot(n, uSunDir), 0.0);
  d = d > 0.5 ? 1.0 : d > 0.1 ? 0.6 : 0.3;
  return albedo * (uSunColor * d + mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5) * 0.5);
}
vec3 hmFog(vec3 c, float dist) { return mix(c, uFogColor, smoothstep(uFogNear, uFogFar, dist)); }
`;

export function createRender(canvas: HTMLCanvasElement, quality: Quality): Render {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[quality].pixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const sky = new THREE.Color("#9cc3cf");
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, QUALITY[quality].fogNear, QUALITY[quality].fogFar);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, QUALITY[quality].drawDist);
  const hemi = new THREE.HemisphereLight("#cfe6f0", "#5d6b3a", 1.2);
  const sun = new THREE.DirectionalLight("#fff1d6", 2.2);
  sun.position.set(40, 80, 30);
  scene.add(hemi, sun);
  const env = newEnv();
  const uniforms = {
    uTime: { value: 0 }, uSunDir: { value: env.sunDir }, uSunColor: { value: new THREE.Color("#fff1d6") },
    uSkyColor: { value: new THREE.Color("#cfe6f0") }, uGroundColor: { value: new THREE.Color("#5d6b3a") },
    uRimColor: { value: new THREE.Color("#ffd9a0") }, uFogColor: { value: sky }, uFogNear: { value: QUALITY[quality].fogNear },
    uFogFar: { value: QUALITY[quality].fogFar }, uWind: { value: env.wind }, uRain: { value: 0 },
    uPlayerPos: { value: new THREE.Vector3() }, uLanternPos: { value: new THREE.Vector3() }, uLanternColor: { value: new THREE.Color("#f08a3c") },
  };
  const mats = new Map<string, THREE.Material>();
  const look: Look = {
    uniforms,
    glsl: MOCK_GLSL,
    toon(o: ToonOpts) {
      const key = JSON.stringify([o.color, o.emissive, o.emissiveIntensity, o.vertexColors, o.map?.uuid, o.side, o.transparent, o.opacity]);
      let m = mats.get(key);
      if (!m) {
        m = new THREE.MeshLambertMaterial({
          color: o.color, emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissiveIntensity ?? 1,
          vertexColors: o.vertexColors ?? false, map: o.map ?? null, side: o.side ?? THREE.FrontSide,
          transparent: o.transparent ?? false, opacity: o.opacity ?? 1,
        });
        mats.set(key, m);
      }
      return m;
    },
    patch: (m) => m,
  };
  const fx: Fx = { burst() {}, trail() {} };
  const events: GameEvent[] = [];
  let q = quality;
  let fps = 60, ms = 16;
  return {
    scene, camera, renderer, look, fx, env,
    get quality() { return q; },
    setQuality(nq) {
      q = nq;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[q].pixelRatio));
    },
    setDynamicRes() {},
    setTime(h) { env.timeOfDay = h; },
    setWeather(w) { env.weather = w; },
    resize() {
      const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    update(ctx: FrameCtx) {
      events.length = 0;
      env.timeOfDay = (env.timeOfDay + (ctx.dt * 24) / DAY_SECONDS) % 24;
      uniforms.uTime.value = ctx.time;
      uniforms.uPlayerPos.value.copy(ctx.player.pos);
      uniforms.uLanternPos.value.copy(ctx.player.lanternPos);
      return events;
    },
    handle() {},
    render(ctx) {
      if (ctx.realDt > 0) {
        ms += (ctx.realDt * 1000 - ms) * 0.1;
        fps = 1000 / ms;
      }
      renderer.render(scene, camera);
    },
    stats: () => ({ fps, ms, scale: 1, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
    dispose() {
      for (const m of mats.values()) m.dispose();
      renderer.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Terrain: one big ground disc with a grid so motion is visible, plus a sea plane.
// ---------------------------------------------------------------------------------------------------------------------
export function createTerrain(scene: THREE.Scene, _world: World, look: Look, _quality: Quality): Terrain {
  const group = new THREE.Group();
  const groundGeo = new THREE.CircleGeometry(WORLD.islandR, 64).rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, look.toon({ color: "#8fae5a" }));
  ground.position.y = MOCK_GROUND;
  const grid = new THREE.GridHelper(WORLD.islandR * 2, WORLD.islandR / 4, "#6d8a43", "#7c9a4e");
  grid.position.y = MOCK_GROUND + 0.02;
  const seaGeo = new THREE.PlaneGeometry(WORLD.half * 4, WORLD.half * 4).rotateX(-Math.PI / 2);
  const sea = new THREE.Mesh(seaGeo, look.toon({ color: "#3f8f96" }));
  group.add(ground, grid, sea);
  scene.add(group);
  return {
    group,
    update() {},
    setQuality() {},
    dispose() {
      scene.remove(group);
      groundGeo.dispose();
      seaGeo.dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Nature: a few hundred instanced cones as trees, so the player can see they move.
// ---------------------------------------------------------------------------------------------------------------------
export function createNature(scene: THREE.Scene, world: World, look: Look, _quality: Quality): Nature {
  const group = new THREE.Group();
  const geo = new THREE.ConeGeometry(1.6, 6, 6).translate(0, 3, 0);
  const n = 400;
  const mesh = new THREE.InstancedMesh(geo, look.toon({ color: "#4f7a3a" }), n);
  const m = new THREE.Matrix4();
  let s = world.seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = 30 + Math.sqrt(rnd()) * (WORLD.islandR - 40);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const k = 0.7 + rnd() * 0.8;
    m.makeScale(k, k, k).setPosition(x, world.heightAt(x, z), z);
    mesh.setMatrixAt(i, m);
  }
  group.add(mesh);
  scene.add(group);
  return {
    group,
    update() {},
    handle() {},
    setQuality() {},
    dispose() {
      scene.remove(group);
      geo.dispose();
      mesh.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Landmarks: a colored pillar at every landmark, areaEnter events, no trials.
// ---------------------------------------------------------------------------------------------------------------------
export function createLandmarks(scene: THREE.Scene, world: World, look: Look, _quality: Quality): Landmarks {
  const group = new THREE.Group();
  const geo = new THREE.CylinderGeometry(3, 4, 1, 8).translate(0, 0.5, 0);
  for (const l of LANDMARKS) {
    const beacon = l.id.startsWith("beacon");
    const h = l.id === "spire" ? 120 : beacon ? 30 : 12;
    const mesh = new THREE.Mesh(geo, look.toon({ color: beacon ? "#c9a13b" : l.id === "spire" ? "#5b3a6e" : "#a89a82" }));
    mesh.scale.set(1, h, 1);
    mesh.position.set(l.x, world.heightAt(l.x, l.z), l.z);
    group.add(mesh);
  }
  scene.add(group);
  const events: GameEvent[] = [];
  const props: Prop[] = [];
  const visited = new Set<string>();
  let area: string | null = null;
  return {
    group,
    prompt: null,
    props,
    checkpoint: (out) => out.set(PLAYER_SPAWN.x, world.heightAt(PLAYER_SPAWN.x, PLAYER_SPAWN.z), PLAYER_SPAWN.z),
    load(quest) {
      visited.clear();
      for (const v of quest.visited) visited.add(v);
    },
    collected: () => [],
    update(ctx) {
      events.length = 0;
      const a = world.areaAt(ctx.player.pos.x, ctx.player.pos.z);
      const id = a ? a.id : null;
      if (a && id !== area) {
        events.push({ type: "areaEnter", id: a.id, name: a.name, first: !visited.has(a.id) });
        visited.add(a.id);
      }
      area = id;
      return events;
    },
    handle() {},
    setQuality() {},
    dispose() {
      scene.remove(group);
      geo.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Player: a capsule. Camera-relative run, sprint, jump, one sword strike, takes hits.
// ---------------------------------------------------------------------------------------------------------------------
export function createPlayer(scene: THREE.Scene, world: World, look: Look, _quality: Quality): Player {
  const state = newPlayerState();
  const group = new THREE.Group();
  const geo = new THREE.CapsuleGeometry(PLAYER.radius, PLAYER.height - PLAYER.radius * 2, 4, 10).translate(0, PLAYER.height / 2, 0);
  const body = new THREE.Mesh(geo, look.toon({ color: "#2f5f5a" }));
  const noseGeo = new THREE.BoxGeometry(0.18, 0.18, 0.4).translate(0, 1.4, 0.35);
  const nose = new THREE.Mesh(noseGeo, look.toon({ color: "#f08a3c", emissive: "#f08a3c", emissiveIntensity: 0.6 }));
  group.add(body, nose);
  scene.add(group);
  const events: GameEvent[] = [];
  const pending: GameEvent[] = [];
  const strike: Strike = { team: "player", source: -1, origin: { x: 0, y: 0, z: 0 }, yaw: 0, reach: 2, arc: 2.2, height: 1, damage: 10, kind: "sword", knockback: 4 };
  const v: V3 = { x: 0, y: 0, z: 0 };
  let swingCd = 0;
  const snap = () => {
    state.pos.y = world.groundAt(state.pos.x, state.pos.y + 50, state.pos.z);
  };
  snap();
  return {
    state,
    group,
    update(ctx) {
      events.length = 0;
      for (const e of pending) events.push(e);
      pending.length = 0;
      const dt = ctx.dt, inp = ctx.input;
      const cy = ctx.cameraYaw;
      const fx = Math.sin(cy), fz = Math.cos(cy), rx = -Math.cos(cy), rz = Math.sin(cy);
      const wx = fx * inp.move.y + rx * inp.move.x, wz = fz * inp.move.y + rz * inp.move.x;
      const mag = Math.min(1, Math.hypot(wx, wz));
      state.sprinting = inp.btn.sprint.down && mag > 0.1 && state.stamina > 0;
      const speed = (state.sprinting ? PLAYER.sprint : PLAYER.run) * mag;
      const k = Math.min(1, (state.grounded ? 12 : 3) * dt);
      state.vel.x += ((mag > 0 ? (wx / mag) * speed : 0) - state.vel.x) * k;
      state.vel.z += ((mag > 0 ? (wz / mag) * speed : 0) - state.vel.z) * k;
      if (mag > 0.1) state.yaw = Math.atan2(wx, wz);
      state.stamina = Math.max(0, Math.min(PLAYER.staminaMax, state.stamina + (state.sprinting ? -PLAYER.sprintCost : PLAYER.staminaRegen) * dt));
      if (state.grounded && inp.btn.jump.pressed) {
        state.vel.y = PLAYER.jumpV;
        state.grounded = false;
        events.push({ type: "jump", pos: { x: state.pos.x, y: state.pos.y, z: state.pos.z } });
      }
      state.vel.y -= 22 * dt;
      state.pos.addScaledVector(state.vel, dt);
      const g = world.groundAt(state.pos.x, state.pos.y, state.pos.z);
      if (state.pos.y <= g) {
        if (!state.grounded) events.push({ type: "land", pos: { x: state.pos.x, y: g, z: state.pos.z }, speed: -state.vel.y, surface: "grass" });
        state.pos.y = g;
        state.vel.y = 0;
        state.grounded = true;
        state.lastSafe.copy(state.pos);
      } else if (state.pos.y > g + 0.05) state.grounded = false;
      state.mode = state.grounded ? "ground" : "air";
      swingCd -= dt;
      state.iFrames = Math.max(0, state.iFrames - dt);
      if (inp.btn.attack.pressed && swingCd <= 0) {
        swingCd = 0.35;
        strike.origin.x = state.pos.x; strike.origin.y = state.pos.y + 1; strike.origin.z = state.pos.z;
        strike.yaw = state.yaw;
        ctx.combat.strike(strike);
        events.push({ type: "swing", pos: { x: state.pos.x, y: state.pos.y + 1, z: state.pos.z }, combo: 1 });
      }
      state.action = swingCd > 0 ? "attack1" : "none";
      state.lanternPos.set(state.pos.x + 0.3, state.pos.y + 0.9, state.pos.z);
      state.handPos.set(state.pos.x, state.pos.y + 1.1, state.pos.z);
      group.position.copy(state.pos);
      group.rotation.y = state.yaw;
      body.scale.y = state.action === "attack1" ? 0.92 : 1;
      return events;
    },
    handle(evs) {
      for (const e of evs) {
        if (e.type === "hit" && e.team === "enemy" && e.target === -1 && state.iFrames <= 0 && state.hp > 0) {
          state.hp = Math.max(0, state.hp - e.damage);
          state.iFrames = PLAYER.hurtIFrames;
          state.vel.x += e.dir.x * e.knockback;
          state.vel.z += e.dir.z * e.knockback;
          v.x = state.pos.x; v.y = state.pos.y; v.z = state.pos.z;
          pending.push({ type: "hurt", amount: e.damage, hp: state.hp, pos: { ...v } });
          if (state.hp <= 0) pending.push({ type: "died", pos: { ...v } });
        } else if (e.type === "rest") state.hp = state.maxHp;
        else if (e.type === "pickup" && e.kind === "glimmer") state.glimmers += e.amount;
      }
    },
    place(pos, yaw, hp) {
      state.pos.set(pos.x, pos.y, pos.z);
      snap();
      state.vel.set(0, 0, 0);
      state.yaw = yaw;
      state.action = "none";
      state.mode = "ground";
      if (hp !== undefined) state.hp = hp;
    },
    load(s: SaveData) {
      state.maxHp = s.maxHp;
      state.hp = s.hp;
      state.shards = s.shards;
      state.glimmers = s.glimmers;
      state.arrows = s.arrows;
      state.hasBow = s.hasBow;
      state.hasGlider = s.hasGlider;
    },
    setQuality() {},
    dispose() {
      scene.remove(group);
      geo.dispose();
      noseGeo.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Combat: resolves melee strikes as arc tests, ignores shots.
// ---------------------------------------------------------------------------------------------------------------------
export function createCombat(_scene: THREE.Scene, _world: World, _look: Look): Combat {
  const queue: Strike[] = Array.from({ length: 16 }, () => ({ team: "player" as const, source: -1, origin: { x: 0, y: 0, z: 0 }, yaw: 0, reach: 0, arc: 0, height: 0, damage: 0, kind: "sword" as const, knockback: 0 }));
  let n = 0;
  const events: GameEvent[] = [];
  function test(s: Strike, x: number, z: number, r: number): boolean {
    const dx = x - s.origin.x, dz = z - s.origin.z;
    const d = Math.hypot(dx, dz);
    if (d > s.reach + r) return false;
    if (s.arc >= Math.PI * 2 - 1e-3) return true;
    let a = Math.atan2(dx, dz) - s.yaw;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    return Math.abs(a) <= s.arc / 2;
  }
  function hit(s: Strike, target: number, x: number, y: number, z: number, blocked: boolean): GameEvent {
    const dx = x - s.origin.x, dz = z - s.origin.z, d = Math.hypot(dx, dz) || 1;
    return {
      type: "hit", team: s.team, target, source: s.source, damage: blocked ? 0 : s.damage, pos: { x, y, z },
      dir: { x: dx / d, y: 0, z: dz / d }, kind: s.kind, blocked, parried: false, knockback: s.knockback,
    };
  }
  return {
    strike(s) {
      if (n >= queue.length) return;
      const q = queue[n++];
      Object.assign(q, s);
      q.origin = { x: s.origin.x, y: s.origin.y, z: s.origin.z };
    },
    shoot(_s: Shot) {},
    setProps() {},
    update(ctx) {
      events.length = 0;
      for (let i = 0; i < n; i++) {
        const s = queue[i];
        if (s.team === "player") {
          for (const e of ctx.enemies) {
            if (e.alive && test(s, e.pos.x, e.pos.z, ENEMY[e.kind].radius)) events.push(hit(s, e.id, e.pos.x, e.pos.y + 0.5, e.pos.z, false));
          }
        } else {
          const p = ctx.player;
          if (p.iFrames <= 0 && test(s, p.pos.x, p.pos.z, PLAYER.radius)) events.push(hit(s, -1, p.pos.x, p.pos.y + 1, p.pos.z, p.shieldUp));
        }
      }
      n = 0;
      return events;
    },
    handle() {},
    clear() { n = 0; },
    setQuality() {},
    dispose() {},
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Enemies: one cube that chases the player and swipes. Respawns 5 s after it dies.
// ---------------------------------------------------------------------------------------------------------------------
export function createEnemies(scene: THREE.Scene, world: World, look: Look, _quality: Quality): Enemies {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const mat = look.toon({ color: "#5b3a6e" });
  const mesh = new THREE.Mesh(geo, mat);
  group.add(mesh);
  scene.add(group);
  const e: EnemyState = newEnemyState(0, "brambling");
  const list: EnemyState[] = [e];
  const events: GameEvent[] = [];
  const pending: GameEvent[] = [];
  const claw: Strike = { team: "enemy", source: 0, origin: { x: 0, y: 0, z: 0 }, yaw: 0, reach: 1.4, arc: 1.6, height: 1, damage: ENEMY.brambling.damage, kind: "claw", knockback: 3 };
  let respawn = 0;
  let cd = 0;
  function spawn() {
    const x = PLAYER_SPAWN.x + 6, z = PLAYER_SPAWN.z - 14;
    e.pos.set(x, world.heightAt(x, z), z);
    e.home.copy(e.pos);
    e.hp = e.maxHp;
    e.alive = true;
    e.lockable = true;
    e.brain = "idle";
    e.group = "mock";
    mesh.visible = true;
  }
  spawn();
  return {
    list,
    group,
    update(ctx) {
      events.length = 0;
      for (const p of pending) events.push(p);
      pending.length = 0;
      const dt = ctx.dt;
      if (!e.alive) {
        respawn -= dt;
        if (respawn <= 0) spawn();
        return events;
      }
      const p = ctx.player.pos;
      const dx = p.x - e.pos.x, dz = p.z - e.pos.z, d = Math.hypot(dx, dz);
      cd -= dt;
      if (d < 15 && d > 1.2) {
        if (e.brain === "idle") events.push({ type: "enemyAlert", id: 0, kind: e.kind, pos: { x: e.pos.x, y: e.pos.y, z: e.pos.z } });
        e.brain = "chase";
        e.vel.set((dx / d) * 3, 0, (dz / d) * 3);
      } else {
        e.vel.set(0, 0, 0);
        if (d >= 15) e.brain = "idle";
      }
      e.pos.addScaledVector(e.vel, dt);
      e.pos.y = world.heightAt(e.pos.x, e.pos.z);
      if (d > 0.01) e.yaw = Math.atan2(dx, dz);
      if (d < 1.6 && cd <= 0 && ctx.player.hp > 0) {
        cd = 1.5;
        claw.origin.x = e.pos.x; claw.origin.y = e.pos.y + 0.5; claw.origin.z = e.pos.z;
        claw.yaw = e.yaw;
        ctx.combat.strike(claw);
      }
      e.aimPoint.set(e.pos.x, e.pos.y + 0.5, e.pos.z);
      mesh.position.copy(e.pos);
      mesh.rotation.y = e.yaw;
      return events;
    },
    handle(evs) {
      for (const ev of evs) {
        if (ev.type !== "hit" || ev.team !== "player" || ev.target !== 0 || !e.alive) continue;
        e.hp -= ev.damage;
        e.pos.x += ev.dir.x * 0.6;
        e.pos.z += ev.dir.z * 0.6;
        const pos = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
        pending.push({ type: "enemyHurt", id: 0, kind: e.kind, pos, hp: e.hp });
        if (e.hp <= 0) {
          e.alive = false;
          e.lockable = false;
          e.brain = "dead";
          mesh.visible = false;
          respawn = 5;
          pending.push({ type: "enemyDied", id: 0, kind: e.kind, pos, group: e.group });
        }
      }
    },
    boss: () => null,
    clear() {
      e.alive = false;
      mesh.visible = false;
      respawn = 5;
    },
    setQuality() {},
    dispose() {
      scene.remove(group);
      geo.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Input: WASD / arrows, Space, Shift, J or LMB attack, K block, L dodge, F bow, G glide, Q lock, E use, M map, Esc.
// Mouse: pointer lock on click when available, else drag to look. Touch: left half = stick, right half = look,
// short tap on the right half = jump. Gamepad: standard mapping.
// ---------------------------------------------------------------------------------------------------------------------
const KEYMAP: Record<string, BtnName> = {
  Space: "jump", KeyJ: "attack", KeyK: "block", KeyL: "dodge", ShiftLeft: "sprint", ShiftRight: "sprint", KeyF: "bow",
  KeyG: "glide", KeyQ: "lock", Tab: "lock", KeyE: "use", KeyM: "map", Escape: "pause", KeyP: "pause",
};
const PADMAP: [number, BtnName][] = [[0, "jump"], [2, "attack"], [6, "block"], [1, "dodge"], [7, "bow"], [5, "lock"], [3, "use"], [8, "map"], [9, "pause"]];

export function createInput(canvas: HTMLCanvasElement, _container: HTMLElement): Input {
  const state = newInputState();
  const raw = {} as Record<BtnName, boolean>;
  const latch = {} as Record<BtnName, boolean>; // a press shorter than one frame still counts
  for (const b of BTN_NAMES) raw[b] = latch[b] = false;
  const keys = new Set<string>();
  let lookX = 0, lookY = 0, zoom = 0, enabled = true, sens = 1, invert = false;
  let dragging = false, lastX = 0, lastY = 0;
  let stickId = -1, stickX0 = 0, stickY0 = 0, stickDX = 0, stickDY = 0;
  let lookId = -1, lookT0 = 0, lookMoved = 0, tapJump = false;
  const navs = new Set<(d: "up" | "down" | "left" | "right" | "ok" | "back") => void>();

  const onKey = (down: boolean) => (ev: KeyboardEvent) => {
    if (ev.code === "Tab") ev.preventDefault();
    if (down) keys.add(ev.code);
    else keys.delete(ev.code);
    const b = KEYMAP[ev.code];
    if (b) {
      raw[b] = down;
      if (down) latch[b] = true;
    }
    if (down) {
      state.device = "keys";
      const d = ev.code === "ArrowUp" ? "up" : ev.code === "ArrowDown" ? "down" : ev.code === "ArrowLeft" ? "left" : ev.code === "ArrowRight" ? "right" : ev.code === "Enter" ? "ok" : ev.code === "Escape" ? "back" : null;
      if (d) for (const cb of navs) cb(d);
    }
  };
  const kd = onKey(true), ku = onKey(false);
  const onMouseDown = (ev: MouseEvent) => {
    if (!enabled) return;
    state.device = "keys";
    if (ev.button === 0) raw.attack = latch.attack = true;
    if (ev.button === 2) raw.block = latch.block = true;
    dragging = true;
    lastX = ev.clientX;
    lastY = ev.clientY;
    if (!document.pointerLockElement) {
      try {
        const r = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        r?.catch?.(() => {});
      } catch {}
    }
  };
  const onMouseUp = (ev: MouseEvent) => {
    if (ev.button === 0) raw.attack = false;
    if (ev.button === 2) raw.block = false;
    dragging = false;
  };
  const onMouseMove = (ev: MouseEvent) => {
    if (!enabled) return;
    if (document.pointerLockElement === canvas) {
      lookX += ev.movementX * 0.0025;
      lookY += ev.movementY * 0.0025;
    } else if (dragging) {
      lookX += (ev.clientX - lastX) * 0.005;
      lookY += (ev.clientY - lastY) * 0.005;
      lastX = ev.clientX;
      lastY = ev.clientY;
    }
  };
  const onWheel = (ev: WheelEvent) => {
    zoom += ev.deltaY * 0.01;
  };
  const onCtx = (ev: Event) => ev.preventDefault();
  const onTouchStart = (ev: TouchEvent) => {
    state.device = "touch";
    for (const t of Array.from(ev.changedTouches)) {
      if (t.clientX < window.innerWidth / 2 && stickId < 0) {
        stickId = t.identifier;
        stickX0 = t.clientX;
        stickY0 = t.clientY;
        stickDX = stickDY = 0;
      } else if (lookId < 0) {
        lookId = t.identifier;
        lastX = t.clientX;
        lastY = t.clientY;
        lookT0 = performance.now();
        lookMoved = 0;
      }
    }
    ev.preventDefault();
  };
  const onTouchMove = (ev: TouchEvent) => {
    for (const t of Array.from(ev.changedTouches)) {
      if (t.identifier === stickId) {
        stickDX = t.clientX - stickX0;
        stickDY = t.clientY - stickY0;
      } else if (t.identifier === lookId) {
        const dx = t.clientX - lastX, dy = t.clientY - lastY;
        lookX += dx * 0.008;
        lookY += dy * 0.008;
        lookMoved += Math.abs(dx) + Math.abs(dy);
        lastX = t.clientX;
        lastY = t.clientY;
      }
    }
    ev.preventDefault();
  };
  const onTouchEnd = (ev: TouchEvent) => {
    for (const t of Array.from(ev.changedTouches)) {
      if (t.identifier === stickId) {
        stickId = -1;
        stickDX = stickDY = 0;
      } else if (t.identifier === lookId) {
        lookId = -1;
        if (performance.now() - lookT0 < 220 && lookMoved < 12) tapJump = true;
      }
    }
  };
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);
  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("wheel", onWheel, { passive: true });
  canvas.addEventListener("contextmenu", onCtx);
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  canvas.addEventListener("touchmove", onTouchMove, { passive: false });
  canvas.addEventListener("touchend", onTouchEnd);
  canvas.addEventListener("touchcancel", onTouchEnd);

  return {
    state,
    update(dt) {
      let mx = 0, my = 0;
      if (keys.has("KeyW") || keys.has("ArrowUp")) my += 1;
      if (keys.has("KeyS") || keys.has("ArrowDown")) my -= 1;
      if (keys.has("KeyD") || keys.has("ArrowRight")) mx += 1;
      if (keys.has("KeyA") || keys.has("ArrowLeft")) mx -= 1;
      if (stickId >= 0) {
        mx = stickDX / 60;
        my = -stickDY / 60;
      }
      const pad = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads()[0] : null;
      const padDown: Partial<Record<BtnName, boolean>> = {};
      if (pad && pad.connected) {
        const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
        const ax = dz(pad.axes[0] ?? 0), ay = dz(pad.axes[1] ?? 0), lx = dz(pad.axes[2] ?? 0), ly = dz(pad.axes[3] ?? 0);
        if (ax || ay) { mx = ax; my = -ay; state.device = "pad"; }
        if (lx || ly) { lookX += lx * 3 * dt; lookY += ly * 2 * dt; state.device = "pad"; }
        for (const [i, b] of PADMAP) if (pad.buttons[i]?.pressed) { padDown[b] = true; state.device = "pad"; }
        if (pad.buttons[1]?.pressed) padDown.sprint = true;
      }
      const len = Math.hypot(mx, my);
      if (len > 1) { mx /= len; my /= len; }
      state.move.x = enabled ? mx : 0;
      state.move.y = enabled ? my : 0;
      state.look.x = enabled ? lookX * sens : 0;
      state.look.y = enabled ? lookY * sens * (invert ? -1 : 1) : 0;
      state.zoom = enabled ? zoom : 0;
      lookX = lookY = zoom = 0;
      if (tapJump) padDown.jump = true;
      for (const n of BTN_NAMES) {
        const b = state.btn[n];
        const down = enabled && (raw[n] || latch[n] || padDown[n] === true);
        latch[n] = false;
        b.pressed = down && !b.down;
        b.released = !down && b.down;
        b.down = down;
        b.held = down ? b.held + dt : 0;
      }
      tapJump = false;
      state.aim = state.btn.bow.down;
      state.pointerLocked = document.pointerLockElement === canvas;
    },
    setTouchVisible() {},
    setPrompt() {},
    setSettings(s: Settings) {
      sens = s.lookSens;
      invert = s.invertY;
    },
    setEnabled(on) {
      enabled = on;
      if (!on && document.pointerLockElement) document.exitPointerLock();
    },
    onNav(cb) {
      navs.add(cb);
      return () => void navs.delete(cb);
    },
    rumble(strength, seconds) {
      const pad = navigator.getGamepads?.()[0] as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null;
      pad?.vibrationActuator?.playEffect?.("dual-rumble", { duration: seconds * 1000, strongMagnitude: strength, weakMagnitude: strength })?.catch(() => {});
    },
    dispose() {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onCtx);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchEnd);
      navs.clear();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Camera: orbit behind the player at a fixed distance. No collision, no lock-on.
// ---------------------------------------------------------------------------------------------------------------------
export function createCamera(camera: THREE.PerspectiveCamera, _world: World): CameraRig {
  let yaw = Math.PI, pitch = 0.32, dist = 7;
  const target = new THREE.Vector3();
  const v = new THREE.Vector3();
  const events: GameEvent[] = [];
  let snap = true;
  return {
    get yaw() { return yaw; },
    get pitch() { return pitch; },
    lockId: -1,
    update(ctx) {
      events.length = 0;
      yaw -= ctx.input.look.x;
      pitch = Math.max(-0.5, Math.min(1.2, pitch + ctx.input.look.y));
      dist = Math.max(3, Math.min(14, dist + ctx.input.zoom));
      const p = ctx.player.pos;
      const k = snap ? 1 : Math.min(1, ctx.realDt * 10);
      snap = false;
      target.x += (p.x - target.x) * k;
      target.y += (p.y + 1.5 - target.y) * k;
      target.z += (p.z - target.z) * k;
      const cp = Math.cos(pitch);
      camera.position.set(target.x - Math.sin(yaw) * cp * dist, target.y + Math.sin(pitch) * dist, target.z - Math.cos(yaw) * cp * dist);
      camera.lookAt(target);
      return events;
    },
    handle() {},
    toScreen(p: V3, out: ScreenPoint) {
      v.set(p.x, p.y, p.z).project(camera);
      const w = window.innerWidth, h = window.innerHeight; // the canvas fills the viewport
      out.x = (v.x * 0.5 + 0.5) * w;
      out.y = (-v.y * 0.5 + 0.5) * h;
      out.on = v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
      return out;
    },
    snapBehind() {
      snap = true;
    },
    setSettings() {},
    dispose() {},
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Audio: silent.
// ---------------------------------------------------------------------------------------------------------------------
export function createAudio(_ac: AudioContext): Audio {
  return {
    update() {},
    handle() {},
    ui() {},
    setVolumes() {},
    menuMusic() {},
    suspend() {},
    dispose() {},
  };
}
