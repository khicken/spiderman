import * as THREE from "three";
import type { Quality } from "./contracts";
import { carbonTex, discTex, flakeTex, grilleTex, treadTex, type GrilleKind, type TreadKind } from "./car-tex";

// Lamp ids stored in the `lamp` vertex attribute.
export const LAMP = { none: 0, head: 1, drl: 2, tail: 3, brake: 4, reverse: 5, amber: 6, aux: 7 } as const;
const LAMP_COL = [
  [0, 0, 0], [1, 0.96, 0.88], [0.85, 0.92, 1], [1, 0.005, 0.002], [1, 0.004, 0.002], [1, 1, 1], [1, 0.42, 0], [1, 0.93, 0.78],
].map(([r, g, b]) => new THREE.Vector3(r, g, b));

const shared = new Map<string, THREE.Material>();
const one = <M extends THREE.Material>(k: string, make: () => M) => {
  let m = shared.get(k) as M | undefined;
  if (!m) shared.set(k, (m = make()));
  return m;
};

export function paintMat(hex: string, panel: THREE.Texture, q: Quality) {
  const m = new THREE.MeshPhysicalMaterial({
    color: hex,
    metalness: 0.3,
    roughness: 0.3,
    clearcoat: q === "low" ? 0 : 1,
    clearcoatRoughness: 0.03,
    map: panel,
    envMapIntensity: 1.1,
  });
  panel.channel = 1;
  if (q !== "low") {
    m.normalMap = flakeTex();
    m.normalScale.set(0.22, 0.22);
    m.normalMap.repeat.set(2, 2);
  }
  return m;
}

export const glassMat = (q: Quality) =>
  one("glass" + (q === "low"), () =>
    q === "low"
      ? new THREE.MeshStandardMaterial({ color: 0x07090b, roughness: 0.05, metalness: 0.6 })
      : new THREE.MeshPhysicalMaterial({ color: 0x05070a, roughness: 0.03, metalness: 0.2, transparent: true, opacity: 0.88, envMapIntensity: 2.4, depthWrite: false }),
  );

export const trimMat = (carbon: boolean) =>
  one("trim" + carbon, () => {
    if (!carbon) return new THREE.MeshStandardMaterial({ color: 0x0e0f10, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide });
    const t = carbonTex();
    t.repeat.set(8, 8);
    return new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: t, roughness: 0.35, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide });
  });

export const chromeMat = () => one("chrome", () => new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 1, roughness: 0.07 }));

export const grilleMat = (k: GrilleKind) =>
  one("grille" + k, () => {
    const t = grilleTex(k);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, metalness: 0.4 });
  });

export const interiorMat = () => one("interior", () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 }));
export const rimMat = () => one("rim", () => new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.85, roughness: 0.22, side: THREE.DoubleSide }));

export const tireMat = (k: TreadKind) =>
  one("tire" + k, () => {
    const n = treadTex(k);
    return new THREE.MeshStandardMaterial({ color: 0x121213, roughness: k === "slick" ? 0.62 : 0.86, normalMap: n, normalScale: new THREE.Vector2(1.2, 1.2), side: THREE.DoubleSide });
  });

export function brakeMat() {
  const t = discTex();
  const e = t.clone();
  e.channel = 1;
  return new THREE.MeshStandardMaterial({ vertexColors: true, map: t, metalness: 0.75, roughness: 0.32, emissive: 0xff4a0a, emissiveMap: e, emissiveIntensity: 0, side: THREE.DoubleSide });
}

export type LampMat = THREE.MeshPhysicalMaterial & { lamp: Float32Array };

// One material for every light, emission per lamp id from a uniform array.
export function lampMat(): LampMat {
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.02 }) as LampMat;
  m.lamp = new Float32Array(8);
  const u = { value: m.lamp }, c = { value: LAMP_COL };
  m.onBeforeCompile = (s) => {
    s.uniforms.uLampI = u;
    s.uniforms.uLampC = c;
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nattribute float lamp;\nvarying float vLamp;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvLamp = lamp;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uLampI[8];\nuniform vec3 uLampC[8];\nvarying float vLamp;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\nint li = int(vLamp + 0.5);\ntotalEmissiveRadiance += uLampC[li] * uLampI[li];");
  };
  m.customProgramCacheKey = () => "carlamp";
  return m;
}

// Additive cone for headlights on cars without real spot lights.
export const coneMat = () =>
  one("cone", () =>
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uI: { value: 1 } },
      vertexShader: "varying float vT; varying vec3 vN; varying vec3 vV; void main(){ vT = uv.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }",
      fragmentShader: "uniform float uI; varying float vT; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(abs(dot(vN, vV)), 1.5); float a = (1.0 - vT) * (1.0 - vT) * f * 0.16 * uI; gl_FragColor = vec4(vec3(1.0,0.95,0.85)*a, a); }",
    }),
  );

export function setEnvAll(ms: THREE.Material[], env: THREE.Texture | null) {
  for (const m of ms) {
    const s = m as THREE.MeshStandardMaterial;
    if ("envMap" in s && s.envMap !== env) {
      s.envMap = env;
      s.needsUpdate = true;
    }
  }
}
