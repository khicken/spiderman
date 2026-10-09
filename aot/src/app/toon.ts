import * as THREE from "three";
import type { ToonOpts } from "./contracts";

let ramp: THREE.DataTexture | null = null;

// NdotL maps to u = NdotL * 0.5 + 0.5: shadow below 0, a thin mid band, then full sun.
function gradient() {
  if (ramp) return ramp;
  const v = [0, 0, 0, 0, 0, 0, 0, 0, 120, 120, 255, 255, 255, 255, 255, 255];
  const data = new Uint8Array(v.length * 4);
  v.forEach((x, i) => data.set([x, x, x, 255], i * 4));
  ramp = new THREE.DataTexture(data, v.length, 1);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}

// Pink-tan albedo keeps a warm, light shadow band instead of the cool hemisphere tint.
const SKIN = /* glsl */ `
{
  vec3 dc = max(diffuseColor.rgb, vec3(1e-4));
  float gr = dc.g / dc.r, br = dc.b / dc.r;
  float skin = smoothstep(0.8, 0.7, gr) * smoothstep(0.4, 0.5, gr) * smoothstep(0.24, 0.32, br) * smoothstep(0.66, 0.56, br) * smoothstep(0.25, 0.4, dc.r);
  float ratio = dot(outgoingLight - totalEmissiveRadiance, vec3(1.0)) / dot(dc, vec3(1.0));
  vec3 band = mix(vec3(0.7, 0.56, 0.6), vec3(1.0, 0.95, 0.9), smoothstep(0.5, 0.8, ratio));
  outgoingLight = mix(outgoingLight, dc * band + totalEmissiveRadiance, skin);
  outgoingLight = max(outgoingLight, dc * vec3(0.2, 0.2, 0.26));
}
#include <opaque_fragment>`;

const patch = (sh: { fragmentShader: string }) => {
  sh.fragmentShader = sh.fragmentShader.replace("#include <opaque_fragment>", SKIN);
};

export function toon(o: ToonOpts): THREE.Material {
  const m = new THREE.MeshToonMaterial({
    color: o.color,
    map: o.map ?? null,
    vertexColors: o.vertexColors ?? false,
    emissive: o.emissive ?? 0x000000,
    side: o.side ?? THREE.FrontSide,
    gradientMap: gradient(),
  });
  m.onBeforeCompile = patch;
  m.customProgramCacheKey = () => "aot-toon";
  if (o.outline === false) m.userData.noInk = true;
  return m;
}
