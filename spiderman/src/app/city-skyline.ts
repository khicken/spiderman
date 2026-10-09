import * as THREE from "three";
import { SKY } from "./sky-state";

type Card = { pts: [number, number][]; h: number[] };

const CARDS: Card[] = [
  { pts: [[-360, 1420], [-360, 1000], [-385, 676], [-430, 399], [-450, -14], [-460, -433], [-460, -960], [-460, -1500]], h: [130, 150, 90, 70, 60, 55, 50, 45] },
  { pts: [[-460, -1290], [-150, -1300], [200, -1290], [500, -1270], [760, -1260]], h: [55, 70, 60, 50, 45] },
  { pts: [[760, -1260], [1380, -1250], [1390, -600], [1380, 0], [1390, 600], [1380, 1250]], h: [45, 60, 80, 90, 60, 55] },
  { pts: [[1380, 1250], [1200, 1600], [800, 1600], [560, 1590], [300, 1500], [-150, 1420]], h: [55, 70, 120, 150, 70, 45] },
];
const CENTER = [250, 0];
const SEG = 60;
const TEX_W = 600;

function texture() {
  const W = 2048, H = 256;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d")!;
  const img = g.createImageData(W, H);
  const d = img.data;
  let seed = 11;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let x0 = 0; x0 < W; ) {
    const w = Math.min(W - x0, 10 + Math.floor(r() * 30));
    const tall = r() < 0.12;
    const h = Math.floor(tall ? 150 + r() * 100 : 25 + r() * r() * 130);
    const px = 3 + Math.floor(r() * 2), py = 5 + Math.floor(r() * 2);
    const crown = tall && r() < 0.5 ? Math.floor(w * 0.3) : 0;
    for (let x = x0; x < x0 + w; x++) {
      const inset = Math.min(x - x0, x0 + w - 1 - x);
      const top = h + (crown && inset >= crown ? 12 : 0);
      for (let y = 0; y < Math.min(top, H); y++) {
        const i = ((H - 1 - y) * W + x) * 4;
        const lx = x - x0 - 1, ly = y - 2;
        const win = lx >= 0 && x < x0 + w - 1 && ly >= 0 && y < h - 2 && lx % px < 2 && ly % py < 3;
        d[i] = 255;
        d[i + 1] = win ? 255 : 0;
        d[i + 2] = win ? Math.floor(((Math.floor(lx / px) * 73 + Math.floor(ly / py) * 151 + x0 * 7) % 256 + r() * 40) % 256) : 0;
        d[i + 3] = 255;
      }
    }
    x0 += w + (r() < 0.25 ? 2 + Math.floor(r() * 6) : 0);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

function geometry() {
  const pos: number[] = [], uv: number[] = [];
  const quad = (ax: number, az: number, bx: number, bz: number, h: number, u0: number, u1: number) => {
    const nx = bz - az, nz = -(bx - ax);
    const mx = (ax + bx) / 2 - CENTER[0], mz = (az + bz) / 2 - CENTER[1];
    if (nx * mx + nz * mz > 0) [ax, az, bx, bz, u0, u1] = [bx, bz, ax, az, u1, u0];
    const P = [[ax, -2, az, u0, 0], [bx, -2, bz, u1, 0], [bx, h, bz, u1, 1], [ax, h, az, u0, 1]];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(P[i][0], P[i][1], P[i][2]);
      uv.push(P[i][3], P[i][4]);
    }
  };
  CARDS.forEach((card, ci) => {
    for (const layer of [0, 1]) {
      let u = ci * 0.37 + layer * 0.61;
      const off = layer * 130;
      for (let i = 0; i + 1 < card.pts.length; i++) {
        let [ax, az] = card.pts[i], [bx, bz] = card.pts[i + 1];
        if (off) {
          const pa = push(ax, az, off), pb = push(bx, bz, off);
          [ax, az, bx, bz] = [pa[0], pa[1], pb[0], pb[1]];
        }
        const L = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.round(L / SEG));
        for (let k = 0; k < n; k++) {
          const t0 = k / n, t1 = (k + 1) / n;
          const h = (card.h[i] + (card.h[i + 1] - card.h[i]) * (t0 + t1) * 0.5) * (layer ? 1.3 : 1);
          const du = (L / n) / TEX_W;
          quad(ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1, h, u, u + du);
          u += du;
        }
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

function push(x: number, z: number, d: number): [number, number] {
  const dx = x - CENTER[0], dz = z - CENTER[1], l = Math.hypot(dx, dz) || 1;
  return [x + (dx / l) * d, z + (dz / l) * d];
}

export function skyline() {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null } }]),
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uNight;
      varying vec2 vUv;
      #include <fog_pars_fragment>
      void main() {
        vec4 t = texture2D(uMap, vUv);
        if (t.a < 0.5) discard;
        float n = smoothstep(0.3, 0.9, uNight);
        vec3 c = mix(vec3(0.3, 0.33, 0.38), vec3(0.025, 0.03, 0.045), n) * (0.85 + 0.15 * vUv.y);
        float lit = t.g * step(1.0 - mix(0.05, 0.42, n), t.b);
        vec3 wc = fract(t.b * 7.31) < 0.6 ? vec3(1.0, 0.74, 0.44) : vec3(0.62, 0.76, 1.0);
        c = mix(c, wc * mix(0.35, 3.2, n), lit * mix(0.25, 1.0, n));
        gl_FragColor = vec4(c, 1.0);
        #include <fog_fragment>
      }`,
    fog: true,
    side: THREE.DoubleSide,
  });
  m.uniforms.uMap.value = texture();
  m.uniforms.uNight = SKY.night;
  const mesh = new THREE.Mesh(geometry(), m);
  mesh.matrixAutoUpdate = false;
  return mesh;
}
