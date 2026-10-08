import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

const glsl = (v: THREE.Vector3 | THREE.Color) => `vec3(${[...v.toArray()].map((x) => x.toFixed(4)).join(", ")})`;

// Patches the global fog chunks, so every material with fog gets height fog and sun tint.
export function patchFog(sunDir: THREE.Vector3, warm: THREE.Color) {
  const C = THREE.ShaderChunk;
  if (C.fog_fragment.includes("vFogPos")) return;
  const sun = new THREE.Vector3(sunDir.x, 0, sunDir.z).normalize();
  C.fog_pars_vertex = "#ifdef USE_FOG\n varying float vFogDepth;\n varying vec3 vFogPos;\n#endif";
  C.fog_vertex = "#ifdef USE_FOG\n vFogDepth = - mvPosition.z;\n vFogPos = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;\n#endif";
  C.fog_pars_fragment = "#ifdef USE_FOG\n uniform vec3 fogColor;\n varying float vFogDepth;\n varying vec3 vFogPos;\n #ifdef FOG_EXP2\n  uniform float fogDensity;\n #else\n  uniform float fogNear;\n  uniform float fogFar;\n #endif\n#endif";
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogY = max( cameraPosition.y + vFogPos.y, 0.0 );
    float fogH = exp( - fogY / 90.0 );
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth * mix( 0.55, 1.12, fogH ) );
    fogFactor = max( fogFactor, smoothstep( fogFar * 0.82, fogFar, vFogDepth ) );
  #endif
  float fogSun = pow( max( dot( normalize( vFogPos.xz + 1e-4 ), ${glsl(sun)}.xz ), 0.0 ), 6.0 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( fogColor, ${glsl(warm)}, fogSun * 0.6 ), fogFactor );
#endif`;
}

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 1 },
    uVignette: { value: 0.85 },
    uSunUv: { value: new THREE.Vector2(-9, -9) },
    uSunGlow: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uExposure; uniform float uVignette; uniform vec2 uSunUv; uniform float uSunGlow; uniform float uAspect;
    varying vec2 vUv;
    vec3 rrt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
    vec3 aces(vec3 c) {
      const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      return clamp(O * rrt(I * (c * uExposure / 0.6)), 0.0, 1.0);
    }
    vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(0.41666)) - 0.055, step(0.0031308, c)); }
    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 col = src.rgb;
      if (uSunGlow > 0.0) {
        // Sky brightness around the sun stands in for occlusion: buildings in front kill the glow.
        vec2 o = vec2(0.012 / uAspect, 0.012);
        vec2 s = clamp(uSunUv, vec2(0.002), vec2(0.998));
        float vis = luma(texture2D(tDiffuse, s).rgb + texture2D(tDiffuse, s + o).rgb + texture2D(tDiffuse, s - o).rgb + texture2D(tDiffuse, s + vec2(o.x, -o.y)).rgb + texture2D(tDiffuse, s - vec2(o.x, -o.y)).rgb) / 5.0;
        vis = smoothstep(0.25, 1.1, vis);
        vec2 d = (vUv - uSunUv) * vec2(uAspect, 1.0);
        float r = length(d);
        float glow = 0.1 * exp(-r * 6.0) + 0.25 * exp(-r * 24.0);
        float streak = 0.05 * exp(-abs(d.y) * 90.0) * exp(-abs(d.x) * 3.0);
        col += vec3(1.0, 0.62, 0.36) * (glow + streak) * vis * uSunGlow;
      }
      col = srgb(aces(col));
      float l = luma(col);
      col = mix(vec3(l), col, 1.1);
      vec3 shadowTint = vec3(-0.016, 0.0, 0.026);
      vec3 highTint = vec3(1.045, 1.0, 0.93);
      col += shadowTint * (1.0 - l) * (1.0 - l);
      col *= mix(vec3(1.0), highTint, l * l);
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.32);
      col = col * 0.992 + vec3(0.004, 0.002, 0.009);
      vec2 v = vUv - 0.5;
      col *= 1.0 - dot(v, v) * uVignette;
      col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
    }`,
};

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

export class FinalPass extends ShaderPass {
  constructor(private sunDir: THREE.Vector3) {
    super(FinalShader);
  }
  update(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) {
    const u = this.uniforms;
    u.uExposure.value = renderer.toneMappingExposure;
    u.uAspect.value = camera.aspect;
    camera.getWorldDirection(_f);
    const facing = _f.dot(this.sunDir);
    u.uSunGlow.value = THREE.MathUtils.smoothstep(facing, 0.35, 0.85);
    if (facing > 0) {
      _v.copy(camera.position).addScaledVector(this.sunDir, 1000).project(camera);
      u.uSunUv.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
    }
  }
}

// Bloom blur chain at half the usual resolution; the result is soft anyway.
export class HalfBloomPass extends UnrealBloomPass {
  setSize(width: number, height: number) {
    super.setSize(Math.max(2, Math.round(width / 2)), Math.max(2, Math.round(height / 2)));
  }
}
