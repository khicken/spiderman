import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { FOG_SUN, FOG_WARM, Post, patchFog, patchToneMapping } from "./render-post";
import { Ao } from "./render-ao";
import { WATER, WaterSSR, createRiverMaterial } from "./render-water";
import { CLOCK_KEYS, nightAmount, sunElevation } from "./render-clock";
import { makeNightSky } from "./sky-night";
import { SKY } from "./sky-state";

export type Quality = "low" | "medium" | "high";

export const QUALITIES: Record<
  Quality,
  { label: string; detail: string; pixelRatio: number; shadow: number; range: number; post: 0 | 1 | 2; snow: number; cars: number; fog: number; env: boolean; detailLevel: 0 | 1 | 2; aniso: number }
> = {
  low: { label: "Performance", detail: "No shadows, short view, high frame rate", pixelRatio: 0.75, shadow: 0, range: 0, post: 0, snow: 0, cars: 80, fog: 650, env: true, detailLevel: 0, aniso: 4 },
  medium: { label: "Balanced", detail: "Soft shadows, snow, color grading, sharp edges", pixelRatio: 1, shadow: 2048, range: 90, post: 1, snow: 1800, cars: 180, fog: 1100, env: true, detailLevel: 1, aniso: 8 },
  high: { label: "Fidelity", detail: "Sharp shadows, bloom, heavy snow, far view", pixelRatio: 1.25, shadow: 4096, range: 160, post: 2, snow: 3500, cars: 320, fog: 1800, env: true, detailLevel: 2, aniso: 16 },
};

const MAX_SNOW = 3500;
const TEX_KEYS = ["map", "emissiveMap", "normalMap", "roughnessMap", "metalnessMap", "bumpMap", "alphaMap", "aoMap"] as const;
const FOG = new THREE.Color("#6a6e7f");
const WARM = new THREE.Color("#d9a27c");
const SUN_AZIM = 215;
const SPAWN_CLOCK = 18.5;
const SUN_LOW = new THREE.Color("#ff7a40");
const SUN_DUSK = new THREE.Color("#ffae78");
const SUN_HIGH = new THREE.Color("#fff1dc");
const MOON = new THREE.Color("#9fb4e8");
const NIGHT_HORIZON = new THREE.Color(0.035, 0.045, 0.085);
const UP = new THREE.Vector3(0, 1, 0);
const SAMPLES = { low: 0, medium: 2, high: 4 };
const BLOOM_LEVELS = { low: 0, medium: 3, high: 5 };
const SHADOW_UP = 350;
const SHADOW_DEPTH = 600;
const NEAR_RANGE = 12.5;
const ENV_STEP = 0.25;
const ENV_SAMPLES = 24;
const SKY_HORIZON = 1;
const BOUNCE = new Float32Array([0, 0, 0, 1 / 45]);

function makeSnow() {
  const pos = new Float32Array(MAX_SNOW * 3);
  for (let i = 0; i < MAX_SNOW; i++) pos.set([Math.random() * 90, Math.random() * 60, Math.random() * 90], i * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uScale: { value: 400 }, uBright: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform vec3 uCam; uniform float uScale; varying float vA;
      void main() {
        vec3 box = vec3(90.0, 60.0, 90.0);
        float seed = fract(position.x * 0.137 + position.z * 0.071);
        vec3 p = position;
        p.y -= uTime * (1.6 + seed * 1.4);
        p.x += sin(uTime * 0.7 + seed * 6.28) * 0.8;
        p.z += cos(uTime * 0.5 + seed * 4.0) * 0.6;
        p = mod(p - uCam + box * 0.5, box) - box * 0.5 + uCam;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float z = -mv.z;
        gl_PointSize = min(0.24 * uScale / z, uScale * 0.03);
        vA = smoothstep(44.0, 18.0, z) * smoothstep(1.5, 4.0, z);
        if (vA < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        else gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uBright; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(uBright), a * a * vA);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

function makeHaze(color: THREE.Color, sun: THREE.Vector3) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    uniforms: { uColor: { value: color }, uWarm: { value: WARM }, uSun: { value: sun }, uHeight: { value: 0.16 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform vec3 uWarm; uniform vec3 uSun; uniform float uHeight; varying vec3 vDir;
      void main() {
        float a = 1.0 - smoothstep(-0.03, uHeight, vDir.y);
        float s = pow(max(0.0, dot(normalize(vDir.xz + 1e-5), normalize(uSun.xz))), 6.0) * smoothstep(-0.05, 0.03, vDir.y);
        gl_FragColor = vec4(mix(uColor, uWarm, s), a * a * (3.0 - 2.0 * a));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

// Preetham sky as in three's Sky shader, without clouds and sun disc.
const T_RAY = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
function skyRadiance(dir: THREE.Vector3, sun: THREE.Vector3, u: Record<string, THREE.IUniform>, out: THREE.Color) {
  const g = u.mieDirectionalG.value as number;
  const sunE = 1000 * Math.max(0, 1 - Math.exp(-(1.6110731556870734 - Math.acos(THREE.MathUtils.clamp(sun.y, -1, 1))) / 1.5));
  const za = Math.acos(Math.max(0, dir.y));
  const inv = 1 / (Math.cos(za) + 0.15 * Math.pow(93.885 - (za * 180) / Math.PI, -1.253));
  const cosT = dir.dot(sun);
  const rPhase = 0.05968310365946075 * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
  const mPhase = 0.07957747154594767 * ((1 - g * g) / Math.pow(1 - 2 * g * cosT + g * g, 1.5));
  const k = THREE.MathUtils.clamp(Math.pow(1 - sun.y, 5), 0, 1);
  const c = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const bR = T_RAY[i] * (u.rayleigh.value as number);
    const bM = 0.434 * 0.2 * (u.turbidity.value as number) * 10e-18 * MIE[i] * (u.mieCoefficient.value as number);
    const fex = Math.exp(-(bR * 8400 * inv + bM * 1250 * inv));
    const ratio = (bR * rPhase + bM * mPhase) / (bR + bM);
    let lin = Math.pow(sunE * ratio * (1 - fex), 1.5);
    lin *= 1 + (Math.sqrt(sunE * ratio * fex) - 1) * k;
    c[i] = (lin + 0.1 * fex) * 0.04;
  }
  return out.setRGB(c[0], c[1] + 0.0003, c[2] + 0.00075);
}

const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

// Shadowed directional light 1 is the near cascade for light 0 and adds no light itself.
function patchLights() {
  const C = THREE.ShaderChunk;
  if (C.lights_fragment_begin.includes("pgCascade")) return;
  const src = C.lights_fragment_begin;
  const start = src.indexOf("#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )");
  const reIdx = src.indexOf("RE_Direct(", start);
  const end = src.indexOf("\n", reIdx);
  if (start < 0 || reIdx < 0) {
    console.warn("render: lights chunk changed, no near cascade");
    return;
  }
  const orig = src.slice(start, end);
  const cascade = /* glsl */ `// pgCascade
		#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS == 2 && UNROLLED_LOOP_INDEX == 1
		#elif defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS == 2 && UNROLLED_LOOP_INDEX == 0
		if ( directLight.visible && receiveShadow ) {
			vec3 pgN = vDirectionalShadowCoord[ 1 ].xyz / vDirectionalShadowCoord[ 1 ].w;
			vec2 pgE = abs( pgN.xy - 0.5 );
			float pgW = ( 1.0 - smoothstep( 0.38, 0.48, max( pgE.x, pgE.y ) ) ) * step( pgN.z, 1.0 );
			directionalLightShadow = directionalLightShadows[ 0 ];
			float pgS = pgW < 1.0 ? getShadow( directionalShadowMap[ 0 ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
			if ( pgW > 0.0 ) {
				directionalLightShadow = directionalLightShadows[ 1 ];
				pgS = mix( pgS, getShadow( directionalShadowMap[ 1 ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ 1 ] ), pgW );
			}
			directLight.color *= pgS;
		}
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
		#else
		${orig}
		#endif`;
  const bounce = /* glsl */ `
#if defined( RE_IndirectDiffuse )
	{
		mat3 pgV = transpose( mat3( viewMatrix ) );
		vec3 pgW = pgV * ( geometryPosition - viewMatrix[ 3 ].xyz );
		irradiance += uBounce.rgb * clamp( 0.5 - 0.5 * ( pgV * geometryNormal ).y, 0.0, 1.0 ) * exp( - max( pgW.y, 0.0 ) * uBounce.w );
	}
#endif
`;
  C.lights_fragment_begin = src.slice(0, start) + cascade + src.slice(end) + bounce;
  C.lights_pars_begin = "uniform vec4 uBounce;\n" + C.lights_pars_begin;
  const extra = { uBounce: { value: BOUNCE } };
  Object.assign(THREE.UniformsLib.lights, extra);
  for (const sh of Object.values(THREE.ShaderLib)) if ("hemisphereLights" in sh.uniforms) Object.assign(sh.uniforms, extra);
}

export function createRender(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  patchToneMapping(renderer);
  patchFog();
  patchLights();
  renderer.toneMappingExposure = 0.8;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);

  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - sunElevation(SPAWN_CLOCK)), THREE.MathUtils.degToRad(SUN_AZIM));
  const lightDir = sunDir.clone();
  const moonDir = sunDir.clone().negate();
  const skyParams = { turbidity: 6, rayleigh: 3, mieCoefficient: 0.003, mieDirectionalG: 0.86, cloudCoverage: 0.3 };
  const makeSky = () => {
    const s = new Sky();
    s.scale.setScalar(10000);
    const m = s.material;
    m.fragmentShader = "uniform float uSkyScale;\n" + m.fragmentShader.replace("gl_FragColor = vec4( texColor, 1.0 );", "gl_FragColor = vec4( texColor * uSkyScale, 1.0 );");
    return s;
  };
  const sky = makeSky();
  const skyU = sky.material.uniforms;
  skyU.uSkyScale = { value: 1 };
  for (const [k, val] of Object.entries(skyParams)) skyU[k].value = val;
  skyU.sunPosition.value.copy(sunDir);
  sky.renderOrder = -2;
  scene.add(sky);

  scene.fog = new THREE.Fog(FOG.clone(), 120, 1100);
  const fogColor = (scene.fog as THREE.Fog).color;
  const haze = makeHaze(fogColor, sunDir);
  scene.add(haze);
  const nightSky = makeNightSky(moonDir);
  scene.add(nightSky);
  const nightU = (nightSky.material as THREE.ShaderMaterial).uniforms;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = makeSky();
  envSky.material.uniforms = { ...skyU, showSunDisc: { value: 0 } };
  const envNight = makeNightSky(moonDir);
  (envNight.material as THREE.ShaderMaterial).uniforms = nightU;
  const envHaze = makeHaze(fogColor, sunDir);
  envScene.add(envSky, envNight, envHaze);
  let envRT: THREE.WebGLRenderTarget | null = null;
  let envClock = NaN;
  const rebuildEnv = () => {
    const old = envRT;
    envRT = pmrem.fromScene(envScene, 0, 0.1, 100, { size: 128 });
    // three's 256 GGX samples cost ~10 ms per rebuild.
    const ggx = (pmrem as unknown as { _ggxMaterial?: THREE.ShaderMaterial })._ggxMaterial;
    if (ggx && ggx.defines.GGX_SAMPLES !== ENV_SAMPLES) {
      ggx.defines.GGX_SAMPLES = ENV_SAMPLES;
      ggx.needsUpdate = true;
    }
    scene.environment = envRT.texture;
    old?.dispose();
    envClock = clock;
  };
  scene.environmentIntensity = 0.6;

  const hemi = new THREE.HemisphereLight("#ffd2bd", "#262a44", 0.85);
  const sun = new THREE.DirectionalLight("#ffae78", 3.4);
  sun.shadow.bias = -0.0001;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 2;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = SHADOW_DEPTH;
  const near = new THREE.DirectionalLight(0xffffff, 0);
  near.shadow.bias = -0.0001;
  near.shadow.normalBias = 0.012;
  near.shadow.radius = 2;
  near.shadow.mapSize.set(2048, 2048);
  near.shadow.camera.near = 1;
  near.shadow.camera.far = SHADOW_DEPTH;
  const nc = near.shadow.camera;
  nc.left = nc.bottom = -NEAR_RANGE;
  nc.right = nc.top = NEAR_RANGE;
  nc.updateProjectionMatrix();
  const fill = new THREE.DirectionalLight("#6f86c8", 0.35);
  scene.add(hemi, sun, sun.target, near, near.target, fill);

  const snow = makeSnow();
  scene.add(snow);
  const snowU = (snow.material as THREE.ShaderMaterial).uniforms;

  let quality: Quality = "medium";
  let post: Post | null = null;
  let ao: Ao | null = null;
  let ssr: WaterSSR | null = null;
  let range = 0;
  let speed = 0;
  let time = 0;

  const buildPost = () => {
    post?.dispose();
    ao?.dispose();
    ssr?.dispose();
    post = ao = ssr = null;
    if (!QUALITIES[quality].post) return;
    post = new Post({ samples: SAMPLES[quality], bloomLevels: BLOOM_LEVELS[quality] });
    post.glow = sunGlow;
    if (quality === "high") {
      ao = new Ao();
      ssr = new WaterSSR();
      post.final.uniforms.tAO.value = ao.texture;
      post.final.uniforms.tSSR.value = ssr.target.texture;
    }
  };

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    const pr = renderer.getPixelRatio();
    const W = Math.round(w * pr), H = Math.round(h * pr);
    post?.setSize(W, H);
    ao?.setSize(W, H);
    ssr?.setSize(W, H);
    if (post && ao) post.final.uniforms.uAORes.value.set(ao.a.width, ao.a.height);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    snowU.uScale.value = h * pr * 0.5;
  };

  const setRange = (r: number) => {
    if (r === range) return;
    range = r;
    const c = sun.shadow.camera;
    c.left = c.bottom = -r;
    c.right = c.top = r;
    c.updateProjectionMatrix();
  };

  const setQuality = (q: Quality) => {
    quality = q;
    const Q = QUALITIES[q];
    renderer.setPixelRatio(Q.pixelRatio > 1 ? Math.min(window.devicePixelRatio, Q.pixelRatio) : Q.pixelRatio);
    renderer.shadowMap.enabled = Q.shadow > 0;
    sun.castShadow = Q.shadow > 0;
    near.castShadow = q === "high";
    if (Q.shadow) {
      sun.shadow.mapSize.set(Q.shadow, Q.shadow);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      range = 0;
      setRange(Q.range);
    }
    const aniso = Math.min(Q.aniso, renderer.capabilities.getMaxAnisotropy());
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const x of Array.isArray(m) ? m : [m]) {
        x.needsUpdate = true;
        for (const k of TEX_KEYS) {
          const t = (x as unknown as Record<string, THREE.Texture | null>)[k];
          if (t?.isTexture && !(t instanceof THREE.DataTexture) && t.anisotropy !== aniso) {
            t.anisotropy = aniso;
            t.needsUpdate = true;
          }
        }
      }
    });
    const fog = scene.fog as THREE.Fog;
    fog.far = Q.fog;
    fog.near = Q.fog * 0.08;
    camera.far = Q.fog * 1.02;
    snow.visible = Q.snow > 0;
    snow.geometry.setDrawRange(0, Q.snow);
    glowBound = false;
    clock = -1;
    buildPost();
    resize();
  };

  const lx = new THREE.Vector3();
  const ly = new THREE.Vector3();
  const center = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const tmpC = new THREE.Color();
  const skyA = new THREE.Color();
  const keyA = new THREE.Color();
  const K = CLOCK_KEYS;
  const keyVal = new Float32Array(K.stride);
  let clock = -1;
  let night = 0.3;
  let sunGlow = 1;
  let bloomK = 0.3;
  let bloomT = 1.4;
  let glowBound = false;

  const bindGlow = () => {
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (m && !Array.isArray(m) && m.isMeshBasicMaterial && m.toneMapped === false && m.customProgramCacheKey() === "blink") m.color = SKY.glow;
    });
    glowBound = true;
  };

  const matchSky = (out: THREE.Color, sky: THREE.Color, key: THREE.Color) => {
    const ls = lum(sky), lk = lum(key);
    const t = THREE.MathUtils.smoothstep(ls, 0.004, 0.04);
    sky.multiplyScalar(Math.min(ls, lk * 2.2) / Math.max(ls, 1e-6));
    return out.copy(key).lerp(sky, t);
  };

  const skyFog = (nightA: number) => {
    const sx = sunDir.x, sz = sunDir.z;
    const sl = Math.hypot(sx, sz) || 1;
    skyA.setRGB(0, 0, 0);
    for (let i = 0; i < 5; i++) {
      const a = Math.atan2(sz, sx) + Math.PI * (0.5 + i * 0.25);
      dir.set(Math.cos(a), 0.06, Math.sin(a)).normalize();
      skyA.add(skyRadiance(dir, sunDir, skyU, tmpC));
    }
    const scale = Math.min(1, SKY_HORIZON / Math.max(lum(skyA) / 5, 1e-6));
    skyU.uSkyScale.value = scale;
    skyA.multiplyScalar(scale / 5);
    matchSky(fogColor, skyA, keyA.setRGB(keyVal[0], keyVal[1], keyVal[2]));
    dir.set(sx / sl, 0.06, sz / sl).normalize();
    matchSky(WARM, skyRadiance(dir, sunDir, skyU, skyA).multiplyScalar(scale), keyA.setRGB(keyVal[3], keyVal[4], keyVal[5]));
    fogColor.lerp(NIGHT_HORIZON, nightA);
    WARM.lerp(fogColor, nightA);
    const cap = (1.5 * lum(fogColor)) / Math.max(lum(WARM), 1e-5);
    if (cap < 1) WARM.multiplyScalar(cap);
  };

  const setClock = (hours: number) => {
    const h = ((hours % 24) + 24) % 24;
    if (!glowBound) bindGlow();
    if (Math.abs(h - clock) < 1e-4) return;
    clock = h;
    K.sample(h, keyVal);
    const e = sunElevation(h);
    sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - e), THREE.MathUtils.degToRad(SUN_AZIM + (h - SPAWN_CLOCK) * 15));
    moonDir.copy(sunDir).negate();
    if (moonDir.y < 0.05) moonDir.y = 0.05;
    moonDir.normalize();
    night = nightAmount(e);
    const sunUp = e > -1.5;
    if (sunUp) {
      lightDir.copy(sunDir);
      if (lightDir.y < 0.02) lightDir.setY(0.02).normalize();
      sun.intensity = Math.min(1, (e + 1.5) / 5.4) * (3.4 + 0.8 * THREE.MathUtils.smoothstep(e, 4, 40));
      if (e < 4) sun.color.copy(SUN_LOW).lerp(SUN_DUSK, THREE.MathUtils.clamp(e / 4, 0, 1));
      else sun.color.copy(SUN_DUSK).lerp(SUN_HIGH, THREE.MathUtils.smoothstep(e, 4, 30));
    } else {
      lightDir.copy(moonDir);
      sun.intensity = 0.45 * THREE.MathUtils.clamp((-e - 1.5) / 8, 0, 1);
      sun.color.copy(MOON);
    }
    const bounce = quality === "high" && sunUp ? sun.intensity * Math.max(lightDir.y, 0) * 0.06 : 0;
    BOUNCE[0] = sun.color.r * bounce;
    BOUNCE[1] = sun.color.g * bounce;
    BOUNCE[2] = sun.color.b * bounce;
    lx.crossVectors(lightDir, UP).normalize();
    ly.crossVectors(lx, lightDir).normalize();
    const v = keyVal;
    const u = skyU;
    u.sunPosition.value.copy(sunDir);
    const day = THREE.MathUtils.smoothstep(e, 5, 35);
    u.rayleigh.value = 3 - 0.8 * day;
    u.turbidity.value = 6 - 3.5 * day;
    u.cloudCoverage.value = 0.32 - 0.12 * day;
    nightU.uNight.value = THREE.MathUtils.smoothstep(night, 0.45, 0.95);
    nightSky.visible = envNight.visible = nightU.uNight.value > 0.001;
    skyFog(nightU.uNight.value);
    FOG_WARM[0] = WARM.r;
    FOG_WARM[1] = WARM.g;
    FOG_WARM[2] = WARM.b;
    const fs = Math.hypot(sunDir.x, sunDir.z) || 1;
    FOG_SUN[0] = sunDir.x / fs;
    FOG_SUN[1] = sunDir.z / fs;
    FOG_SUN[2] = THREE.MathUtils.smoothstep(e, -4, 2);
    hemi.color.setRGB(v[6], v[7], v[8]);
    hemi.groundColor.setRGB(v[9], v[10], v[11]);
    hemi.intensity = v[12];
    renderer.toneMappingExposure = v[13];
    scene.environmentIntensity = v[14];
    bloomK = v[15];
    bloomT = night < 0.35 ? 8 - 6.6 * Math.sqrt(night / 0.35) : 1.4;
    SKY.reflHi.value.setRGB(v[16], v[17], v[18]);
    SKY.reflLo.value.setRGB(v[19], v[20], v[21]);
    SKY.glow.setScalar(v[22]);
    SKY.headlight.setScalar(v[23]);
    fill.intensity = v[24];
    fill.color.setRGB(v[25], v[26], v[27]);
    SKY.night.value = night;
    sunGlow = THREE.MathUtils.smoothstep(e, -2, 3);
    if (post) post.glow = sunGlow;
    snowU.uBright.value = 1 - 0.5 * night;
    SKY.steam.setRGB(0.74, 0.79, 0.85).multiplyScalar(1 - 0.7 * night);
  };
  setClock(SPAWN_CLOCK);

  const snap = (out: THREE.Vector3, u: number, v: number, w: number, texel: number) =>
    out.copy(lx).multiplyScalar(Math.round(u / texel) * texel).addScaledVector(ly, Math.round(v / texel) * texel).addScaledVector(lightDir, w);

  const frame = (t: number, focus: THREE.Vector3) => {
    const Q = QUALITIES[quality];
    time = t;
    WATER.time.value = t % 3600;
    camera.getWorldDirection(fwd);
    if (Q.shadow) {
      const cp = camera.position;
      const alt = THREE.MathUtils.clamp((cp.y - 40) / 110, 0, 1);
      setRange(Q.range * (1 + Math.round(alt * 4) / 4));
      const fh = Math.hypot(fwd.x, fwd.z) || 1e-3;
      const hit = fwd.y < -0.02 ? (cp.y / -fwd.y) * fh : Infinity;
      const hd = Math.min(hit, range * 0.8) + range * 0.15;
      center.set(cp.x + (fwd.x / fh) * hd, 0, cp.z + (fwd.z / fh) * hd);
      const m = range - 14;
      const hu = focus.dot(lx), hv = focus.dot(ly);
      const gu = THREE.MathUtils.clamp(center.dot(lx), hu - m, hu + m);
      const gv = THREE.MathUtils.clamp(center.dot(ly), hv - m, hv + m);
      snap(center, gu, gv, center.dot(lightDir), (2 * range) / Q.shadow);
      sun.target.position.copy(center);
      sun.position.copy(center).addScaledVector(lightDir, SHADOW_UP);
      if (near.castShadow) {
        snap(center, hu, hv, focus.dot(lightDir), (2 * NEAR_RANGE) / 2048);
        near.target.position.copy(center);
        near.position.copy(center).addScaledVector(lightDir, SHADOW_UP);
      }
    }
    fill.position.set(-fwd.x, 0.6, -fwd.z);
    skyU.time.value = t;
    if (snow.visible) {
      snowU.uTime.value = t % 600;
      snowU.uCam.value.copy(camera.position);
    }
  };

  const render = () => {
    const d = Math.abs(clock - envClock) % 24;
    if (!(Math.min(d, 24 - d) < ENV_STEP)) rebuildEnv();
    if (!post) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }
    const night1 = THREE.MathUtils.smoothstep(night, 0.3, 0.6);
    post.bloomStrength = quality === "high" ? bloomK : bloomK * night1;
    if (post.bloom) post.bloom.threshold = bloomT;
    post.speed = speed;
    post.update(renderer, camera, sunDir, time);
    post.renderScene(renderer, scene, camera);
    const tex = post.target.texture, depth = post.target.depthTexture!;
    if (ao) ao.render(renderer, depth, camera);
    post.final.uniforms.uAO.value = ao ? 0.85 : 0;
    const water = !!ssr && ssr.active;
    if (water) {
      ssr!.render(renderer, tex, depth, camera);
      post.final.uniforms.uWaterY.value = WATER.level.value;
    }
    post.final.uniforms.uSSR.value = water ? 1 : 0;
    post.renderBloom(renderer);
    post.renderFinal(renderer);
  };

  return {
    renderer,
    scene,
    camera,
    get quality() {
      return quality;
    },
    setQuality,
    setClock,
    get night() {
      return night;
    },
    setSpeed(mps: number) {
      speed = quality === "low" ? 0 : THREE.MathUtils.smoothstep(mps, 30, 55);
    },
    riverMaterial: createRiverMaterial,
    resize,
    frame,
    render,
    dispose() {
      post?.dispose();
      ao?.dispose();
      ssr?.dispose();
      pmrem.dispose();
      envRT?.dispose();
      snow.geometry.dispose();
      (snow.material as THREE.Material).dispose();
      haze.geometry.dispose();
      envHaze.geometry.dispose();
      envNight.geometry.dispose();
      nightSky.geometry.dispose();
      (nightSky.material as THREE.Material).dispose();
      (haze.material as THREE.Material).dispose();
      renderer.dispose();
    },
  };
}

export type Render = ReturnType<typeof createRender>;
