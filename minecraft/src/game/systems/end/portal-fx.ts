import * as THREE from "three";
import type { BlockState, GameCtx } from "../../contracts";
import { blockByName } from "../../blocks/registry";

const MAX = 512;
const PORTAL = blockByName("end_portal")?.id ?? -1;
const GATEWAY = blockByName("end_gateway")?.id ?? -1;

const VERT = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uScale;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 layerColor(float i) {
  return vec3(0.5 + 0.5 * sin(i * 1.7 + 0.3), 0.4 + 0.5 * sin(i * 2.3 + 2.1), 0.6 + 0.4 * sin(i * 0.9 + 4.0)) * (1.0 - i / 18.0);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uScale;
  vec3 col = vec3(0.035, 0.07, 0.085);
  for (int k = 0; k < 12; k++) {
    float i = float(k);
    float a = i * 0.97;
    mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a));
    vec2 p = r * (uv * (1.0 + i * 0.45)) + vec2(uTime * 0.012 * (1.0 + i * 0.2), uTime * 0.004 * i);
    vec2 cell = floor(p * 48.0);
    float h = hash(cell + i * 13.1);
    col += step(0.982, h) * layerColor(i) * 0.9;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const e3 = new THREE.Euler();
const v3 = new THREE.Vector3();
const s3 = new THREE.Vector3();

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const isPortalState = (s: BlockState) => {
  const id = s & 0xfff;
  return id === PORTAL || id === GATEWAY;
};

export function createPortalFx() {
  const blocks = new Map<string, { x: number; y: number; z: number; gateway: boolean }>();
  const uniforms = { uTime: { value: 0 }, uScale: { value: 500 } };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide });
  const slabGeo = new THREE.PlaneGeometry(1, 1);
  slabGeo.rotateX(-Math.PI / 2);
  slabGeo.translate(0.5, 0.75, 0.5);
  const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
  cubeGeo.translate(0.5, 0.5, 0.5);
  const portals = new THREE.InstancedMesh(slabGeo, mat, MAX);
  const gateways = new THREE.InstancedMesh(cubeGeo, mat, 64);
  portals.frustumCulled = gateways.frustumCulled = false;
  portals.count = gateways.count = 0;

  const RAYS = 120;
  const rayGeo = new THREE.BufferGeometry();
  const rayPos = new Float32Array(RAYS * 9);
  const rayCol = new Float32Array(RAYS * 12);
  rayGeo.setAttribute("position", new THREE.BufferAttribute(rayPos, 3));
  rayGeo.setAttribute("color", new THREE.BufferAttribute(rayCol, 4));
  const rayMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const rays = new THREE.Mesh(rayGeo, rayMat);
  rays.frustumCulled = false;
  rays.visible = false;
  let scene: THREE.Scene | null = null;
  let dirty = true;
  let time = 0;

  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

  function note(x: number, y: number, z: number, s: BlockState) {
    const k = key(x, y, z);
    const id = s & 0xfff;
    if (id === PORTAL || id === GATEWAY) {
      const prev = blocks.get(k);
      if (!prev || prev.gateway !== (id === GATEWAY)) {
        blocks.set(k, { x, y, z, gateway: id === GATEWAY });
        dirty = true;
      }
    } else if (blocks.delete(k)) dirty = true;
  }

  function scan(ctx: GameCtx, cx: number, cy: number, cz: number, r: number, ry: number) {
    const w = ctx.world;
    for (let y = cy - ry; y <= cy + ry; y++)
      for (let z = cz - r; z <= cz + r; z++)
        for (let x = cx - r; x <= cx + r; x++) {
          const s = w.getBlock(x, y, z);
          if (s !== 0 || blocks.has(key(x, y, z))) note(x, y, z, s);
        }
  }

  function rebuild(ctx: GameCtx) {
    dirty = false;
    let np = 0, ng = 0;
    for (const [k, b] of blocks) {
      if (!ctx.world.isLoaded(b.x, b.z)) continue;
      if (!isPortalState(ctx.world.getBlock(b.x, b.y, b.z))) {
        blocks.delete(k);
        continue;
      }
      m4.makeTranslation(b.x, b.y, b.z);
      if (b.gateway && ng < 64) gateways.setMatrixAt(ng++, m4);
      else if (!b.gateway && np < MAX) portals.setMatrixAt(np++, m4);
    }
    portals.count = np;
    gateways.count = ng;
    portals.instanceMatrix.needsUpdate = true;
    gateways.instanceMatrix.needsUpdate = true;
  }

  // Vanilla EnderDragonRenderer death rays: a fixed seed, more rays as the animation runs, white core to magenta tips.
  function drawRays(x: number, y: number, z: number, f: number) {
    const rnd = mulberry(432);
    const n = Math.min(RAYS, Math.floor(((f + f * f) / 2) * 60));
    const fade = Math.max(0, f > 0.8 ? (f - 0.8) / 0.2 : 0);
    for (let i = 0; i < RAYS; i++) {
      const o = i * 9, c = i * 12;
      if (i >= n) {
        rayPos.fill(0, o, o + 9);
        continue;
      }
      e3.set(rnd() * Math.PI * 2, rnd() * Math.PI * 2, rnd() * Math.PI * 2);
      q.setFromEuler(e3);
      e3.set(rnd() * Math.PI * 2, rnd() * Math.PI * 2, rnd() * Math.PI * 2 + f * Math.PI / 2);
      q.multiply(q2.setFromEuler(e3));
      const len = rnd() * 20 + 5 + fade * 10;
      const wid = (rnd() * 2 + 1 + fade * 2) * 0.866;
      m4.compose(v3.set(x, y, z), q, s3.set(1, 1, 1));
      const put = (k: number, px: number, py: number, pz: number) => {
        v3.set(px, py, pz).applyMatrix4(m4);
        rayPos[o + k * 3] = v3.x;
        rayPos[o + k * 3 + 1] = v3.y;
        rayPos[o + k * 3 + 2] = v3.z;
      };
      put(0, 0, 0, 0);
      put(1, -wid, len, -0.5 * wid);
      put(2, wid, len, -0.5 * wid);
      const a = 1 - fade;
      rayCol.set([a, a, a, a, a, 0, a, 0, a, 0, a, 0], c);
    }
    rayGeo.attributes.position.needsUpdate = true;
    rayGeo.attributes.color.needsUpdate = true;
  }

  return {
    stage(ctx: GameCtx) {
      blocks.clear();
      dirty = true;
      scene = ctx.renderer.scene;
      scene.add(portals, gateways, rays);
      const p = ctx.player.body.pos;
      scan(ctx, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z), 12, 8);
      if (ctx.world.dim === "end") scan(ctx, 0, 70, 0, 4, 10);
    },
    unstage() {
      scene?.remove(portals, gateways, rays);
      scene = null;
      blocks.clear();
    },
    onBlock(x: number, y: number, z: number, from: BlockState, to: BlockState) {
      if (isPortalState(from) || isPortalState(to)) note(x, y, z, to);
    },
    tick(ctx: GameCtx) {
      if (ctx.time.tick % 40 === 0) {
        const p = ctx.player.body.pos;
        scan(ctx, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z), 10, 6);
      }
    },
    frame(ctx: GameCtx, dt: number) {
      if (!scene) return;
      time += dt;
      uniforms.uTime.value = time;
      uniforms.uScale.value = Math.max(300, ctx.renderer.renderer.domElement.height * 0.9);
      if (dirty) rebuild(ctx);
      let dying = null;
      for (const e of ctx.entities.all()) if (e.type === "ender_dragon" && typeof e.data.dying === "number") dying = e;
      rays.visible = !!dying;
      if (dying) drawRays(dying.body.pos.x, dying.body.pos.y + 2, dying.body.pos.z, Math.min(1, (dying.data.dying as number) / 200));
    },
    dispose() {
      scene?.remove(portals, gateways, rays);
      slabGeo.dispose();
      cubeGeo.dispose();
      mat.dispose();
      rayGeo.dispose();
      rayMat.dispose();
      portals.dispose();
      gateways.dispose();
    },
  };
}
