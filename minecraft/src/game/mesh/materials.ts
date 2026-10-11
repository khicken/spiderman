import * as THREE from "three";
import type { ChunkUniforms, MeshBuffers } from "../contracts";
import { buildBlockTextureArray } from "../textures/index";

const VERT = /* glsl */ `
attribute vec4 aUv;
attribute vec2 aLight;
attribute vec4 aColor;
attribute vec2 aLayer;
uniform float uTime;
varying vec2 vUv;
flat varying float vLayer;
flat varying float vOverlay;
varying vec3 vTint;
varying float vShade;
varying vec2 vLight;
varying float vFogDepth;
void main() {
  vec2 uv = aUv.xy / 16.0;
  int f = int(aUv.z + 0.5);
  float speed = (f & 4) != 0 ? 0.08 : 0.5;
  if ((f & 1) != 0) uv.y -= uTime * speed;
  if ((f & 2) != 0) uv += vec2(sin(uTime * speed * 2.0 + position.z * 0.7), cos(uTime * speed * 1.7 + position.x * 0.7)) * 0.03;
  vUv = uv;
  vLayer = aLayer.x;
  vOverlay = aLayer.y;
  vTint = aColor.rgb;
  vShade = aColor.a;
  vLight = aLight;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 d = wp.xyz - cameraPosition;
  vFogDepth = max(length(d.xz), abs(d.y));
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform float uDaylight;
uniform float uFogNear;
uniform float uFogFar;
uniform float uGamma;
uniform vec3 uFogColor;
uniform vec3 uSkyTint;
varying vec2 vUv;
flat varying float vLayer;
flat varying float vOverlay;
varying vec3 vTint;
varying float vShade;
varying vec2 vLight;
varying float vFogDepth;

float brightness(float l) { return l / (4.0 - 3.0 * l); }
vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

void main() {
  vec4 tex = texture(uAtlas, vec3(vUv, vLayer));
  vec3 col;
  if (vOverlay < 65534.5) {
    vec4 ov = texture(uAtlas, vec3(vUv, vOverlay));
    col = mix(tex.rgb, ov.rgb * vTint, ov.a);
  } else {
    col = tex.rgb * vTint;
  }
  float alpha = tex.a;
#ifdef CUTOUT
  if (alpha < 0.5) discard;
  alpha = 1.0;
#endif
#ifdef OPAQUE
  alpha = 1.0;
#endif
  float skyFactor = mix(0.2, 1.0, clamp(uDaylight, 0.0, 1.0));
  float sky = brightness(vLight.x) * skyFactor;
  float b = brightness(vLight.y);
  vec3 blockCol = vec3(b, b * ((b * 0.6 + 0.4) * 0.6 + 0.4), b * (b * b * 0.6 + 0.4));
  vec3 skyTint = pow(max(uSkyTint, vec3(0.0)), vec3(1.0 / 2.2));
  vec3 light = max(vec3(sky) * skyTint, blockCol);
  light = mix(light, vec3(0.75), 0.04);
  vec3 inv = 1.0 - clamp(light, 0.0, 1.0);
  light = mix(light, 1.0 - inv * inv * inv * inv, uGamma);
  col *= clamp(light, 0.0, 1.0) * vShade;
  col = toLinear(col);
  float fog = clamp((vFogDepth - uFogNear) / max(uFogFar - uFogNear, 0.001), 0.0, 1.0);
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createChunkUniforms(): ChunkUniforms {
  return {
    uDaylight: { value: 1 },
    uFogColor: { value: new THREE.Color(0xc0d8ff) },
    uFogNear: { value: 64 },
    uFogFar: { value: 128 },
    uTime: { value: 0 },
    uAtlas: { value: null },
    uSkyTint: { value: new THREE.Color(1, 1, 1) },
    uGamma: { value: 0.5 },
  };
}

function make(uniforms: ChunkUniforms, kind: "OPAQUE" | "CUTOUT" | "TRANSLUCENT"): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines: { [kind]: "" },
    side: THREE.FrontSide,
  });
  if (kind === "TRANSLUCENT") {
    m.transparent = true;
    m.depthWrite = false;
    m.blending = THREE.NormalBlending;
  }
  return m;
}

// uDaylight 0 is the darkest night (vanilla sky darken floor 0.2), uGamma is the brightness option.
export function createChunkMaterials(): {
  opaque: THREE.ShaderMaterial;
  cutout: THREE.ShaderMaterial;
  translucent: THREE.ShaderMaterial;
  uniforms: ChunkUniforms;
} {
  const uniforms = createChunkUniforms();
  return { opaque: make(uniforms, "OPAQUE"), cutout: make(uniforms, "CUTOUT"), translucent: make(uniforms, "TRANSLUCENT"), uniforms };
}

export function createAtlasTexture(): THREE.DataArrayTexture {
  const { data, size, layers } = buildBlockTextureArray();
  const tex = new THREE.DataArrayTexture(data, size, size, layers);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function buffersToGeometry(b: MeshBuffers): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(b.attributes)) g.setAttribute(name, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized ?? false));
  g.setIndex(new THREE.BufferAttribute(b.index, 1));
  g.computeBoundingSphere();
  return g;
}
