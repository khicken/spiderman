import * as THREE from "three";

const MAX = 3000;

export type Puff = { speed?: number; size?: number; grow?: number; life?: number; rise?: number; tint?: number; spread?: number };

type Emitter = { at: () => THREE.Vector3 | null; rate: number; until: number; acc: number; opts: Puff };

export function createFx(scene: THREE.Scene) {
  const pos = new Float32Array(MAX * 3);
  const size = new Float32Array(MAX);
  const alpha = new Float32Array(MAX);
  const tint = new Float32Array(MAX);
  const vel = new Float32Array(MAX * 3);
  const life = new Float32Array(MAX);
  const span = new Float32Array(MAX);
  const s0 = new Float32Array(MAX);
  const s1 = new Float32Array(MAX);
  const geo = new THREE.BufferGeometry();
  const attr = (a: Float32Array, n: number) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", attr(pos, 3));
  geo.setAttribute("aSize", attr(size, 1));
  geo.setAttribute("aAlpha", attr(alpha, 1));
  geo.setAttribute("aTint", attr(tint, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uScale: { value: 400 } },
    vertexShader: /* glsl */ `
      attribute float aSize; attribute float aAlpha; attribute float aTint;
      uniform float uScale; varying float vA; varying float vT;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / max(0.5, -mv.z);
        vA = aAlpha * smoothstep(0.3, 2.0, -mv.z);
        vT = aTint;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA; varying float vT;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.1, d) * vA;
        if (a < 0.004) discard;
        gl_FragColor = vec4(mix(vec3(0.93, 0.93, 0.92), vec3(0.95, 0.58, 0.5), vT), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 2;
  scene.add(points);

  let budget = 1500;
  let next = 0;
  const emitters: Emitter[] = [];
  let now = 0;

  const spawn = (p: THREE.Vector3, o: Puff) => {
    const i = next;
    next = (next + 1) % budget;
    const sp = o.speed ?? 2;
    const spread = o.spread ?? 0.4;
    pos.set([p.x + (Math.random() - 0.5) * spread, p.y + (Math.random() - 0.5) * spread, p.z + (Math.random() - 0.5) * spread], i * 3);
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    vel.set([Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp * 0.5 + (o.rise ?? 1.5), Math.sin(ph) * Math.sin(th) * sp], i * 3);
    span[i] = life[i] = (o.life ?? 2.5) * (0.7 + Math.random() * 0.6);
    s0[i] = (o.size ?? 1.5) * (0.7 + Math.random() * 0.6);
    s1[i] = s0[i] * (o.grow ?? 3);
    tint[i] = o.tint ?? 0;
  };

  return {
    burst(p: THREE.Vector3, n: number, o: Puff = {}) {
      for (let k = 0; k < n; k++) spawn(p, o);
    },
    emit(at: () => THREE.Vector3 | null, rate: number, duration: number, opts: Puff = {}) {
      emitters.push({ at, rate, until: now + duration, acc: 0, opts });
    },
    setBudget(n: number) {
      budget = Math.min(MAX, n);
      next = 0;
      life.fill(0);
      alpha.fill(0);
    },
    resize(h: number) {
      mat.uniforms.uScale.value = h * 0.5;
    },
    update(dt: number) {
      now += dt;
      for (let k = emitters.length - 1; k >= 0; k--) {
        const e = emitters[k];
        const p = now < e.until ? e.at() : null;
        if (!p) {
          emitters.splice(k, 1);
          continue;
        }
        e.acc += e.rate * dt;
        while (e.acc >= 1) {
          e.acc -= 1;
          spawn(p, e.opts);
        }
      }
      const drag = Math.exp(-1.2 * dt);
      for (let i = 0; i < budget; i++) {
        if (life[i] <= 0) {
          alpha[i] = 0;
          continue;
        }
        life[i] -= dt;
        const k = 1 - life[i] / span[i];
        vel[i * 3] *= drag;
        vel[i * 3 + 1] = vel[i * 3 + 1] * drag + 0.6 * dt;
        vel[i * 3 + 2] *= drag;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        size[i] = s0[i] + (s1[i] - s0[i]) * Math.sqrt(k);
        alpha[i] = Math.min(1, k * 6) * (1 - k) * 0.55;
      }
      for (const n of ["position", "aSize", "aAlpha", "aTint"]) geo.attributes[n].needsUpdate = true;
      geo.setDrawRange(0, budget);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

export type Fx = ReturnType<typeof createFx>;
