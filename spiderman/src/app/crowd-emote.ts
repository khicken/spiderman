import * as THREE from "three";

export const EMO = { heart: 0, alert: 1, camera: 2, star: 3, note: 4 } as const;
const N = 5;
const CELL = 128;

function atlas() {
  const cv = document.createElement("canvas");
  cv.width = CELL * N;
  cv.height = CELL;
  const g = cv.getContext("2d")!;
  const badge = (i: number, fill: string) => {
    const x = i * CELL + CELL / 2;
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.beginPath();
    g.arc(x + 3, 68, 50, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = fill;
    g.beginPath();
    g.arc(x, 62, 50, 0, Math.PI * 2);
    g.moveTo(x - 14, 104);
    g.lineTo(x, 124);
    g.lineTo(x + 14, 104);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = "#ffffff";
    g.beginPath();
    g.arc(x, 62, 47, 0, Math.PI * 2);
    g.stroke();
    return x;
  };
  let x = badge(0, "#ff3b5c");
  g.fillStyle = "#fff";
  g.beginPath();
  g.moveTo(x, 88);
  g.bezierCurveTo(x - 40, 62, x - 26, 30, x, 46);
  g.bezierCurveTo(x + 26, 30, x + 40, 62, x, 88);
  g.fill();
  x = badge(1, "#ffb400");
  g.fillStyle = "#1a1a1a";
  g.fillRect(x - 7, 30, 14, 40);
  g.beginPath();
  g.arc(x, 84, 8, 0, Math.PI * 2);
  g.fill();
  x = badge(2, "#2f80ff");
  g.fillStyle = "#fff";
  g.fillRect(x - 28, 46, 56, 36);
  g.fillRect(x - 10, 39, 20, 9);
  g.fillStyle = "#2f80ff";
  g.beginPath();
  g.arc(x, 64, 12, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(x, 64, 6, 0, Math.PI * 2);
  g.fill();
  x = badge(3, "#ffcf33");
  g.fillStyle = "#fff";
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? 13 : 32;
    const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
    g.lineTo(x + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  g.fill();
  x = badge(4, "#20c48a");
  g.fillStyle = "#fff";
  g.fillRect(x + 6, 32, 7, 40);
  g.beginPath();
  g.ellipse(x - 2, 76, 13, 10, -0.4, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(x + 6, 32);
  g.quadraticCurveTo(x + 30, 38, x + 22, 56);
  g.quadraticCurveTo(x + 22, 44, x + 12, 44);
  g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Billboard reaction icons above heads: one instanced quad, an icon atlas, per-instance alpha. */
export function createEmotes(max: number) {
  const map = atlas();
  const mat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false, color: new THREE.Color(1.35, 1.35, 1.35) });
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 iIcon;\nvarying float vEmoA;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvMapUv.x = (vMapUv.x + iIcon.x) / " + N.toFixed(1) + ";\nvEmoA = iIcon.y;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vEmoA;")
      .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.a *= vEmoA;");
  };
  mat.customProgramCacheKey = () => "crowd-emote";
  const geo = new THREE.PlaneGeometry(0.42, 0.42);
  const icon = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
  icon.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("iIcon", icon);
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.count = 0;
  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  let n = 0;
  return {
    mesh,
    begin() {
      n = 0;
    },
    add(x: number, y: number, z: number, kind: number, age: number, life: number, q: THREE.Quaternion) {
      if (n >= max) return;
      const pop = age < 0.25 ? Math.sin((age / 0.25) * 2.2) * 1.18 : 1;
      const out = Math.min(1, (life - age) / 0.3);
      scl.setScalar(Math.max(0.01, pop * (0.6 + 0.4 * out)));
      pos.set(x, y + Math.min(age, 0.6) * 0.25 + Math.sin(age * 5) * 0.02, z);
      mesh.setMatrixAt(n, m4.compose(pos, q, scl));
      icon.setXY(n, kind, Math.max(0, out));
      n++;
    },
    end() {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      icon.needsUpdate = true;
    },
    dispose() {
      map.dispose();
    },
  };
}
