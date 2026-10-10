import * as THREE from "three";
import type { Quality } from "./contracts";
import { carbonTex, flakeTex, grilleTex, treadTex, type GrilleKind, type TreadKind } from "./car-tex";

export const LAMP = { none: 0, head: 1, drl: 2, tail: 3, brake: 4, reverse: 5, amber: 6, aux: 7, core: 8, bowl: 9 } as const;
// ACES leaks red into green as it saturates: red lamps stay deep red only near 1 after exposure, so the core carries the brightness.
const LAMP_COL = [
  [0, 0, 0], [1, 0.95, 0.86], [0.86, 0.93, 1], [1, 0, 0], [1, 0, 0], [1, 1, 1], [1, 0.38, 0], [1, 0.93, 0.78], [1, 0.16, 0.12], [1, 0.97, 0.9],
].map(([r, g, b]) => new THREE.Vector3(r, g, b));
export const LAMP_N = LAMP_COL.length;

const shared = new Map<string, THREE.Material>();
const one = <M extends THREE.Material>(k: string, make: () => M) => {
  let m = shared.get(k) as M | undefined;
  if (!m) shared.set(k, (m = make()));
  return m;
};

// The sky env has no ground: darken reflections below the horizon, which also gives paint its crisp horizon line.
const HORIZON = `vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
      float hzW = 0.012 + roughness * roughness * 0.5;
      envMapColor.rgb *= mix( 0.07, 1.0, smoothstep( -hzW, hzW * 0.5, reflectVec.y ) );`;

type Shader = THREE.WebGLProgramParametersWithUniforms;
const horizon = (s: Shader) => {
  s.fragmentShader = s.fragmentShader.replace("#include <envmap_physical_pars_fragment>", THREE.ShaderChunk.envmap_physical_pars_fragment.replace("vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );", HORIZON));
};
const withHorizon = <M extends THREE.Material>(m: M, key: string, more?: (s: Shader) => void) => {
  m.onBeforeCompile = (s) => {
    horizon(s);
    more?.(s);
  };
  m.customProgramCacheKey = () => key;
  return m;
};

export type BodyMat = THREE.MeshPhysicalMaterial & { lamp: Float32Array; paint: THREE.Color };

// The whole car body in one draw call: paint, trim, chrome, carbon, grilles, lamps and opaque glass.
// Per vertex: color, pbr (roughness, metalness, clearcoat, kind) and lamp id. Kind 1 takes the paint color, flakes and flop.
// Paint is two layers: sharp clearcoat over a softer flaked metallic base that darkens at grazing angles.
export function bodyMat(hex: string, panel: THREE.Texture, grille: GrilleKind, q: Quality): BodyMat {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, map: panel, roughness: 1, metalness: 1, clearcoat: q === "low" ? 0 : 1, clearcoatRoughness: 0.012 }) as BodyMat;
  panel.channel = 1;
  if (q !== "low") {
    m.normalMap = flakeTex();
    m.normalScale.set(0.3, 0.3);
    m.normalMap.repeat.set(3, 3);
  }
  m.lamp = new Float32Array(LAMP_N);
  m.paint = new THREE.Color(hex);
  const u = { uLampI: { value: m.lamp }, uLampC: { value: LAMP_COL }, uPaint: { value: m.paint }, uGrille: { value: grilleTex(grille) }, uCarbon: { value: carbonTex() } };
  return withHorizon(m, "carbody", (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 pbr;\nattribute float lamp;\nvarying vec4 vPbr;\nvarying float vLamp;\nvarying vec2 vGu;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPbr = pbr;\nvLamp = lamp;\nvGu = uv;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform float uLampI[${LAMP_N}]; uniform vec3 uLampC[${LAMP_N}]; uniform vec3 uPaint; uniform sampler2D uGrille; uniform sampler2D uCarbon;
        varying vec4 vPbr; varying float vLamp; varying vec2 vGu;`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float kPaint = 1.0 - step(0.5, abs(vPbr.w - 1.0));
        float kGr = 1.0 - step(0.5, abs(vPbr.w - 2.0));
        float kCb = 1.0 - step(0.5, abs(vPbr.w - 3.0));
        diffuseColor.rgb *= mix(vec3(1.0), uPaint, kPaint);
        diffuseColor.rgb *= mix(vec3(1.0), sRGBTransferEOTF(texture2D(uGrille, vGu)).rgb, kGr);
        diffuseColor.rgb *= mix(vec3(1.0), sRGBTransferEOTF(texture2D(uCarbon, vGu * 8.0)).rgb, kCb);`,
      )
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = vPbr.x;")
      .replace("#include <metalnessmap_fragment>", "float metalnessFactor = vPbr.y;")
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = normalize(mix(nonPerturbedNormal, normal, kPaint));")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\nint li = int(vLamp + 0.5);\ntotalEmissiveRadiance += uLampC[li] * uLampI[li];")
      .replace(
        "#include <lights_physical_fragment>",
        `float flopNV = clamp(dot(nonPerturbedNormal, normalize(vViewPosition)), 0.0, 1.0);
        diffuseColor.rgb *= mix(1.0, mix(0.28, 1.0, pow(flopNV, 0.55)), kPaint);
        #include <lights_physical_fragment>`,
      )
      .replace("material.clearcoat = clearcoat;", "material.clearcoat = clearcoat * vPbr.z;");
  });
}

export const glassMat = () =>
  one("glass", () => withHorizon(new THREE.MeshPhysicalMaterial({ color: 0x020304, roughness: 0.0, metalness: 0, ior: 1.6, specularIntensity: 1, transparent: true, opacity: 0.93, envMapIntensity: 1.6, depthWrite: false }), "carglass"));

export type WheelMat = THREE.MeshStandardMaterial;

// All four wheels in one instanced draw. Instance matrix carries position and steer, the `spin` instance attribute rolls
// every vertex but the calipers (pbr.w = 1). pbr: roughness, metalness, kind (1 tire tread, 2 glowing disc), fixed.
export function wheelMat(k: TreadKind): WheelMat {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, normalMap: treadTex(k), normalScale: new THREE.Vector2(1.2, 1.2), side: THREE.DoubleSide, emissive: 0xff4a0a, emissiveIntensity: 0 });
  return withHorizon(m, "carwheel", (s) => {
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 pbr;\nattribute float spin;\nvarying vec4 vPbr;")
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
        float sa = pbr.w > 0.5 ? 0.0 : spin;
        mat3 spinM = mat3(1.0, 0.0, 0.0, 0.0, cos(sa), sin(sa), 0.0, -sin(sa), cos(sa));
        objectNormal = spinM * objectNormal;`,
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed = spinM * transformed;\nvPbr = pbr;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec4 vPbr;")
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = vPbr.x;")
      .replace("#include <metalnessmap_fragment>", "float metalnessFactor = vPbr.y;")
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = normalize(mix(nonPerturbedNormal, normal, 1.0 - step(0.5, abs(vPbr.z - 1.0))));")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= step(1.5, vPbr.z);");
  });
}

// Headlights of cars without real spot lights: a camera facing glint per lamp plus a faint pool on the road.
// Vertex data: position is the lamp (or pool corner), uv the quad corner, kind 0 = glint, 1 = pool.
export function flareMat() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uI: { value: 1 }, uPool: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float kind;
      uniform float uPool;
      varying vec2 vC; varying float vK; varying float vA;
      void main() {
        vC = uv; vK = kind;
        if (vK < 0.5) {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vec3 fwd = normalize((modelViewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
          vec3 toCam = normalize(-mv.xyz);
          float face = clamp(dot(fwd, toCam), 0.0, 1.0);
          vA = face * face;
          float d = length(mv.xyz);
          float s = 0.09 + d * 0.006;
          mv.xy += uv * vec2(s * 3.2, s);
          mv.xyz += toCam * 0.25;
          gl_Position = projectionMatrix * mv;
        } else {
          vA = uPool;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      }`,
    fragmentShader: /* glsl */ `
      uniform float uI;
      varying vec2 vC; varying float vK; varying float vA;
      void main() {
        vec3 col;
        if (vK < 0.5) {
          vec2 p = vC * vec2(3.2, 1.0);
          float r = length(p);
          float core = exp(-r * r * 26.0);
          float halo = exp(-r * 4.5) * 0.18;
          float streak = exp(-abs(vC.y) * 30.0) * (1.0 - abs(vC.x)) * 0.25;
          col = vec3(1.0, 0.95, 0.88) * (core * 3.0 + halo + streak) * vA;
        } else {
          float side = 1.0 - smoothstep(0.35, 1.0, abs(vC.x));
          float along = smoothstep(0.0, 0.12, vC.y) * pow(1.0 - vC.y, 2.0);
          col = vec3(1.0, 0.93, 0.8) * side * along * 0.07 * vA;
        }
        gl_FragColor = vec4(col * uI, 1.0);
      }`,
  });
}

export function setEnvAll(ms: THREE.Material[], env: THREE.Texture | null) {
  for (const m of ms) {
    const s = m as THREE.MeshStandardMaterial;
    if ("envMap" in s && s.envMap !== env) {
      s.envMap = env;
      s.needsUpdate = true;
    }
  }
}
