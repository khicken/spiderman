import * as THREE from "three";
import { Bucket, UNIT, beam, box, cyl } from "./city-kit";
import { floors, mass, type Block, type Ctx } from "./city-build";
import { STYLE } from "./city-facades";
import { SKY } from "./sky-state";

let signs = new Bucket();
const PEPSI = [0, 0.5, 1, 1] as const;
const DOMINO = [0, 0, 1, 0.5] as const;

function signFace(x: number, y0: number, z: number, w: number, h: number, uv: readonly [number, number, number, number]) {
  signs.quad(x, y0, z - w / 2, x, y0, z + w / 2, x, y0 + h, z + w / 2, x, y0 + h, z - w / 2, uv, 0xffffff);
}

function signFrame(c: Ctx, x: number, y0: number, z: number, w: number, h: number) {
  for (let a = -w / 2; a <= w / 2 + 0.01; a += w / 6) {
    box(c.solid, x + 0.8, y0 / 2 + h / 2, z + a, 0.4, y0 + h, 0.4, 0x2a2c30);
    beam(c.small, x + 0.8, y0, z + a, x + 0.8, y0 + h, z + a + w / 6, 0.12, 0x2a2c30);
  }
  box(c.solid, x + 0.8, y0 - 0.2, z, 0.6, 0.4, w + 0.6, 0x2a2c30);
  box(c.solid, x + 0.8, y0 + h + 0.2, z, 0.6, 0.4, w + 0.6, 0x2a2c30);
  c.boxes.push({ minX: x + 0.3, maxX: x + 1.3, minZ: z - w / 2, maxZ: z + w / 2, maxY: y0 + h + 0.4, minY: y0 > 1 ? y0 - 0.4 : undefined });
}

function gantry(c: Ctx, x: number, z: number) {
  const col = 0x1d1f22;
  for (const [dx, dz] of [[0, -3], [0, 3], [7, -3], [7, 3]]) box(c.solid, x + dx, 9, z + dz, 0.9, 18, 0.9, col);
  box(c.solid, x + 3.5, 18.5, z, 9, 2.2, 7.4, col);
  box(c.solid, x - 3, 17.5, z, 6, 1.2, 4, col);
  for (const dz of [-3, 3]) beam(c.small, x, 2, z + dz, x + 7, 16, z + dz, 0.25, col);
  c.boxes.push({ minX: x - 6, maxX: x + 8, minZ: z - 3.7, maxZ: z + 3.7, minY: 16.8, maxY: 19.6 });
  for (const [dx, dz] of [[0, -3], [0, 3], [7, -3], [7, 3]]) c.boxes.push({ minX: x + dx - 0.45, maxX: x + dx + 0.45, minZ: z + dz - 0.45, maxZ: z + dz + 0.45, maxY: 18 });
}

/** Gantry Plaza with the Pepsi-Cola sign, facing Manhattan. */
export function pepsiSign(c: Ctx, b: Block) {
  const x = b.x0 + 3, z = b.z0 + Math.min(18, (b.z1 - b.z0) / 2);
  signFrame(c, x, 9, z, 32, 9);
  signFace(x - 0.05, 9, z, 32, 9, PEPSI);
  for (const k of [0.75, 0.92]) if (b.z0 + (b.z1 - b.z0) * k + 4 < b.z1) gantry(c, b.x0 + 2, b.z0 + (b.z1 - b.z0) * k);
  c.landmarks.push({ name: "Pepsi-Cola Sign", pos: new THREE.Vector3(x, 13, z) });
}

/** The Domino refinery with its roof sign, facing Manhattan. */
export function dominoSign(c: Ctx, b: Block) {
  const top = floors(STYLE.tanbrick, 0, 9);
  mass(c, b.x0 + 2, b.x1 - 2, b.z0 + 3, b.z1 - 3, 0, top, { style: STYLE.tanbrick, parapet: 0x6f5a48 });
  mass(c, b.x0 + 2, b.x0 + 14, b.z0 + 3, b.z0 + 16, top, top + 12, { style: STYLE.brick, parapet: 0x6f5a48 });
  cyl(c.solid, UNIT.cyl12, b.x1 - 7, 0, b.z1 - 8, 2.2, top + 26, 0x7a4a36);
  c.boxes.push({ minX: b.x1 - 8.6, maxX: b.x1 - 5.4, minZ: b.z1 - 9.6, maxZ: b.z1 - 6.4, maxY: top + 26 });
  const z = (b.z0 + 16 + b.z1 - 3) / 2, w = Math.min(30, b.z1 - b.z0 - 22);
  signFrame(c, b.x0 + 3, top + 1.5, z, w, 5.5);
  signFace(b.x0 + 2.95, top + 1.5, z, w, 5.5, DOMINO);
}

function signTexture() {
  const cv = document.createElement("canvas");
  cv.width = 1024;
  cv.height = 512;
  const g = cv.getContext("2d")!;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#ff2a1a";
  g.font = "italic bold 190px Georgia, serif";
  g.fillText("Pepsi-Cola", 512, 140, 990);
  g.fillStyle = "#ffc82a";
  g.font = "bold 150px Helvetica, Arial, sans-serif";
  g.fillText("DOMINO SUGARS", 512, 384, 1000);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** The lit letters of both signs. Call after pepsiSign and dominoSign. */
export function signMesh() {
  const m = new THREE.MeshBasicMaterial({ map: signTexture(), alphaTest: 0.35, toneMapped: false });
  m.onBeforeCompile = (s) => {
    s.uniforms.uNight = SKY.night;
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= mix(0.75, 2.6, smoothstep(0.3, 0.8, uNight));");
  };
  m.customProgramCacheKey = () => "riversign";
  const g = signs.build();
  signs = new Bucket();
  return new THREE.Mesh(g, m);
}
