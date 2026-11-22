import * as THREE from "three";

// Rain streaks: instanced thin quads that wrap inside a box around the camera on the GPU. No per-frame CPU work
// besides the instance count.

const BOX = new THREE.Vector3(34, 22, 34);

const VERT = /* glsl */ `
attribute vec4 iOff;
uniform vec3 uCam; uniform float uTime; uniform vec2 uWind; uniform vec3 uBox; uniform float uFall;
varying float vA;
varying float vV;
void main() {
  vec3 vel = vec3(uWind.x * 0.7, -uFall * (0.85 + 0.3 * iOff.w), uWind.y * 0.7);
  vec3 p = iOff.xyz * uBox + vel * uTime;
  p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
  vec3 dir = normalize(vel);
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = normalize(cross(dir, toCam));
  float len = 0.75;
  vec3 wp = p + dir * position.y * len + side * position.x * 0.012;
  vec3 rel = (p - uCam) / (uBox * 0.5);
  float edge = 1.0 - smoothstep(0.7, 1.0, max(abs(rel.x), max(abs(rel.y), abs(rel.z))));
  float d = length(p - cameraPosition);
  vA = edge * smoothstep(0.8, 2.5, d);
  vV = position.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha;
varying float vA;
varying float vV;
void main() {
  float a = vA * uAlpha * smoothstep(0.0, 0.6, vV) * smoothstep(1.0, 0.85, vV);
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a, a);
}`;

export interface Rain {
  readonly mesh: THREE.Mesh;
  setMax(n: number): void;
  update(cam: THREE.Vector3, time: number, wind: THREE.Vector2, rain: number, color: THREE.Color): void;
  dispose(): void;
}

export function createRain(maxDrops: number): Rain {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  let max = 0;
  const alloc = (m: number) => {
    if (max > 0) geo.dispose();
    max = m;
    const a = new Float32Array(m * 4);
    for (let i = 0; i < a.length; i++) a[i] = Math.random();
    geo.setAttribute("iOff", new THREE.InstancedBufferAttribute(a, 4));
    geo.instanceCount = 0;
  };
  alloc(maxDrops);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uWind: { value: new THREE.Vector2() },
      uBox: { value: BOX }, uFall: { value: 17 }, uColor: { value: new THREE.Color() }, uAlpha: { value: 0.3 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  mesh.visible = false;
  return {
    mesh,
    setMax(n) {
      if (n !== max) alloc(n);
    },
    update(cam, time, wind, rain, color) {
      const count = Math.floor(max * Math.min(1, rain));
      geo.instanceCount = count;
      mesh.visible = count > 8;
      const U = mat.uniforms;
      U.uCam.value.copy(cam);
      U.uTime.value = time % 1000;
      U.uWind.value.copy(wind);
      U.uColor.value.copy(color);
      U.uAlpha.value = 0.18 + 0.22 * rain;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
