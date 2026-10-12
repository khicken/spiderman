import * as THREE from "three";

// Minecraft-style cuboid parts on one skin canvas. Units are model pixels (16 px = 1 block).
export interface PartSpec {
  name: string;
  parent?: string;
  pivot: [number, number, number]; // joint position, relative to the parent pivot
  box: [number, number, number, number, number, number]; // x, y, z offset from pivot, then w, h, d
  uv: [number, number]; // top-left of the vanilla cuboid unwrap on the skin
  inflate?: number;
  mirror?: boolean;
}

export interface BoxModel {
  root: THREE.Group;
  parts: Record<string, THREE.Object3D>;
  material: THREE.MeshLambertMaterial;
  dispose(): void;
}

const PX = 1 / 16;

// Vanilla unwrap for a w x h x d cuboid at (u, v):
// top row: [d] top(w) bottom(w); side row: right(d) front(w) left(d) back(w).
function cuboid(w: number, h: number, d: number, u: number, v: number, tw: number, th: number, inflate: number, mirror: boolean) {
  const g = new THREE.BoxGeometry((w + inflate * 2) * PX, (h + inflate * 2) * PX, (d + inflate * 2) * PX);
  const rect = (x: number, y: number, rw: number, rh: number) => [x / tw, 1 - y / th, (x + rw) / tw, 1 - (y + rh) / th];
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z. Model front faces -z after the root turns 180 degrees.
  const faces = [
    rect(u, v + d, d, h), // +x: left side of the mob
    rect(u + d + w, v + d, d, h), // -x: right side
    rect(u + d, v, w, d), // +y top
    rect(u + d + w, v, w, d), // -y bottom
    rect(u + d + w + d, v + d, w, h), // +z back
    rect(u + d, v + d, w, h), // -z front
  ];
  if (mirror) [faces[0], faces[1]] = [faces[1], faces[0]];
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let f = 0; f < 6; f++) {
    let [u0, v0, u1, v1] = faces[f];
    if (mirror) [u0, u1] = [u1, u0];
    const i = f * 4;
    uv.setXY(i, u0, v0);
    uv.setXY(i + 1, u1, v0);
    uv.setXY(i + 2, u0, v1);
    uv.setXY(i + 3, u1, v1);
  }
  uv.needsUpdate = true;
  return g;
}

export function boxModel(skin: HTMLCanvasElement | OffscreenCanvas, specs: PartSpec[]): BoxModel {
  const texture = new THREE.CanvasTexture(skin as HTMLCanvasElement);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.1, side: THREE.FrontSide });
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.rotation.y = Math.PI;
  root.add(body);
  const parts: Record<string, THREE.Object3D> = {};
  const geos: THREE.BufferGeometry[] = [];
  for (const s of specs) {
    const joint = new THREE.Group();
    joint.name = s.name;
    joint.position.set(s.pivot[0] * PX, s.pivot[1] * PX, s.pivot[2] * PX);
    const [x, y, z, w, h, d] = s.box;
    const g = cuboid(w, h, d, s.uv[0], s.uv[1], skin.width, skin.height, s.inflate ?? 0, s.mirror ?? false);
    geos.push(g);
    const mesh = new THREE.Mesh(g, material);
    mesh.position.set((x + w / 2) * PX, (y + h / 2) * PX, (z + d / 2) * PX);
    joint.add(mesh);
    (s.parent ? parts[s.parent] : body).add(joint);
    parts[s.name] = joint;
  }
  return {
    root,
    parts,
    material,
    dispose() {
      for (const g of geos) g.dispose();
      texture.dispose();
      material.dispose();
    },
  };
}

export function makeSkin(w: number, h: number): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } {
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  return { canvas, ctx };
}
