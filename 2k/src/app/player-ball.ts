import * as THREE from "three";
import { COURT } from "./contracts";

// The game ball: pebbled leather with black channels, equirect canvas textures (color + bump).

export interface BallMesh {
  mesh: THREE.Mesh;
  geo: THREE.SphereGeometry;
  mat: THREE.MeshStandardMaterial;
  dispose(): void;
}

function seamPaths(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const lw = Math.max(2, w / 220);
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  // two perpendicular great circles: the equator and a meridian pair
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  for (const u of [0.25, 0.75]) {
    ctx.moveTo(u * w, 0);
    ctx.lineTo(u * w, h);
  }
  ctx.stroke();
  // the two curved channels hugging the poles
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    for (let i = 0; i <= 160; i++) {
      const phi = (i / 160) * Math.PI * 2;
      const lat = sgn * (0.72 - 0.42 * Math.cos(2 * phi));
      const x = (phi / (Math.PI * 2)) * w;
      const y = (0.5 - lat / Math.PI) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

export function createBallMesh(size: number): BallMesh {
  const w = Math.max(256, Math.min(1024, size));
  const h = w / 2;
  const col = document.createElement("canvas");
  col.width = w;
  col.height = h;
  const c = col.getContext("2d")!;
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#b24a1c");
  g.addColorStop(0.5, "#c8582a");
  g.addColorStop(1, "#a9441a");
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  // pebble speckle
  let s = 1234567;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < w * h * 0.08; i++) {
    c.fillStyle = rnd() < 0.5 ? "rgba(70,20,6,0.18)" : "rgba(255,170,120,0.08)";
    c.fillRect(rnd() * w, rnd() * h, 1.2, 1.2);
  }
  c.strokeStyle = "#1a0f0a";
  seamPaths(c, w, h);
  // small brand stamp between channels
  c.save();
  c.translate(w * 0.375, h * 0.5 - h * 0.12);
  c.scale(-1, 1);
  c.font = `800 ${Math.round(h * 0.06)}px "Arial Black", Arial, sans-serif`;
  c.textAlign = "center";
  c.fillStyle = "rgba(25,12,6,0.75)";
  c.fillText("HOOPS", 0, 0);
  c.font = `700 ${Math.round(h * 0.03)}px Arial, sans-serif`;
  c.fillText("OFFICIAL GAME BALL", 0, h * 0.045);
  c.restore();

  const bump = document.createElement("canvas");
  bump.width = w;
  bump.height = h;
  const b = bump.getContext("2d")!;
  b.fillStyle = "#808080";
  b.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h * 0.12; i++) {
    const v = 110 + Math.floor(rnd() * 70);
    b.fillStyle = `rgb(${v},${v},${v})`;
    b.beginPath();
    b.arc(rnd() * w, rnd() * h, 0.9 + rnd() * 0.8, 0, Math.PI * 2);
    b.fill();
  }
  b.strokeStyle = "#202020";
  seamPaths(b, w, h);

  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const bumpMap = new THREE.CanvasTexture(bump);
  const geo = new THREE.SphereGeometry(COURT.ballR, 40, 28);
  const mat = new THREE.MeshStandardMaterial({ map, bumpMap, bumpScale: 1.2, roughness: 0.72, metalness: 0, envMapIntensity: 0.6 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.name = "ball";
  return {
    mesh, geo, mat,
    dispose() {
      geo.dispose();
      mat.dispose();
      map.dispose();
      bumpMap.dispose();
    },
  };
}
