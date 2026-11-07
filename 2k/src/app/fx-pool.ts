// HOOPS fx: one particle pool, one draw call. Premultiplied alpha blending lets additive glows (alpha 0) and lit
// opaque bits like confetti (alpha 1) share a single material. CPU integrates; the GPU shapes each sprite by kind.
// Owner: audio-fx.
import * as THREE from "three";

export const K = {
  glow: 0, // soft additive dot
  spark: 1, // velocity-stretched additive streak
  confetti: 2, // tumbling paper in 3D, lit, metallic glints
  drop: 3, // sweat / spray droplet, stretched, specular
  flash: 4, // camera flash star in the crowd
  ring: 5, // floor-aligned shockwave ring
  floorGlow: 6, // floor-aligned soft glow (scuff trail)
  ember: 7, // flickering fire ember
  dust: 8, // soft floor dust puff (normal blend)
  glint: 9, // 4-point twinkle
} as const;

const VERT = /* glsl */ `
attribute vec4 iPos;   // xyz, size
attribute vec4 iVel;   // velocity xyz, stretch (or confetti spin angle)
attribute vec4 iCol;   // rgb (may exceed 1 for hdr), additive 0..1
attribute vec4 iData;  // t 0..1, seed, kind, alpha
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vData;
varying float vShade;
uniform vec3 uCam;
void main() {
  float kind = iData.z;
  vec2 q = position.xy * 2.0;
  vUv = q;
  vCol = iCol;
  vData = iData;
  vShade = 1.0;
  float sz = iPos.w;
  vec4 mv;
  if (kind > 4.5 && kind < 6.5) {
    // flat on the floor
    vec3 w = iPos.xyz + vec3(q.x * sz, 0.0, q.y * sz);
    mv = viewMatrix * vec4(w, 1.0);
  } else if (kind > 1.5 && kind < 2.5) {
    // confetti: a small rectangle rotated around a per-particle axis
    float s = iData.y * 6.2831;
    vec3 ax = normalize(vec3(sin(s * 3.1), cos(s * 1.7), sin(s * 2.3) + 0.2));
    float a = iVel.w;
    float c = cos(a), sn = sin(a);
    vec3 p = vec3(q.x * sz * 0.55, q.y * sz * 0.32, 0.0);
    vec3 r = p * c + cross(ax, p) * sn + ax * dot(ax, p) * (1.0 - c);
    vec3 n0 = vec3(0.0, 0.0, 1.0);
    vec3 n = n0 * c + cross(ax, n0) * sn + ax * dot(ax, n0) * (1.0 - c);
    vec3 w = iPos.xyz + r;
    vec3 v = normalize(uCam - w);
    vec3 l = normalize(vec3(0.2, 1.0, -0.3));
    float diff = abs(dot(n, l)) * 0.65 + 0.35;
    vec3 h = normalize(l + v);
    float spec = pow(abs(dot(n, h)), 40.0);
    vShade = diff + spec * (2.5 + 6.0 * step(0.75, fract(iData.y * 13.0)));
    mv = viewMatrix * vec4(w, 1.0);
  } else {
    mv = viewMatrix * vec4(iPos.xyz, 1.0);
    if (iVel.w > 0.0) {
      vec3 vv = mat3(viewMatrix) * iVel.xyz;
      vec2 sv = vv.xy * iVel.w;
      float sl = length(sv);
      vec2 sd = sl > 1e-5 ? sv / sl : vec2(0.0, 1.0);
      vec2 sn = vec2(sd.y, -sd.x);
      mv.xy += sn * (q.x * sz) + sd * (q.y * (sz + sl));
    } else {
      float a = iData.y * 6.2831 + iData.x * (iData.y - 0.5) * 3.0;
      if ((kind > 3.5 && kind < 4.5) || kind > 8.5) a = 0.0;
      mv.xy += mat2(cos(a), sin(a), -sin(a), cos(a)) * q * sz;
    }
  }
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vData;
varying float vShade;
void main() {
  float t = vData.x, seed = vData.y, kind = vData.z, alpha = vData.w;
  float r = length(vUv);
  vec3 col = vCol.rgb;
  float a = 0.0;
  float add = vCol.a;
  if (kind < 0.5) {
    a = exp(-r * r * 4.0);
  } else if (kind < 1.5) {
    a = smoothstep(1.0, 0.0, abs(vUv.x)) * smoothstep(1.0, 0.2, abs(vUv.y));
    col *= 1.0 + 1.5 * (1.0 - abs(vUv.x));
  } else if (kind < 2.5) {
    vec2 qq = abs(vUv);
    a = step(qq.x, 0.98) * step(qq.y, 0.98);
    col *= vShade;
  } else if (kind < 3.5) {
    a = smoothstep(1.0, 0.55, r);
    float hl = smoothstep(0.45, 0.0, length(vUv - vec2(-0.3, 0.35)));
    col = col * (0.6 + 0.4 * (1.0 - r)) + vec3(hl * 1.5);
  } else if (kind < 4.5) {
    vec2 qq = abs(vUv);
    float core = exp(-r * r * 30.0);
    float rays = exp(-qq.x * 22.0) * exp(-qq.y * 2.2) + exp(-qq.y * 22.0) * exp(-qq.x * 2.2);
    float halo = exp(-r * r * 5.0) * 0.25;
    a = clamp(core + rays * 0.8 + halo, 0.0, 1.0);
  } else if (kind < 5.5) {
    float w = 0.08 + 0.1 * (1.0 - t);
    a = smoothstep(w, 0.0, abs(r - 0.85)) * step(r, 1.0);
  } else if (kind < 6.5) {
    a = exp(-r * r * 3.5) * step(r, 1.0);
  } else if (kind < 7.5) {
    float fl = 0.65 + 0.35 * sin(uTime * 40.0 + seed * 50.0);
    a = exp(-r * r * 5.0) * fl;
    col = mix(col, vec3(1.0, 0.9, 0.6) * 4.0, exp(-r * r * 20.0));
  } else if (kind < 8.5) {
    a = smoothstep(1.0, 0.0, r) * 0.55;
  } else {
    vec2 qq = abs(vUv);
    float rays = exp(-qq.x * 16.0) * exp(-qq.y * 3.0) + exp(-qq.y * 16.0) * exp(-qq.x * 3.0);
    a = clamp(rays + exp(-r * r * 18.0), 0.0, 1.0);
  }
  a *= alpha;
  if (a < 0.003) discard;
  // premultiplied: additive sprites write alpha 0
  gl_FragColor = vec4(col * a, a * (1.0 - add));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface Spawn {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  size: number; grow: number; life: number; kind: number;
  r: number; g: number; b: number; add: number; alpha: number;
  drag: number; grav: number; stretch: number; spin: number; flutter: number; bounce: number;
}

/** Reusable spawn record so callers never allocate. */
export function spawnRec(): Spawn {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0.05, grow: 0, life: 1, kind: 0, r: 1, g: 1, b: 1, add: 1, alpha: 1, drag: 0, grav: 0, stretch: 0, spin: 0, flutter: 0, bounce: 0.3 };
}

export function createPool(scene: THREE.Scene, max: number) {
  const px = new Float32Array(max), py = new Float32Array(max), pz = new Float32Array(max);
  const vx = new Float32Array(max), vy = new Float32Array(max), vz = new Float32Array(max);
  const size = new Float32Array(max), grow = new Float32Array(max), life = new Float32Array(max), age = new Float32Array(max);
  const kind = new Float32Array(max), seed = new Float32Array(max), drag = new Float32Array(max), grav = new Float32Array(max);
  const cr = new Float32Array(max), cg = new Float32Array(max), cb = new Float32Array(max), add = new Float32Array(max);
  const alpha = new Float32Array(max), stretch = new Float32Array(max), spin = new Float32Array(max), ang = new Float32Array(max);
  const flutter = new Float32Array(max), bounce = new Float32Array(max), landed = new Float32Array(max);
  const posA = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const velA = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const colA = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const datA = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("iPos", posA);
  geo.setAttribute("iVel", velA);
  geo.setAttribute("iCol", colA);
  geo.setAttribute("iData", datA);
  geo.instanceCount = 0;
  const uniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() } };
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 30;
  mesh.name = "fx-particles";
  scene.add(mesh);
  let n = 0;
  let cap = max;
  let time = 0;
  let seedK = 0.6180339;

  function spawn(s: Spawn) {
    let i: number;
    if (n < cap) i = n++;
    else {
      // full: recycle the oldest-looking slot by progress instead of dropping big moments
      i = Math.floor(Math.random() * n);
      if (age[i] / life[i] < 0.5) return;
    }
    px[i] = s.x; py[i] = s.y; pz[i] = s.z; vx[i] = s.vx; vy[i] = s.vy; vz[i] = s.vz;
    size[i] = s.size; grow[i] = s.grow; life[i] = Math.max(0.02, s.life); age[i] = 0; kind[i] = s.kind;
    seedK = (seedK + 0.6180339887) % 1;
    seed[i] = (seedK + Math.random() * 0.1) % 1;
    drag[i] = s.drag; grav[i] = s.grav; cr[i] = s.r; cg[i] = s.g; cb[i] = s.b; add[i] = s.add; alpha[i] = s.alpha;
    stretch[i] = s.stretch; spin[i] = s.spin; ang[i] = Math.random() * 6.28; flutter[i] = s.flutter; bounce[i] = s.bounce; landed[i] = 0;
  }

  function kill(i: number) {
    const j = --n;
    px[i] = px[j]; py[i] = py[j]; pz[i] = pz[j]; vx[i] = vx[j]; vy[i] = vy[j]; vz[i] = vz[j];
    size[i] = size[j]; grow[i] = grow[j]; life[i] = life[j]; age[i] = age[j]; kind[i] = kind[j]; seed[i] = seed[j];
    drag[i] = drag[j]; grav[i] = grav[j]; cr[i] = cr[j]; cg[i] = cg[j]; cb[i] = cb[j]; add[i] = add[j]; alpha[i] = alpha[j];
    stretch[i] = stretch[j]; spin[i] = spin[j]; ang[i] = ang[j]; flutter[i] = flutter[j]; bounce[i] = bounce[j]; landed[i] = landed[j];
  }

  function update(dt: number, camera: THREE.Camera) {
    time += dt;
    uniforms.uTime.value = time;
    camera.getWorldPosition(uniforms.uCam.value);
    const P = posA.array as Float32Array, V = velA.array as Float32Array, C = colA.array as Float32Array, D = datA.array as Float32Array;
    let i = 0;
    while (i < n) {
      age[i] += dt;
      if (age[i] >= life[i]) {
        kill(i);
        continue;
      }
      const k = kind[i];
      const dk = Math.exp(-drag[i] * dt);
      vx[i] *= dk; vz[i] *= dk;
      vy[i] = vy[i] * dk - grav[i] * dt;
      if (flutter[i] > 0 && landed[i] === 0) {
        // paper: side-slip that follows the tumble, terminal velocity from the drag
        const ph = time * (3 + seed[i] * 4) + seed[i] * 40;
        vx[i] += Math.sin(ph) * flutter[i] * dt;
        vz[i] += Math.cos(ph * 0.83) * flutter[i] * dt;
      }
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      if (py[i] < 0.004 && (k === K.confetti || k === K.drop || k === K.spark || k === K.dust)) {
        py[i] = 0.004;
        if (k === K.confetti) {
          if (landed[i] === 0) {
            landed[i] = 1;
            // lie on the floor for a while, then fade
            life[i] = Math.min(life[i], age[i] + 2.5 + seed[i] * 2);
          }
          vx[i] = vz[i] = vy[i] = 0;
        } else {
          vy[i] = Math.abs(vy[i]) * bounce[i];
          vx[i] *= 0.6; vz[i] *= 0.6;
        }
      }
      if (landed[i] === 0) ang[i] += spin[i] * dt;
      const t = age[i] / life[i];
      size[i] = Math.max(0.001, size[i] + grow[i] * dt);
      const o = i * 4;
      P[o] = px[i]; P[o + 1] = py[i]; P[o + 2] = pz[i]; P[o + 3] = size[i];
      V[o] = vx[i]; V[o + 1] = vy[i]; V[o + 2] = vz[i];
      V[o + 3] = k === K.confetti ? (landed[i] ? 1.5708 + seed[i] * 0.4 : ang[i]) : stretch[i];
      C[o] = cr[i]; C[o + 1] = cg[i]; C[o + 2] = cb[i]; C[o + 3] = add[i];
      let fade: number;
      if (k === K.flash) fade = t < 0.15 ? t / 0.15 : Math.pow(1 - (t - 0.15) / 0.85, 2.2);
      else if (k === K.confetti) fade = t > 0.9 ? (1 - t) / 0.1 : 1;
      else if (k === K.ring) fade = 1 - t;
      else fade = Math.min(1, age[i] * 30) * (t > 0.35 ? 1 - (t - 0.35) / 0.65 : 1);
      D[o] = t; D[o + 1] = seed[i]; D[o + 2] = k; D[o + 3] = alpha[i] * fade;
      i++;
    }
    geo.instanceCount = n;
    if (n > 0) {
      posA.addUpdateRange(0, n * 4);
      velA.addUpdateRange(0, n * 4);
      colA.addUpdateRange(0, n * 4);
      datA.addUpdateRange(0, n * 4);
      posA.needsUpdate = velA.needsUpdate = colA.needsUpdate = datA.needsUpdate = true;
    }
  }

  return {
    spawn,
    update,
    get count() {
      return n;
    },
    setCap(c: number) {
      cap = Math.max(16, Math.min(max, c));
      while (n > cap) kill(n - 1);
    },
    clear() {
      n = 0;
      geo.instanceCount = 0;
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      base.dispose();
      mat.dispose();
    },
  };
}
export type Pool = ReturnType<typeof createPool>;
