import * as THREE from "three";

// Typed arrays: UniformsUtils.clone keeps them by reference, so every material sees the updates.
export const FOG_A = new Float32Array([0, 1, 0, 0.004]); // sun dir, height falloff 1/m
export const FOG_B = new Float32Array([0, 600, 800, 0.5]); // base y, end fade start, end fade stop, sun inscatter
export const FOG_SUN = new Float32Array([1, 0.8, 0.6]);
export const SHADOW_CFG = new Float32Array([5, 0, 0, 0]); // PCF taps

function addUniforms(lib: "fog" | "lights", key: string, extra: Record<string, THREE.IUniform>) {
  Object.assign(THREE.UniformsLib[lib], extra);
  for (const sh of Object.values(THREE.ShaderLib)) if (key in sh.uniforms) Object.assign(sh.uniforms, extra);
}

// Exponential height fog plus an end fade at the draw distance, tinted toward the sun.
export function patchFog() {
  const C = THREE.ShaderChunk;
  if (C.fog_fragment.includes("uFogA")) return;
  addUniforms("fog", "fogColor", { uFogA: { value: FOG_A }, uFogB: { value: FOG_B }, uFogSun: { value: FOG_SUN } });
  C.fog_pars_vertex = "#ifdef USE_FOG\n varying float vFogDepth;\n varying vec3 vFogPos;\n#endif";
  C.fog_vertex = "#ifdef USE_FOG\n vFogDepth = - mvPosition.z;\n vFogPos = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;\n#endif";
  C.fog_pars_fragment =
    "#ifdef USE_FOG\n uniform vec3 fogColor;\n uniform vec4 uFogA;\n uniform vec4 uFogB;\n uniform vec3 uFogSun;\n varying float vFogDepth;\n varying vec3 vFogPos;\n #ifdef FOG_EXP2\n  uniform float fogDensity;\n #else\n  uniform float fogNear;\n  uniform float fogFar;\n #endif\n#endif";
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  float fogDist = length( vFogPos );
  vec3 fogRd = vFogPos / max( fogDist, 1e-3 );
  #ifdef FOG_EXP2
    float fogK = uFogA.w * fogRd.y * fogDist;
    float fogH = abs( fogK ) > 1e-4 ? ( 1.0 - exp( - fogK ) ) / fogK : 1.0;
    float fogOd = fogDensity * fogDist * exp( - uFogA.w * clamp( cameraPosition.y - uFogB.x, -30.0, 3000.0 ) ) * fogH;
    float fogFactor = 1.0 - exp( - fogOd );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, fogDist );
  #endif
  fogFactor = max( fogFactor, smoothstep( uFogB.y, uFogB.z, fogDist ) );
  float fogSunK = pow( max( dot( fogRd, uFogA.xyz ), 0.0 ), 8.0 ) * uFogB.w;
  gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( fogColor, uFogSun, fogSunK ), fogFactor );
#endif`;
}

// Directional lights 1..n-1 that cast shadows are cascades of light 0 and add no light themselves.
export function patchShadows() {
  const C = THREE.ShaderChunk;
  if (C.lights_fragment_begin.includes("csmShadow")) return;
  addUniforms("lights", "directionalLights", { uShadowCfg: { value: SHADOW_CFG } });

  let sp = C.shadowmap_pars_fragment;
  const fn = sp.indexOf("float getShadow( sampler2DShadow");
  const a = sp.indexOf("shadow = (", fn);
  const b = sp.indexOf(") * 0.2;", a);
  if (fn < 0 || a < 0 || b < 0) {
    console.warn("render: shadow chunk changed, fixed PCF taps");
  } else {
    sp =
      sp.slice(0, a) +
      `int pcfN = uShadowCfg.x > 0.5 ? int( uShadowCfg.x ) : 5;
				shadow = 0.0;
				for ( int k = 0; k < 16; k ++ ) {
					if ( k >= pcfN ) break;
					shadow += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( k, pcfN, phi ) * radius, shadowCoord.z ) );
				}
				shadow /= float( pcfN );` +
      sp.slice(b + ") * 0.2;".length);
  }
  const step = (k: number) =>
    `#if NUM_DIR_LIGHT_SHADOWS > ${k}
	if ( rem > 0.001 ) { float w = csmEdge( vDirectionalShadowCoord[ ${k} ] ); if ( w > 0.0 ) { DirectionalLightShadow ls = directionalLightShadows[ ${k} ]; acc += rem * w * getShadow( directionalShadowMap[ ${k} ], ls.shadowMapSize, ls.shadowIntensity, ls.shadowBias, ls.shadowRadius, vDirectionalShadowCoord[ ${k} ] ); rem *= 1.0 - w; } }
	#endif`;
  C.shadowmap_pars_fragment =
    "uniform vec4 uShadowCfg;\n" +
    sp +
    /* glsl */ `
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 1
float csmEdge( vec4 sc ) {
	vec3 c = sc.xyz / sc.w;
	vec2 e = abs( c.xy - 0.5 );
	return ( 1.0 - smoothstep( 0.42, 0.49, max( e.x, e.y ) ) ) * step( c.z, 1.0 ) * step( 0.0, c.z );
}
float csmShadow() {
	float acc = 0.0, rem = 1.0;
	${[0, 1, 2, 3].map(step).join("\n\t")}
	return acc + rem;
}
#endif
`;
  const src = C.lights_fragment_begin;
  const start = src.indexOf("#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )");
  const re = src.indexOf("RE_Direct(", start);
  const end = src.indexOf("\n", re);
  if (start < 0 || re < 0) {
    console.warn("render: lights chunk changed, no cascades");
    return;
  }
  const orig = src.slice(start, end);
  C.lights_fragment_begin =
    src.slice(0, start) +
    /* glsl */ `#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 1 && UNROLLED_LOOP_INDEX > 0 && UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS
		#elif defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 1 && UNROLLED_LOOP_INDEX == 0
		if ( directLight.visible && receiveShadow ) directLight.color *= csmShadow();
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
		#else
		${orig}
		#endif` +
    src.slice(end);
}
