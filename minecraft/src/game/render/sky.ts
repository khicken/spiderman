import * as THREE from "three";
import type { Dim } from "../contracts";
import type { Rgb, Rgba } from "./celestial";
import { buildStars, paintEndSky, paintMoonPhases, paintSun } from "./sky-art";
import { artOr } from "./pack-art";

export interface SkyState {
  sky: Rgb;
  fog: Rgb;
  sunrise: Rgba;
  sunSide: number;
  fogEnd: number;
  below: boolean; // camera under the horizon height, so the void disk shows
  angle: number;
  stars: number;
  rain: number;
  moonPhase: number;
}

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w;
}`;

const DOME_FRAG = /* glsl */ `
uniform vec3 uSky;
uniform vec3 uFog;
uniform vec4 uSunrise;
uniform float uSunSide;
uniform float uFogEnd;
uniform float uBelow;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = length(d.xz);
  vec3 c;
  if (d.y > 0.0) {
    c = mix(uSky, uFog, smoothstep(0.0, uFogEnd, 16.0 * h / max(d.y, 1e-4)));
  } else if (uBelow > 0.5) {
    c = mix(vec3(0.0), uFog, smoothstep(0.0, uFogEnd, 16.0 * h / max(-d.y, 1e-4)));
  } else {
    c = uFog;
  }
  // Vanilla sunrise fan: apex 100 out on the horizon toward the sun, rim a radius 120 ring tilted 40*a up on that side, alpha a to 0.
  float a = uSunrise.a;
  if (a > 0.001) {
    float k = inversesqrt(max(d.y * d.y / (1600.0 * a * a) + d.z * d.z / 14400.0, 1e-12));
    float den = 100.0 + k * (d.x * uSunSide - 3.0 * d.y / a);
    if (den >= 100.0) c = mix(c, uSunrise.rgb, a * (1.0 - 100.0 / den));
  }
  gl_FragColor = sRGBTransferEOTF(vec4(c, 1.0));
  #include <colorspace_fragment>
}`;

const SPRITE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SPRITE_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec4 uRect;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uRepeat;
varying vec2 vUv;
void main() {
  vec2 uv = uRect.xy + fract(vUv * uRepeat) * uRect.zw;
  vec3 c = texture2D(uMap, uv).rgb * uColor * uAlpha;
  gl_FragColor = sRGBTransferEOTF(vec4(c, 1.0));
  #include <colorspace_fragment>
}`;

const STAR_FRAG = /* glsl */ `
uniform float uBright;
void main() {
  gl_FragColor = sRGBTransferEOTF(vec4(vec3(uBright), 1.0));
  #include <colorspace_fragment>
}`;

const STAR_VERT = /* glsl */ `
void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

function dataTex(data: Uint8Array, w: number, h: number, repeat = false) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

function spriteMaterial(map: THREE.Texture, additive: boolean, repeat = 1) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uColor: { value: new THREE.Vector3(1, 1, 1) },
      uAlpha: { value: 1 },
      uRepeat: { value: repeat },
    },
    vertexShader: SPRITE_VERT,
    fragmentShader: SPRITE_FRAG,
    depthWrite: false,
    depthTest: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    transparent: additive,
    side: THREE.DoubleSide,
  });
}

const _q = new THREE.Quaternion();

export function createSky() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 400);

  const domeMat = new THREE.ShaderMaterial({
    uniforms: {
      uSky: { value: new THREE.Vector3() },
      uFog: { value: new THREE.Vector3() },
      uSunrise: { value: new THREE.Vector4() },
      uSunSide: { value: 1 },
      uFogEnd: { value: 192 },
      uBelow: { value: 0 },
    },
    vertexShader: DOME_VERT,
    fragmentShader: DOME_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const domeGeo = new THREE.SphereGeometry(200, 32, 24);
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.renderOrder = 0;
  scene.add(dome);

  const celestial = new THREE.Group();
  celestial.rotation.order = "YXZ";
  celestial.rotation.y = -Math.PI / 2;
  scene.add(celestial);

  const stars = buildStars();
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(stars.positions, 3));
  starGeo.setIndex(new THREE.BufferAttribute(stars.index, 1));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uBright: { value: 0 } },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const starMesh = new THREE.Mesh(starGeo, starMat);
  starMesh.renderOrder = 1;
  celestial.add(starMesh);

  const sunOf = () => artOr("environment/sun", () => { const a = paintSun(); return { data: a.data, w: a.size, h: a.size }; });
  const moonOf = () => artOr("environment/moon_phases", () => { const a = paintMoonPhases(); return { data: a.data, w: a.width, h: a.height }; });
  const endOf = () => artOr("environment/end_sky", () => { const a = paintEndSky(); return { data: a.data, w: a.size, h: a.size }; });
  const sunArt = sunOf();
  let sunTex = dataTex(sunArt.data, sunArt.w, sunArt.h);
  const sunMat = spriteMaterial(sunTex, true);
  const quad = new THREE.PlaneGeometry(1, 1);
  const sun = new THREE.Mesh(quad, sunMat);
  sun.scale.setScalar(60);
  sun.position.set(0, 100, 0);
  sun.rotation.x = Math.PI / 2;
  sun.renderOrder = 2;
  celestial.add(sun);

  const moonArt = moonOf();
  let moonTex = dataTex(moonArt.data, moonArt.w, moonArt.h);
  const moonMat = spriteMaterial(moonTex, true);
  const moon = new THREE.Mesh(quad, moonMat);
  moon.scale.setScalar(40);
  moon.position.set(0, -100, 0);
  moon.rotation.x = -Math.PI / 2;
  moon.renderOrder = 2;
  celestial.add(moon);

  const endArt = endOf();
  let endTex = dataTex(endArt.data, endArt.w, endArt.h, true);
  const endMat = spriteMaterial(endTex, false, 16);
  endMat.side = THREE.BackSide;
  (endMat.uniforms.uColor.value as THREE.Vector3).setScalar(1);
  const endGeo = new THREE.BoxGeometry(200, 200, 200);
  const endBox = new THREE.Mesh(endGeo, endMat);
  endBox.visible = false;
  scene.add(endBox);

  function setDim(dim: Dim) {
    dome.visible = dim !== "end";
    endBox.visible = dim === "end";
    celestial.visible = dim === "overworld";
  }

  function update(main: THREE.PerspectiveCamera, s: SkyState) {
    main.getWorldQuaternion(_q);
    camera.quaternion.copy(_q);
    camera.fov = main.fov;
    camera.aspect = main.aspect;
    camera.updateProjectionMatrix();

    const u = domeMat.uniforms;
    (u.uSky.value as THREE.Vector3).set(s.sky[0], s.sky[1], s.sky[2]);
    (u.uFog.value as THREE.Vector3).set(s.fog[0], s.fog[1], s.fog[2]);
    (u.uSunrise.value as THREE.Vector4).set(s.sunrise[0], s.sunrise[1], s.sunrise[2], s.sunrise[3]);
    u.uSunSide.value = s.sunSide;
    u.uFogEnd.value = Math.max(16, s.fogEnd);
    u.uBelow.value = s.below ? 1 : 0;

    celestial.rotation.x = s.angle * Math.PI * 2;
    const alpha = 1 - s.rain;
    sunMat.uniforms.uAlpha.value = alpha;
    moonMat.uniforms.uAlpha.value = alpha;
    starMat.uniforms.uBright.value = s.stars;
    starMesh.visible = s.stars > 0;
    const p = s.moonPhase;
    (moonMat.uniforms.uRect.value as THREE.Vector4).set((p % 4) / 4, Math.floor(p / 4) / 2, 0.25, 0.5);
  }

  function dispose() {
    domeGeo.dispose(); domeMat.dispose();
    starGeo.dispose(); starMat.dispose();
    quad.dispose(); sunMat.dispose(); sunTex.dispose();
    moonMat.dispose(); moonTex.dispose();
    endGeo.dispose(); endMat.dispose(); endTex.dispose();
  }

  function reloadArt() {
    const s = sunOf(), m = moonOf(), e = endOf();
    sunTex.dispose(); moonTex.dispose(); endTex.dispose();
    sunTex = dataTex(s.data, s.w, s.h);
    moonTex = dataTex(m.data, m.w, m.h);
    endTex = dataTex(e.data, e.w, e.h, true);
    sunMat.uniforms.uMap.value = sunTex;
    moonMat.uniforms.uMap.value = moonTex;
    endMat.uniforms.uMap.value = endTex;
  }

  return { scene, camera, setDim, update, reloadArt, dispose };
}

export type Sky = ReturnType<typeof createSky>;
