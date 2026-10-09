import * as THREE from "three";
import type { AimKind } from "./contracts";
import { SKY } from "./sky-state";

const SEG = 12;
const SPLAT_POP = 0.22;

const ribbonGeo = () => {
  const n = (SEG + 1) * 2;
  const t = new Float32Array(n);
  const side = new Float32Array(n);
  const idx: number[] = [];
  for (let i = 0; i <= SEG; i++) {
    t[i * 2] = t[i * 2 + 1] = i / SEG;
    side[i * 2] = -1;
    side[i * 2 + 1] = 1;
    if (i < SEG) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute("aT", new THREE.BufferAttribute(t, 1));
  g.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
  g.setIndex(idx);
  return g;
};

export function createWebLine(scene: THREE.Scene): {
  update(dt: number, hand: THREE.Vector3, end: THREE.Vector3, endN: THREE.Vector3, travel: number, taut: boolean, visible: boolean, eye: THREE.Vector3): void;
  preview(point: THREE.Vector3 | null, kind: AimKind): void;
  dispose(): void;
} {
  const buf = new THREE.Vector2();
  const pxUniform = { value: 720 };
  const setPx = (renderer: THREE.WebGLRenderer) => {
    renderer.getDrawingBufferSize(buf);
    pxUniform.value = buf.y;
  };

  const lineMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uHand: { value: new THREE.Vector3() }, uEnd: { value: new THREE.Vector3() }, uTravel: { value: 1 }, uSag: { value: 0 }, uWave: { value: 0 }, uTime: { value: 0 } },
    ]),
    vertexShader: `
      attribute float aT;
      attribute float aSide;
      uniform vec3 uHand;
      uniform vec3 uEnd;
      uniform float uTravel;
      uniform float uSag;
      uniform float uWave;
      uniform float uTime;
      uniform float uPx;
      varying float vSide;
      varying float vT;
      varying float vThin;
      #include <fog_pars_vertex>
      void main() {
        vec3 d = (uEnd - uHand) * uTravel;
        float t = aT;
        float bow = 4.0 * t * (1.0 - t);
        float wv = sin(t * 9.0 - uTime * 30.0) * bow * uWave;
        vec3 p = uHand + d * t + vec3(0.0, -uSag * bow + wv, 0.0);
        vec3 tg = d + vec3(0.0, -uSag * (4.0 - 8.0 * t), 0.0);
        vec3 toCam = cameraPosition - p;
        vec3 s = cross(tg, toCam);
        float sl = length(s);
        s = sl > 1e-6 ? s / sl : vec3(0.0, 1.0, 0.0);
        vec4 mvPosition = viewMatrix * vec4(p, 1.0);
        float z = max(-mvPosition.z, 0.05);
        float hw = mix(0.03, 0.015, t);
        float pxHalf = 0.75 * z / (projectionMatrix[1][1] * uPx * 0.5);
        vThin = clamp(hw / pxHalf - 1.0, 0.0, 1.0);
        hw = max(hw, pxHalf);
        p += s * hw * aSide;
        mvPosition = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vSide = aSide;
        vT = t;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uNight;
      varying float vSide;
      varying float vT;
      varying float vThin;
      #include <fog_pars_fragment>
      void main() {
        float n = sqrt(max(1.0 - vSide * vSide, 0.0));
        vec3 base = vec3(0.93, 0.94, 0.97);
        vec3 c = base * (0.62 + 0.38 * n) + vec3(0.35) * pow(n, 10.0) * vThin;
        c *= mix(1.0, 0.45, uNight);
        float a = 1.0 - smoothstep(0.55, 1.0, abs(vSide)) * vThin;
        gl_FragColor = vec4(c, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    fog: true,
  });
  lineMat.uniforms.uPx = pxUniform;
  lineMat.uniforms.uNight = SKY.night;
  const line = new THREE.Mesh(ribbonGeo(), lineMat);
  line.frustumCulled = false;
  line.visible = false;
  line.renderOrder = 2;
  line.onBeforeRender = (renderer) => setPx(renderer);

  const splatMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uPop: { value: 1 } }]),
    vertexShader: `
      varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() {
        vUv = position.xy;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uNight;
      uniform float uPop;
      varying vec2 vUv;
      #include <fog_pars_fragment>
      void main() {
        float r = length(vUv);
        if (r > 1.0) discard;
        float ang = atan(vUv.y, vUv.x);
        float k = 8.0;
        float seg = ang * k / 6.2831853;
        float f = abs(fract(seg + 0.5) - 0.5) * (6.2831853 / k) * r;
        float px = fwidth(r);
        float sw = max(0.03, px * 0.5);
        float spoke = 1.0 - smoothstep(sw, sw + px, f);
        float ringR = r + 0.06 * sin(fract(seg) * 3.14159);
        float dr = abs(fract(ringR * 3.0 + 0.5) - 0.5) / 3.0;
        float rw = max(0.018, px * 0.5);
        float ring = (1.0 - smoothstep(rw, rw + px, dr)) * step(0.15, r);
        float core = 1.0 - smoothstep(0.08, 0.16, r);
        float a = max(max(spoke, ring * 0.9), core) * (1.0 - smoothstep(0.75, 1.0, r));
        a *= smoothstep(0.0, 0.3, uPop);
        if (a < 0.02) discard;
        vec3 c = vec3(0.94, 0.95, 0.98) * mix(1.0, 0.45, uNight);
        gl_FragColor = vec4(c, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    fog: true,
  });
  splatMat.uniforms.uNight = SKY.night;
  const splat = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), splatMat);
  splat.visible = false;
  splat.renderOrder = 2;

  const ringMat = new THREE.ShaderMaterial({
    uniforms: { uCenter: { value: new THREE.Vector3() }, uBright: { value: 1 }, uTime: { value: 0 } },
    vertexShader: `
      uniform vec3 uCenter;
      uniform float uPx;
      uniform float uTime;
      uniform float uBright;
      varying vec2 vUv;
      void main() {
        vUv = position.xy;
        vec4 mv = viewMatrix * vec4(uCenter, 1.0);
        float z = max(-mv.z, 0.1);
        float px = z / (projectionMatrix[1][1] * uPx * 0.5);
        float size = clamp(0.45, 9.0 * px, 20.0 * px) * (1.0 + 0.08 * sin(uTime * 7.0) * uBright);
        mv.xy += position.xy * size;
        mv.xyz += normalize(-mv.xyz) * min(0.6, z * 0.03);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uBright;
      varying vec2 vUv;
      void main() {
        float r = length(vUv);
        float ring = 1.0 - smoothstep(0.08, 0.16, abs(r - 0.78));
        float pip = 1.0 - smoothstep(0.12, 0.2, r);
        float edge = 1.0 - smoothstep(0.16, 0.3, abs(r - 0.78));
        float a = max(ring, pip * uBright) + edge * 0.35;
        a *= mix(0.45, 1.0, uBright);
        if (a < 0.02) discard;
        vec3 c = mix(vec3(0.9), vec3(1.6), uBright);
        float shade = mix(0.25, 1.0, max(ring, pip));
        gl_FragColor = vec4(c * shade, a);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });
  ringMat.uniforms.uPx = pxUniform;
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ringMat);
  ring.frustumCulled = false;
  ring.visible = false;
  ring.renderOrder = 9;
  ring.onBeforeRender = (renderer) => setPx(renderer);

  scene.add(line, splat, ring);

  const lu = lineMat.uniforms;
  const n = new THREE.Vector3();
  const Z = new THREE.Vector3(0, 0, 1);
  let sag = 0;
  let wave = 0;
  let landed = false;
  let pop = 0;
  let time = 0;

  return {
    update(dt, hand, end, endN, travel, taut, visible, eye) {
      time += dt;
      lu.uTime.value = time;
      ringMat.uniforms.uTime.value = time;
      if (!visible) {
        line.visible = splat.visible = false;
        landed = false;
        sag = wave = 0;
        return;
      }
      const tr = Math.min(1, Math.max(0, travel));
      const len = hand.distanceTo(end) * tr;
      const targetSag = taut ? 0 : tr < 1 ? 0.035 * len : Math.min(0.02 * len, 0.8);
      sag += (targetSag - sag) * (1 - Math.exp(-dt * (taut ? 30 : 10)));
      const targetWave = tr < 1 ? 0.08 : 0;
      wave += (targetWave - wave) * (1 - Math.exp(-dt * 12));
      lu.uHand.value.copy(hand);
      lu.uEnd.value.copy(end);
      lu.uTravel.value = tr;
      lu.uSag.value = sag;
      lu.uWave.value = wave;
      line.visible = len > 0.01;

      if (tr >= 1) {
        if (!landed) pop = 0;
        landed = true;
        pop = Math.min(SPLAT_POP, pop + dt);
        const k = pop / SPLAT_POP;
        const s = 0.7 * (1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2);
        n.copy(endN);
        if (n.lengthSq() < 1e-6) n.subVectors(hand, end);
        if (n.lengthSq() < 1e-6) n.subVectors(eye, end);
        n.normalize();
        splat.quaternion.setFromUnitVectors(Z, n);
        splat.position.copy(end).addScaledVector(n, 0.03);
        splat.scale.setScalar(s);
        splatMat.uniforms.uPop.value = k;
        splat.visible = true;
      } else {
        landed = false;
        splat.visible = false;
      }
    },
    preview(point, kind) {
      if (!point || (kind !== "aim" && kind !== "auto")) {
        ring.visible = false;
        return;
      }
      ringMat.uniforms.uCenter.value.copy(point);
      ringMat.uniforms.uBright.value = kind === "aim" ? 1 : 0;
      ring.visible = true;
    },
    dispose() {
      scene.remove(line, splat, ring);
      for (const m of [line, splat, ring]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    },
  };
}
