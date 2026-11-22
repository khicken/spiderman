// GLSL for the terrain and the water. Both paste Look.glsl (cel bands, rim, lantern, fog). Owner: terrain.
// Terrain: chunks are instanced flat grids; the vertex shader lifts them from the R32F heightmap with texelFetch,
// so every LOD reads the exact same heights. Normals, AO and splats come from textures, so lighting never pops.

export const TERRAIN_VERT = /* glsl */ `
uniform highp sampler2D uTHeight;
attribute vec2 aOffset;
varying vec3 vWorld;
void main() {
  vec2 xz = aOffset + position.xz;
  ivec2 gi = clamp(ivec2(floor(xz + 640.5)), ivec2(0), ivec2(1280));
  float h = texelFetch(uTHeight, gi, 0).r;
  vWorld = vec3(xz.x, h + position.y, xz.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

export const terrainFrag = (lookGlsl: string) => /* glsl */ `
uniform sampler2D uTNormal;
uniform sampler2D uTSplatA;
uniform sampler2D uTSplatB;
uniform sampler2D uTDetail;
uniform sampler2D uTNoise;
uniform vec3 uCGrass;
uniform vec3 uCGrassFar;
uniform vec3 uCGrassWarm;
uniform vec3 uCForest;
uniform vec3 uCRock;
uniform vec3 uCAshRock;
uniform vec3 uCAsh;
uniform vec3 uCSand;
uniform vec3 uCDirt;
uniform vec3 uCSnow;
uniform vec3 uCMud;
uniform vec3 uCWaterShallow;
uniform vec4 uTLake; // x, z, r, level
uniform float uFade; // draw distance: fade fully into fog before the sky dome (far * 0.9)
varying vec3 vWorld;

${lookGlsl}

float sharpen(float w, float d) { return smoothstep(0.38, 0.62, w + (d - 0.5) * 0.55); }

void main() {
  vec2 xz = vWorld.xz;
  vec4 nt = texture2D(uTNormal, (xz + 640.5) / 1281.0);
  vec3 n = normalize(nt.xyz * 2.0 - 1.0);
  float ao = nt.a;
  vec2 suv = (xz + 641.0) / 1282.0;
  vec4 sa = texture2D(uTSplatA, suv);
  vec4 sb = texture2D(uTSplatB, suv);
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 1e-4);

  vec4 dA = texture2D(uTDetail, xz * 0.15);
  vec4 dB = texture2D(uTDetail, xz * 0.041 + vec2(0.31, 0.77));
  vec4 big = texture2D(uTNoise, xz * 0.0024);
  vec4 mid = texture2D(uTNoise, xz * 0.011 + vec2(0.4, 0.1));
  float fade = smoothstep(50.0, 260.0, dist);
  vec4 det = mix(mix(dA, dB, 0.4), vec4(0.5), fade * 0.75);

  // meadow: near/far palette, broad patches, warm sun-dried flecks
  float patchy = big.r * 0.7 + mid.g * 0.3;
  vec3 grass = mix(uCGrass, uCGrassFar, clamp(smoothstep(40.0, 420.0, dist) * 0.65 + (patchy - 0.5) * 1.3, 0.0, 1.0));
  grass = mix(grass, uCGrassWarm, smoothstep(0.58, 0.78, big.g) * 0.55);
  grass *= 0.84 + 0.3 * det.r;
  vec3 forestC = uCForest * (0.82 + 0.36 * det.r) * (0.9 + 0.2 * mid.r);
  vec3 col = mix(grass, forestC, smoothstep(0.2, 0.8, sa.a));
  col = mix(col, col * vec3(0.9, 0.97, 0.96), smoothstep(60.0, 110.0, vWorld.y));

  col = mix(col, uCAsh * (0.78 + 0.44 * det.a), sharpen(sb.g, det.a));
  col = mix(col, uCDirt * (0.78 + 0.42 * det.a), sharpen(sa.b, det.a));
  col = mix(col, uCMud * (0.85 + 0.3 * det.a), sb.a * 0.7);

  vec3 sandC = uCSand * (0.86 + 0.26 * det.b);
  sandC = mix(sandC, sandC * vec3(0.74, 0.76, 0.78), smoothstep(1.1, 0.25, vWorld.y) * smoothstep(-2.0, 0.0, vWorld.y));
  col = mix(col, sandC, sharpen(sa.r, det.b));

  // rock: facet normal catches heightfield walls the 1 m normal map smears; biplanar detail, cel strata ledges
  vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
  vec3 fN = normalize(cross(dpx, dpy));
  if (fN.y < 0.0) fN = -fN;
  float wall = smoothstep(0.6, 0.38, fN.y) * smoothstep(0.93, 0.8, n.y);
  vec3 an = pow(abs(fN), vec3(4.0));
  an /= (an.x + an.y + an.z);
  float rx = texture2D(uTDetail, vWorld.zy * vec2(0.07, 0.05)).g;
  float rz = texture2D(uTDetail, vWorld.xy * vec2(0.07, 0.05)).g;
  float rdet = mix(rx * an.x + rz * an.z + dA.g * an.y, 0.5, fade * 0.45);
  float layer = vWorld.y / 7.5 + (big.r - 0.5) * 1.6;
  float lf = fract(layer);
  float tone = fract(sin(floor(layer) * 12.9898) * 43758.5453);
  vec3 rockBase = mix(uCRock, uCAshRock, sb.r) * (0.86 + 0.26 * tone);
  float slopeRock = max(smoothstep(0.79, 0.66, n.y + (rdet - 0.5) * 0.12), smoothstep(0.66, 0.5, fN.y) * smoothstep(0.93, 0.8, n.y));
  float steep = max(slopeRock, wall);
  float lip = smoothstep(0.84, 0.9, lf) * steep;
  float seam = (1.0 - smoothstep(0.0, 0.09, lf)) * steep;
  vec3 rockC = rockBase * (0.74 + 0.48 * rdet) * (1.0 + 0.22 * lip - 0.28 * seam);
  float rock = max(sharpen(sa.g, rdet), slopeRock);
  col = mix(col, rockC, rock);

  // bump: rock relief as a world-space gradient of the biplanar detail. Screen derivatives (dFdx of the detail)
  // are constant per 2x2 pixel quad, and the cel ramp turned them into blocky camo on walls seen up close.
  // Facets from the 1 m heightfield read as noise near the camera, so they only lean in with distance.
  vec3 nL = normalize(mix(n, fN, wall * mix(0.2, 0.6, smoothstep(25.0, 90.0, dist))));
  float bAmt = rock * (1.0 - fade);
  if (bAmt > 0.02) {
    vec3 t1 = normalize(cross(nL, abs(nL.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(t1, nL);
    float e = 0.3;
    vec3 p1 = vWorld + t1 * e, p2 = vWorld + t2 * e;
    float h0 = rx * an.x + rz * an.z + dA.g * an.y;
    float h1 = texture2D(uTDetail, p1.zy * vec2(0.07, 0.05)).g * an.x + texture2D(uTDetail, p1.xy * vec2(0.07, 0.05)).g * an.z + texture2D(uTDetail, p1.xz * 0.15).g * an.y;
    float h2 = texture2D(uTDetail, p2.zy * vec2(0.07, 0.05)).g * an.x + texture2D(uTDetail, p2.xy * vec2(0.07, 0.05)).g * an.z + texture2D(uTDetail, p2.xz * 0.15).g * an.y;
    nL = normalize(nL - (t1 * (h1 - h0) + t2 * (h2 - h0)) * (bAmt * 0.9 / e));
  }

  float snow = sharpen(sb.b * smoothstep(0.5, 0.82, min(n.y, fN.y + 0.1)), det.b);
  col = mix(col, uCSnow * (0.94 + 0.08 * det.b), snow);

  // under water: sea floor (y < 0) and lake floor
  float lakeD = length(xz - uTLake.xy) < uTLake.z + 6.0 ? uTLake.w - vWorld.y : -1.0;
  float wd = max(-vWorld.y, lakeD);
  if (wd > 0.0) {
    float c1 = texture2D(uTNoise, xz * 0.09 + vec2(uTime * 0.021, uTime * 0.013)).b;
    float c2 = texture2D(uTNoise, xz * 0.07 - vec2(uTime * 0.017, -uTime * 0.019)).b;
    float caust = smoothstep(0.25, 0.6, min(c1, c2) * 2.2) * (1.0 - smoothstep(0.0, 7.0, wd));
    col = mix(col, col * uCWaterShallow * 1.6, smoothstep(0.0, 2.5, wd) * 0.6);
    col += caust * 0.22;
  }

  col *= mix(0.58, 1.0, ao);
  vec3 lit = hmShade(col, nL, vWorld, V);
  lit = hmFog(lit, dist);
  lit = mix(lit, uFogColor, smoothstep(uFade * 0.78, uFade * 0.9, dist));
  gl_FragColor = vec4(lit, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const WATER_VERT = /* glsl */ `
attribute vec3 aFlow;
varying vec3 vWorld;
varying vec3 vFlow;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vFlow = aFlow;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const waterFrag = (lookGlsl: string) => /* glsl */ `
uniform sampler2D uTHeightLo;
uniform sampler2D uTNoise;
uniform vec3 uWShallow;
uniform vec3 uWDeep;
uniform vec3 uWFoam;
uniform float uFade;
varying vec3 vWorld;
varying vec3 vFlow;

${lookGlsl}

void main() {
  vec2 xz = vWorld.xz;
  float th = texture2D(uTHeightLo, (xz + 641.0) / 1282.0).r;
  float depth = vWorld.y - th;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 1e-4);
  float t = uTime;
  vec2 flow = vFlow.xz;
  float speed = length(flow);
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 n = up;
  float fn = texture2D(uTNoise, xz * 0.045 + vec2(t * 0.011, -t * 0.014)).a;
#if WQ > 0
  vec2 w1 = texture2D(uTNoise, xz * 0.043 + vec2(t * 0.021, t * 0.012) - flow * t * 0.05).rg - 0.5;
  vec2 w2 = texture2D(uTNoise, xz * 0.071 + vec2(-t * 0.016, t * 0.023) - flow * t * 0.08).gr - 0.5;
  float amp = mix(0.24, 0.06, smoothstep(40.0, 400.0, dist));
  n = normalize(vec3((w1.x + w2.x) * amp, 1.0, (w1.y + w2.y) * amp));
#endif

  float dd = smoothstep(0.0, speed > 0.01 ? 2.8 : 8.0, depth);
  float band = floor(dd * 4.0 + 0.35) / 4.0;
  vec3 base = mix(uWShallow, uWDeep, mix(dd, band, 0.45));
  vec3 col = hmShade(base, up, vWorld, V);

  float fr = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 4.0);
  col = mix(col, uSkyColor * 0.6 + uFogColor * 0.4, fr * 0.4);
  vec3 R = reflect(-uSunDir, n);
  float sp = pow(max(dot(R, V), 0.0), 90.0);
  col += uSunColor * smoothstep(0.3, 0.42, sp) * 0.85;

  float contact = 1.0 - smoothstep(0.0, 0.05 + fn * 0.14, depth);
  float foam = contact;
#if WQ > 0
  float ring = sin(depth * 4.2 - t * 1.6 + fn * 6.0);
  foam = max(foam, smoothstep(0.9, 0.96, ring) * (1.0 - smoothstep(0.1, 0.6, depth)) * (1.0 - smoothstep(120.0, 260.0, dist)) * 0.7);
#endif
  if (speed > 0.01) {
    vec2 dir = flow / speed;
    vec2 perp = vec2(-dir.y, dir.x);
    float s = texture2D(uTNoise, vec2(dot(xz, perp) * 0.11, dot(xz, dir) * 0.018 - t * speed * 0.03)).a;
    foam = max(foam, smoothstep(0.74, 0.8, s) * 0.85);
  }
  if (vFlow.y > 0.01) {
    float wsx = texture2D(uTNoise, vec2(dot(xz, vec2(-flow.y, flow.x) / max(speed, 0.01)) * 0.25, dot(xz, flow / max(speed, 0.01)) * 0.06 - t * 0.9)).a;
    foam = max(foam, vFlow.y * smoothstep(0.42, 0.62, wsx + fn * 0.3));
    col = mix(col, hmShade(uWFoam, up, vWorld, V), vFlow.y * 0.3);
  }
  vec3 foamC = hmShade(uWFoam, up, vWorld, V);
  col = mix(col, foamC, foam);

  float a = mix(0.42, 0.93, smoothstep(0.0, 4.0, depth));
  a = max(a, foam);
  a = mix(a, 1.0, fr * 0.5);
  col = hmFog(col, dist);
  col = mix(col, uFogColor, smoothstep(uFade * 0.78, uFade * 0.9, dist));
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
