import * as THREE from "three";

export function makeNightSky(moonDir: THREE.Vector3) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    uniforms: { uNight: { value: 0 }, uMoon: { value: moonDir } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight; uniform vec3 uMoon; varying vec3 vDir;
      float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      void main() {
        vec3 d = normalize(vDir);
        float up = max(d.y, 0.0);
        vec3 col = mix(vec3(0.035, 0.045, 0.085), vec3(0.006, 0.01, 0.03), sqrt(up));
        vec2 sp = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) * 120.0;
        vec2 cell = floor(sp);
        float h = hash(cell);
        vec2 off = vec2(hash(cell + 7.1), hash(cell + 3.7)) - 0.5;
        float r = length(fract(sp) - 0.5 - off * 0.6);
        float star = step(0.985, h) * smoothstep(0.16, 0.0, r) * (0.6 + 2.4 * fract(h * 37.0)) * smoothstep(0.02, 0.25, d.y);
        col += vec3(0.85, 0.9, 1.0) * star;
        float m = dot(d, normalize(uMoon));
        float disc = smoothstep(0.99955, 0.9997, m);
        col += vec3(1.0, 0.96, 0.86) * disc * 3.0 + vec3(0.25, 0.3, 0.45) * pow(max(m, 0.0), 400.0) * 0.6 + vec3(0.06, 0.08, 0.14) * pow(max(m, 0.0), 12.0);
        gl_FragColor = vec4(col, uNight);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1.5;
  return mesh;
}
