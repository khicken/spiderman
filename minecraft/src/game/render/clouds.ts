import * as THREE from "three";
import type { Rgb } from "./celestial";
import type { CloudMode } from "./quality";
import { paintCloudMap } from "./sky-art";

const CELL = 12;
const MAP = 256;
const HEIGHT = 192;
const THICK = 4;
const SPEED = 0.6; // 0.03 blocks per tick

const VERT = /* glsl */ `
attribute float shade;
varying float vShade;
varying vec3 vWorld;
void main() {
  vShade = shade;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uFog;
uniform vec3 uCam;
uniform float uFadeEnd;
uniform float uDrift;
uniform sampler2D uMap;
varying float vShade;
varying vec3 vWorld;
void main() {
  #ifdef FLAT
  vec2 uv = vec2(vWorld.x + uDrift, vWorld.z) / ${(CELL * MAP).toFixed(1)};
  if (texture2D(uMap, uv).r < 0.5) discard;
  #endif
  float d = length(vWorld.xz - uCam.xz);
  float f = smoothstep(uFadeEnd * 0.4, uFadeEnd, d);
  vec3 c = mix(uColor * vShade, uFog, f);
  gl_FragColor = sRGBTransferEOTF(vec4(c, 0.8 * (1.0 - smoothstep(0.85, 1.0, d / uFadeEnd))));
  #include <colorspace_fragment>
}`;

const _shade: number[] = [];
const _pos: number[] = [];
const _idx: number[] = [];

export function createClouds(scene: THREE.Scene) {
  const map = paintCloudMap();
  const texData = new Uint8Array(MAP * MAP * 4);
  for (let i = 0; i < MAP * MAP; i++) texData.fill(map[i] ? 255 : 0, i * 4, i * 4 + 4);
  const tex = new THREE.DataTexture(texData, MAP, MAP, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  const uniforms = {
    uColor: { value: new THREE.Vector3(1, 1, 1) },
    uFog: { value: new THREE.Vector3(1, 1, 1) },
    uCam: { value: new THREE.Vector3() },
    uFadeEnd: { value: 384 },
    uDrift: { value: 0 },
    uMap: { value: tex },
  };

  const fancyDepth = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, colorWrite: false, transparent: true, side: THREE.DoubleSide });
  const fancyColor = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthFunc: THREE.LessEqualDepth, side: THREE.DoubleSide,
  });
  const flatMat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, defines: { FLAT: "" },
  });

  const fancyGeo = new THREE.BufferGeometry();
  const fancyA = new THREE.Mesh(fancyGeo, fancyDepth);
  const fancyB = new THREE.Mesh(fancyGeo, fancyColor);
  fancyA.renderOrder = 5;
  fancyB.renderOrder = 6;
  fancyA.frustumCulled = fancyB.frustumCulled = false;

  const flatGeo = new THREE.PlaneGeometry(1, 1);
  flatGeo.rotateX(-Math.PI / 2);
  flatGeo.setAttribute("shade", new THREE.Float32BufferAttribute([1, 1, 1, 1], 1));
  const flat = new THREE.Mesh(flatGeo, flatMat);
  flat.renderOrder = 6;
  flat.frustumCulled = false;

  const group = new THREE.Group();
  group.add(fancyA, fancyB, flat);
  scene.add(group);

  let mode: CloudMode = "fancy";
  let range = 384;
  let lastCi = NaN, lastCj = NaN, lastR = 0;
  let drift = 0;

  const cloudAt = (i: number, j: number) => map[(((j % MAP) + MAP) % MAP) * MAP + (((i % MAP) + MAP) % MAP)] === 1;

  function quad(ax: number, ay: number, az: number, ux: number, uy: number, uz: number, vx: number, vy: number, vz: number, s: number) {
    const b = _pos.length / 3;
    _pos.push(ax, ay, az, ax + ux, ay + uy, az + uz, ax + ux + vx, ay + uy + vy, az + uz + vz, ax + vx, ay + vy, az + vz);
    _shade.push(s, s, s, s);
    _idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }

  function rebuild(ci: number, cj: number, r: number) {
    _pos.length = 0; _shade.length = 0; _idx.length = 0;
    for (let b = -r; b <= r; b++)
      for (let a = -r; a <= r; a++) {
        const i = ci + a, j = cj + b;
        if (!cloudAt(i, j)) continue;
        const x = a * CELL, z = b * CELL;
        quad(x, THICK, z, 0, 0, CELL, CELL, 0, 0, 1);
        quad(x, 0, z, CELL, 0, 0, 0, 0, CELL, 0.7);
        if (!cloudAt(i - 1, j)) quad(x, 0, z, 0, 0, CELL, 0, THICK, 0, 0.9);
        if (!cloudAt(i + 1, j)) quad(x + CELL, 0, z, 0, THICK, 0, 0, 0, CELL, 0.9);
        if (!cloudAt(i, j - 1)) quad(x, 0, z, 0, THICK, 0, CELL, 0, 0, 0.8);
        if (!cloudAt(i, j + 1)) quad(x, 0, z + CELL, CELL, 0, 0, 0, THICK, 0, 0.8);
      }
    fancyGeo.setAttribute("position", new THREE.Float32BufferAttribute(_pos, 3));
    fancyGeo.setAttribute("shade", new THREE.Float32BufferAttribute(_shade, 1));
    fancyGeo.setIndex(_pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(_idx, 1) : new THREE.Uint16BufferAttribute(_idx, 1));
  }

  function update(dt: number, cam: THREE.Vector3, color: Rgb, fog: Rgb) {
    drift = (drift + dt * SPEED) % (CELL * MAP);
    uniforms.uDrift.value = drift;
    uniforms.uCam.value.copy(cam);
    uniforms.uColor.value.set(color[0], color[1], color[2]);
    uniforms.uFog.value.set(fog[0], fog[1], fog[2]);
    uniforms.uFadeEnd.value = range;
    group.visible = mode !== "off";
    fancyA.visible = fancyB.visible = mode === "fancy";
    flat.visible = mode === "flat";
    if (mode === "fancy") {
      const ci = Math.floor((cam.x + drift) / CELL), cj = Math.floor(cam.z / CELL);
      const r = Math.min(32, Math.ceil(range / CELL) + 1);
      if (ci !== lastCi || cj !== lastCj || r !== lastR) {
        lastCi = ci; lastCj = cj; lastR = r;
        rebuild(ci, cj, r);
      }
      fancyA.position.set(ci * CELL - drift, HEIGHT, cj * CELL);
      fancyB.position.copy(fancyA.position);
    } else if (mode === "flat") {
      flat.position.set(cam.x, HEIGHT + 0.33, cam.z);
      flat.scale.set(range * 2, 1, range * 2);
    }
  }

  return {
    update,
    setMode(m: CloudMode) { mode = m; group.visible = m !== "off"; },
    setRange(blocks: number) { range = Math.max(192, blocks * 2); },
    dispose() {
      scene.remove(group);
      fancyGeo.dispose(); flatGeo.dispose();
      fancyDepth.dispose(); fancyColor.dispose(); flatMat.dispose();
      tex.dispose();
    },
  };
}

export type Clouds = ReturnType<typeof createClouds>;
