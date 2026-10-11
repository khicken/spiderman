import * as THREE from "three";
import type { Aabb, RaycastHit } from "../contracts";
import { crackLayer } from "../textures";

const MAX_BOXES = 32;
const INFLATE = 0.002;
const FULL: Aabb[] = [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }];

const CRACK_VERT = /* glsl */ `
varying vec3 vLocal;
varying vec3 vNormal2;
void main() {
  vLocal = position;
  vNormal2 = normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const CRACK_FRAG = /* glsl */ `
uniform sampler2DArray uAtlas;
uniform float uLayer;
varying vec3 vLocal;
varying vec3 vNormal2;
void main() {
  vec3 n = abs(vNormal2);
  vec2 uv = n.x > 0.5 ? vec2(vLocal.z, 1.0 - vLocal.y) : n.y > 0.5 ? vec2(vLocal.x, vLocal.z) : vec2(vLocal.x, 1.0 - vLocal.y);
  vec4 t = texture(uAtlas, vec3(fract(uv), uLayer));
  if (t.a < 0.1) discard;
  gl_FragColor = vec4(t.rgb, 1.0);
  #include <colorspace_fragment>
}`;

const TINT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uEdge;
varying vec2 vUv;
void main() {
  vec2 d = vUv - 0.5;
  float e = smoothstep(0.25, 0.75, length(d) * 1.2);
  gl_FragColor = sRGBTransferEOTF(vec4(uColor, clamp(uAlpha + e * uEdge, 0.0, 1.0)));
  #include <colorspace_fragment>
}`;

const TINT_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const EDGES = [
  [0, 0, 0, 1, 0, 0], [0, 0, 1, 1, 0, 1], [0, 1, 0, 1, 1, 0], [0, 1, 1, 1, 1, 1],
  [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0], [0, 0, 1, 0, 1, 1], [1, 0, 1, 1, 1, 1],
  [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [0, 1, 0, 0, 1, 1], [1, 1, 0, 1, 1, 1],
];

const lo = [0, 0, 0], hi = [0, 0, 0];
const FACES: [number[], number[]][] = [
  [[1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1], [1, 0, 0]],
  [[0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0], [-1, 0, 0]],
  [[0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0], [0, 1, 0]],
  [[0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1], [0, -1, 0]],
  [[0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1], [0, 0, 1]],
  [[1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0], [0, 0, -1]],
];

export function createOverlays(scene: THREE.Scene, atlas: () => THREE.DataArrayTexture | null) {
  const linePos = new Float32Array(MAX_BOXES * 24 * 3);
  const lineGeo = new THREE.BufferGeometry();
  const lineAttr = new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage);
  lineGeo.setAttribute("position", lineAttr);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false, fog: false });
  const outline = new THREE.LineSegments(lineGeo, lineMat);
  outline.frustumCulled = false;
  outline.visible = false;
  outline.renderOrder = 50;
  scene.add(outline);

  const crackPos = new Float32Array(MAX_BOXES * 24 * 3);
  const crackNrm = new Float32Array(MAX_BOXES * 24 * 3);
  const crackIdx = new Uint16Array(MAX_BOXES * 36);
  for (let q = 0; q < MAX_BOXES * 6; q++) crackIdx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
  const crackGeo = new THREE.BufferGeometry();
  const crackPosAttr = new THREE.BufferAttribute(crackPos, 3).setUsage(THREE.DynamicDrawUsage);
  const crackNrmAttr = new THREE.BufferAttribute(crackNrm, 3).setUsage(THREE.DynamicDrawUsage);
  crackGeo.setAttribute("position", crackPosAttr);
  crackGeo.setAttribute("normal", crackNrmAttr);
  crackGeo.setIndex(new THREE.BufferAttribute(crackIdx, 1));
  const crackMat = new THREE.ShaderMaterial({
    uniforms: { uAtlas: { value: null }, uLayer: { value: 0 } },
    vertexShader: CRACK_VERT,
    fragmentShader: CRACK_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -10,
    blending: THREE.CustomBlending,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.SrcColorFactor,
    blendEquation: THREE.AddEquation,
  });
  const crack = new THREE.Mesh(crackGeo, crackMat);
  crack.frustumCulled = false;
  crack.visible = false;
  crack.renderOrder = 49;
  scene.add(crack);

  const tintScene = new THREE.Scene();
  const tintCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const tintGeo = new THREE.PlaneGeometry(2, 2);
  const tintMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Vector3() }, uAlpha: { value: 0 }, uEdge: { value: 0 } },
    vertexShader: TINT_VERT,
    fragmentShader: TINT_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const tint = new THREE.Mesh(tintGeo, tintMat);
  tint.frustumCulled = false;
  tintScene.add(tint);

  let outlineBoxes: Aabb[] = FULL;
  let outlineX = NaN, outlineY = NaN, outlineZ = NaN;

  function setOutline(hit: RaycastHit | null, boxes: Aabb[] | null) {
    if (!hit) { outline.visible = false; return; }
    const list = boxes && boxes.length ? boxes : FULL;
    outlineBoxes = list;
    outlineX = hit.x; outlineY = hit.y; outlineZ = hit.z;
    const n = Math.min(MAX_BOXES, list.length);
    let k = 0;
    for (let b = 0; b < n; b++) {
      const a = list[b];
      const x0 = a.minX - INFLATE, y0 = a.minY - INFLATE, z0 = a.minZ - INFLATE;
      const sx = a.maxX - a.minX + INFLATE * 2, sy = a.maxY - a.minY + INFLATE * 2, sz = a.maxZ - a.minZ + INFLATE * 2;
      for (const e of EDGES) {
        linePos[k++] = x0 + e[0] * sx; linePos[k++] = y0 + e[1] * sy; linePos[k++] = z0 + e[2] * sz;
        linePos[k++] = x0 + e[3] * sx; linePos[k++] = y0 + e[4] * sy; linePos[k++] = z0 + e[5] * sz;
      }
    }
    lineGeo.setDrawRange(0, n * 24);
    lineAttr.clearUpdateRanges();
    lineAttr.addUpdateRange(0, k);
    lineAttr.needsUpdate = true;
    outline.position.set(hit.x, hit.y, hit.z);
    outline.visible = true;
  }

  function setBreak(hit: RaycastHit | null, progress: number) {
    if (!hit || progress <= 0) { crack.visible = false; return; }
    const stage = Math.min(9, Math.max(0, Math.floor(progress * 10)));
    crackMat.uniforms.uAtlas.value = atlas();
    crackMat.uniforms.uLayer.value = crackLayer(stage);
    const same = hit.x === outlineX && hit.y === outlineY && hit.z === outlineZ;
    const list = same ? outlineBoxes : FULL;
    const n = Math.min(MAX_BOXES, list.length);
    let k = 0;
    for (let b = 0; b < n; b++) {
      const a = list[b];
      lo[0] = a.minX; lo[1] = a.minY; lo[2] = a.minZ;
      hi[0] = a.maxX; hi[1] = a.maxY; hi[2] = a.maxZ;
      for (const [c, nrm] of FACES) {
        for (let v = 0; v < 4; v++) {
          for (let ax = 0; ax < 3; ax++) {
            crackPos[k + ax] = c[v * 3 + ax] ? hi[ax] : lo[ax];
            crackNrm[k + ax] = nrm[ax];
          }
          k += 3;
        }
      }
    }
    crackGeo.setDrawRange(0, n * 36);
    crackPosAttr.clearUpdateRanges(); crackPosAttr.addUpdateRange(0, k); crackPosAttr.needsUpdate = true;
    crackNrmAttr.clearUpdateRanges(); crackNrmAttr.addUpdateRange(0, k); crackNrmAttr.needsUpdate = true;
    crack.position.set(hit.x, hit.y, hit.z);
    crack.visible = true;
  }

  function setTint(r: number, g: number, b: number, alpha: number, edge: number) {
    tintMat.uniforms.uColor.value.set(r, g, b);
    tintMat.uniforms.uAlpha.value = alpha;
    tintMat.uniforms.uEdge.value = edge;
  }

  function renderTint(renderer: THREE.WebGLRenderer) {
    if (tintMat.uniforms.uAlpha.value <= 0 && tintMat.uniforms.uEdge.value <= 0) return;
    renderer.render(tintScene, tintCam);
  }

  return {
    setOutline,
    setBreak,
    setTint,
    renderTint,
    dispose() {
      scene.remove(outline, crack);
      lineGeo.dispose(); lineMat.dispose();
      crackGeo.dispose(); crackMat.dispose();
      tintGeo.dispose(); tintMat.dispose();
    },
  };
}
