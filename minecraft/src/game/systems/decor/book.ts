import * as THREE from "three";
import type { GameCtx } from "../../contracts";
import { brightnessAt } from "../../entities/render";
import { noiseTile, pixBoxes, repeatTexture } from "../../entities/decor/pix-box";

interface Book {
  key: number;
  x: number;
  y: number;
  z: number;
  time: number;
  flip: number;
  oFlip: number;
  flipT: number;
  flipA: number;
  open: number;
  oOpen: number;
  rot: number;
  oRot: number;
  tRot: number;
  root: THREE.Group;
  parts: THREE.Object3D[];
  cover: THREE.MeshBasicMaterial;
  page: THREE.MeshBasicMaterial;
}

const TAU = Math.PI * 2;
const wrap = (a: number) => {
  while (a >= Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};
const frac = (v: number) => v - Math.floor(v);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

let art: { lidL: THREE.BufferGeometry; lid: THREE.BufferGeometry; seam: THREE.BufferGeometry; pages: THREE.BufferGeometry; leaf: THREE.BufferGeometry; cover: THREE.Texture; page: THREE.Texture } | null = null;

function pageTile() {
  const px = noiseTile(3, [236, 226, 196], 0.08);
  for (let y = 3; y < 16; y += 3) for (let x = 2; x < 14; x++) {
    const o = (y * 16 + x) * 4;
    px[o] = 150;
    px[o + 1] = 140;
    px[o + 2] = 120;
  }
  return px;
}

function getArt() {
  if (!art) {
    art = {
      lidL: pixBoxes([[-6, -5, -0.1, 0, 5, 0.1]]),
      lid: pixBoxes([[0, -5, -0.1, 6, 5, 0.1]]),
      seam: pixBoxes([[-1, -5, -0.1, 1, 5, 0.1]]),
      pages: pixBoxes([[0, -4, -0.5, 5, 4, 0.5]]),
      leaf: pixBoxes([[0, -4, -0.05, 5, 4, 0.05]]),
      cover: repeatTexture(noiseTile(11, [96, 56, 30], 0.3)),
      page: repeatTexture(pageTile()),
    };
  }
  return art;
}

export function createBooks(ctx: GameCtx) {
  const books = new Map<number, Book>();
  const scene = ctx.renderer.scene;
  let lastTick = performance.now();

  function add(key: number, x: number, y: number, z: number) {
    if (books.has(key)) return;
    const a = getArt();
    const cover = new THREE.MeshBasicMaterial({ map: a.cover, side: THREE.DoubleSide });
    const page = new THREE.MeshBasicMaterial({ map: a.page });
    const root = new THREE.Group();
    const tilt = new THREE.Group();
    tilt.rotation.z = (80 * Math.PI) / 180;
    root.add(tilt);
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, px: number, pz: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(px / 16, 0, pz / 16);
      const child = new THREE.Mesh(g, m);
      pivot.add(child);
      tilt.add(pivot);
      return pivot;
    };
    const leftLid = mesh(a.lidL, cover, 0, -1);
    const rightLid = mesh(a.lid, cover, 0, 1);
    const seam = mesh(a.seam, cover, 0, 0);
    seam.rotation.y = Math.PI / 2;
    const leftPages = mesh(a.pages, page, 0, 0);
    leftPages.children[0].position.z = -0.49 / 16;
    const rightPages = mesh(a.pages, page, 0, 0);
    rightPages.children[0].position.z = 0.49 / 16;
    const flip1 = mesh(a.leaf, page, 0, 0);
    const flip2 = mesh(a.leaf, page, 0, 0);
    scene.add(root);
    const r = Math.random;
    books.set(key, {
      key, x, y, z, time: Math.floor(r() * 1000), flip: 0, oFlip: 0, flipT: 0, flipA: 0, open: 0, oOpen: 0, rot: 0, oRot: 0, tRot: r() * TAU,
      root, parts: [leftLid, rightLid, leftPages, rightPages, flip1, flip2], cover, page,
    });
  }

  function remove(key: number) {
    const b = books.get(key);
    if (!b) return;
    scene.remove(b.root);
    b.cover.dispose();
    b.page.dispose();
    books.delete(key);
  }

  function tick(c: GameCtx) {
    lastTick = performance.now();
    const p = c.player.body.pos;
    for (const b of books.values()) {
      b.oOpen = b.open;
      b.oRot = b.rot;
      const dx = p.x - (b.x + 0.5), dy = p.y - (b.y + 0.5), dz = p.z - (b.z + 0.5);
      if (dx * dx + dy * dy + dz * dz < 9 && c.player.gameMode !== "spectator") {
        b.tRot = Math.atan2(dz, dx);
        b.open += 0.1;
        if (b.open < 0.5 || Math.floor(c.random() * 40) === 0) {
          const f1 = b.flipT;
          do b.flipT += Math.floor(c.random() * 4) - Math.floor(c.random() * 4);
          while (f1 === b.flipT);
        }
      } else {
        b.tRot += 0.02;
        b.open -= 0.1;
      }
      b.rot = wrap(b.rot);
      b.tRot = wrap(b.tRot);
      b.rot += wrap(b.tRot - b.rot) * 0.4;
      b.open = clamp01(b.open);
      b.time++;
      b.oFlip = b.flip;
      const f = Math.max(-0.2, Math.min(0.2, (b.flipT - b.flip) * 0.4));
      b.flipA += (f - b.flipA) * 0.9;
      b.flip += b.flipA;
    }
  }

  let frameNo = 0;
  function frame(c: GameCtx) {
    const pt = Math.min(1, (performance.now() - lastTick) / 50);
    const shade = frameNo++ % 10 === 0;
    for (const b of books.values()) {
      const t = b.time + pt;
      b.root.position.set(b.x + 0.5, b.y + 0.75 + 0.1 + Math.sin(t * 0.1) * 0.01, b.z + 0.5);
      b.root.rotation.y = -(b.oRot + wrap(b.rot - b.oRot) * pt);
      const fl = b.oFlip + (b.flip - b.oFlip) * pt;
      const p1 = clamp01(frac(fl + 0.25) * 1.6 - 0.3);
      const p2 = clamp01(frac(fl + 0.75) * 1.6 - 0.3);
      const open = b.oOpen + (b.open - b.oOpen) * pt;
      const f = (Math.sin(t * 0.02) * 0.1 + 1.25) * open;
      const [leftLid, rightLid, leftPages, rightPages, flip1, flip2] = b.parts;
      leftLid.rotation.y = Math.PI + f;
      rightLid.rotation.y = -f;
      leftPages.rotation.y = f;
      rightPages.rotation.y = -f;
      flip1.rotation.y = f - f * 2 * p1;
      flip2.rotation.y = f - f * 2 * p2;
      const s = Math.sin(f) / 16;
      leftPages.position.x = s;
      rightPages.position.x = s;
      flip1.position.x = s;
      flip2.position.x = s;
      if (shade) {
        const br = brightnessAt(c, b.x + 0.5, b.y + 1, b.z + 0.5);
        b.cover.color.setScalar(br);
        b.page.color.setScalar(br);
      }
    }
  }

  return {
    add,
    remove,
    has: (key: number) => books.has(key),
    keys: () => books.keys(),
    tick,
    frame,
    dispose() {
      for (const k of [...books.keys()]) remove(k);
    },
  };
}

export type Books = ReturnType<typeof createBooks>;
