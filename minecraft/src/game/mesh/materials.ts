import * as THREE from "three";
import type { ChunkUniforms, MeshBuffers } from "../contracts";
import { ANIM_LAYERS, buildBlockTextureArray } from "../textures/index";
import { buildMipmaps } from "../textures/mipmaps";

const ANIM_N = ANIM_LAYERS.length;
const ANIM = { value: ANIM_LAYERS.map((a) => new THREE.Vector4(a[0], a[1], a[2], a[3])) };

const VERT = /* glsl */ `
attribute vec4 aUv;
attribute vec2 aLight;
attribute vec4 aColor;
attribute vec2 aLayer;
uniform float uTime;
uniform vec4 uAnim[${ANIM_N}];
#ifdef USE_BATCHING
#if !defined(GL_ANGLE_multi_draw)
#define gl_DrawID _gl_DrawID
uniform int _gl_DrawID;
#endif
uniform highp sampler2D batchingTexture;
uniform highp usampler2D batchingIdTexture;
#endif
varying vec2 vUv;
flat varying float vLayer;
flat varying float vOverlay;
varying vec3 vTint;
varying float vShade;
varying vec2 vLight;
varying float vFogDepth;
varying vec3 vDir;
void main() {
  vec3 lp = position;
  vec3 off = vec3(0.0);
#ifdef USE_BATCHING
  int idSize = textureSize(batchingIdTexture, 0).x;
  int slot = int(texelFetch(batchingIdTexture, ivec2(gl_DrawID % idSize, gl_DrawID / idSize), 0).r);
  int offSize = textureSize(batchingTexture, 0).x;
  lp = position * (1.0 / 1024.0);
  off = texelFetch(batchingTexture, ivec2(slot % offSize, slot / offSize), 0).xyz;
#endif
  vec2 uv = aUv.xy / 16.0;
  int f = int(aUv.z + 0.5);
  float speed = (f & 4) != 0 ? 0.08 : 0.5;
  if ((f & 1) != 0) uv.y -= uTime * speed;
  if ((f & 2) != 0) uv += vec2(sin(uTime * speed * 2.0 + lp.z * 0.7), cos(uTime * speed * 1.7 + lp.x * 0.7)) * 0.03;
  vUv = uv;
  float layer = aLayer.x;
  for (int i = 0; i < ${ANIM_N}; i++) {
    vec4 a = uAnim[i];
    if (abs(layer - a.x) < 0.5) {
      float fr = mod(floor(uTime * 20.0 / a.w), a.z);
      if (fr > 0.5) layer = a.y + fr - 1.0;
      break;
    }
  }
  vLayer = layer;
  vOverlay = aLayer.y;
  vTint = aColor.rgb;
  vShade = aColor.a;
  vLight = aLight;
  vec4 wp = modelMatrix * vec4(lp + off, 1.0);
  vec3 d = wp.xyz - cameraPosition;
  vFogDepth = max(length(d.xz), abs(d.y));
  vDir = d;
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
uniform float uNightVision;
uniform vec3 uFogColor;
uniform vec3 uSkyTint;
varying vec2 vUv;
flat varying float vLayer;
flat varying float vOverlay;
varying vec3 vTint;
varying float vShade;
varying vec2 vLight;
varying float vFogDepth;
varying vec3 vDir;
uniform vec3 uSkyColor;
uniform float uSkyFogEnd;
uniform float uSkyMix;

float brightness(float l) { return l / (4.0 - 3.0 * l); }
vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec4 tex = texture(uAtlas, vec3(vUv, vLayer));
  vec3 col;
  if (vOverlay < 65534.5) {
    vec4 ov = texture(uAtlas, vec3(vUv, vOverlay));
    col = mix(toSrgb(tex.rgb), toSrgb(ov.rgb) * vTint, ov.a);
  } else {
    col = toSrgb(tex.rgb) * vTint;
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
  light = mix(light, light / max(max(light.r, light.g), max(light.b, 0.001)), uNightVision);
  vec3 inv = 1.0 - clamp(light, 0.0, 1.0);
  light = mix(light, 1.0 - inv * inv * inv * inv, uGamma);
  col *= clamp(light, 0.0, 1.0) * vShade;
  col = toLinear(col);
  float fog = clamp((vFogDepth - uFogNear) / max(uFogFar - uFogNear, 0.001), 0.0, 1.0);
  vec3 fogCol = uFogColor;
  if (uSkyMix > 0.0 && vDir.y > 0.0 && fog > 0.0) {
    vec3 dd = normalize(vDir);
    float k = smoothstep(0.0, uSkyFogEnd, 16.0 * length(dd.xz) / max(dd.y, 1e-4));
    fogCol = mix(uFogColor, toLinear(mix(toSrgb(uSkyColor), toSrgb(uFogColor), k)), uSkyMix);
  }
  col = mix(col, fogCol, fog);
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
    uNightVision: { value: 0 },
    uSkyColor: { value: new THREE.Color(0x78a7ff) },
    uSkyFogEnd: { value: 192 },
    uSkyMix: { value: 0 },
  };
}

function make(uniforms: ChunkUniforms, kind: "OPAQUE" | "CUTOUT" | "TRANSLUCENT"): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: { ...(uniforms as unknown as Record<string, THREE.IUniform>), uAnim: ANIM },
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

// three uploads only level 0 of a DataArrayTexture, so onUpdate uploads the smaller levels.
export function createAtlasTexture(gl: WebGL2RenderingContext): THREE.DataArrayTexture {
  const { data, size, layers } = buildBlockTextureArray();
  const tex = new THREE.DataArrayTexture(data, size, size, layers);
  const mips = buildMipmaps(data, size, layers, 5);
  tex.mipmaps = mips as unknown as THREE.DataArrayTexture["mipmaps"];
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.onUpdate = () => {
    for (let i = 1; i < mips.length; i++) {
      const m = mips[i];
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, i, 0, 0, 0, m.width, m.height, layers, gl.RGBA, gl.UNSIGNED_BYTE, m.data);
    }
  };
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
