import * as THREE from "three";
import type { ChunkUniforms, GameCtx } from "../contracts";
import { createArmorLayer, type ArmorLayer } from "../entities/armor-layer";
import { brightnessAt } from "../entities/render";
import { createHand, createHeldSlot, type HandView } from "../player/hand";
import { createItemMeshes, type ItemMeshes } from "../player/item-mesh";
import { createPlayerModel, type PlayerModel } from "../player/model";
import { rasterText } from "../ui/font";
import { F, type PlayerSnap } from "./protocol";

interface Avatar {
  snap: PlayerSnap;
  model: PlayerModel;
  hand: HandView;
  off: ReturnType<typeof createHeldSlot>;
  armor: ArmorLayer;
  tag: THREE.Sprite;
  tagTex: THREE.Texture;
  pos: THREE.Vector3;
  yaw: number;
  bodyYaw: number;
  pitch: number;
  walk: number;
  walkSpeed: number;
  swing: number;
  lastSw: number;
  hurt: number;
}

const ALEX = { hair: "#e3913a", hairDark: "#c4762a", shirt: "#5f9e42", shirtDark: "#4d8636", pants: "#6b4a2f", pantsDark: "#5a3d26", eye: "#3a7d3a" };

// Alex: the default slim skin colors painted over the Steve layout.
function paintAlex(skin: THREE.Texture) {
  const img = skin.image as HTMLCanvasElement | OffscreenCanvas;
  const g = img.getContext("2d") as CanvasRenderingContext2D | null;
  if (!g) return;
  const rect = (c: string, x: number, y: number, w: number, h: number) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  rect(ALEX.hair, 8, 0, 8, 8);
  rect(ALEX.hair, 24, 8, 8, 8);
  rect(ALEX.hair, 0, 8, 8, 6);
  rect(ALEX.hair, 16, 8, 8, 6);
  rect(ALEX.hair, 8, 8, 8, 2);
  rect(ALEX.hairDark, 8, 8, 2, 4);
  rect(ALEX.hairDark, 14, 8, 2, 4);
  rect(ALEX.eye, 10, 12, 1, 1);
  rect(ALEX.eye, 13, 12, 1, 1);
  rect(ALEX.shirt, 20, 16, 16, 4);
  rect(ALEX.shirt, 16, 20, 24, 12);
  rect(ALEX.shirtDark, 16, 30, 24, 2);
  for (const [u, v] of [[40, 16], [32, 48]] as const) {
    rect(ALEX.shirt, u, v + 4, 16, 4);
    rect(ALEX.shirt, u + 4, v, 4, 4);
  }
  for (const [u, v] of [[0, 16], [16, 48]] as const) {
    rect(ALEX.pants, u, v + 4, 16, 9);
    rect(ALEX.pantsDark, u, v + 12, 16, 1);
  }
  skin.needsUpdate = true;
}

function nameTagSprite(name: string): { sprite: THREE.Sprite; tex: THREE.Texture } {
  const r = rasterText(name, 0xffffff, false);
  const w = r.width + 2, h = r.height + 1;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "rgba(0,0,0,0.25)";
  g.fillRect(0, 0, w, h);
  g.putImageData(new ImageData(r.data as Uint8ClampedArray<ArrayBuffer>, r.width, r.height), 1, 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const s = 0.025;
  sprite.scale.set(w * s, h * s, 1);
  sprite.renderOrder = 10;
  return { sprite, tex };
}

const lerpAngle = (a: number, b: number, t: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

export interface Avatars {
  set(list: PlayerSnap[], self: number, dim: string): void;
  frame(dt: number): void;
  hurt(id: number): void;
  dispose(): void;
}

export function createAvatars(getCtx: () => GameCtx): Avatars {
  const all = new Map<number, Avatar>();
  let items: ItemMeshes | null = null;
  const meshes = () => (items ??= createItemMeshes(() => getCtx().renderer?.scene.userData.chunkUniforms as ChunkUniforms | undefined));

  function make(s: PlayerSnap): Avatar {
    const model = createPlayerModel({ slim: s.skin === 1 });
    if (s.skin === 1) paintAlex(model.skin);
    const hand = createHand(model, meshes());
    const off = createHeldSlot(meshes(), -1);
    const armor = createArmorLayer(model.model.parts, true);
    const { sprite, tex } = nameTagSprite(s.name);
    sprite.position.set(0, 2.1, 0);
    model.model.root.add(sprite);
    getCtx().renderer.scene.add(model.model.root);
    model.model.root.userData.shadowRadius = 0.5;
    return { snap: s, model, hand, off, armor, tag: sprite, tagTex: tex, pos: new THREE.Vector3(s.x, s.y, s.z), yaw: s.yaw, bodyYaw: s.yaw, pitch: s.pitch, walk: 0, walkSpeed: 0, swing: 0, lastSw: s.sw, hurt: 0 };
  }

  function free(a: Avatar) {
    a.model.model.root.removeFromParent();
    a.tag.removeFromParent();
    (a.tag.material as THREE.SpriteMaterial).dispose();
    a.tagTex.dispose();
    a.armor.dispose();
    a.hand.dispose();
    a.off.dispose();
    a.model.dispose();
  }

  return {
    set(list, self, dim) {
      const live = new Set<number>();
      for (const s of list) {
        if (s.id === self || s.dim !== dim) continue;
        live.add(s.id);
        let a = all.get(s.id);
        if (a && a.snap.name !== s.name) {
          free(a);
          all.delete(s.id);
          a = undefined;
        }
        if (!a) {
          a = make(s);
          all.set(s.id, a);
        }
        if (s.sw !== a.lastSw) {
          a.lastSw = s.sw;
          a.swing = 1;
        }
        if (Math.hypot(s.x - a.pos.x, s.y - a.pos.y, s.z - a.pos.z) > 8) a.pos.set(s.x, s.y, s.z);
        a.snap = s;
      }
      for (const [id, a] of all)
        if (!live.has(id)) {
          free(a);
          all.delete(id);
        }
    },
    hurt(id) {
      const a = all.get(id);
      if (a) a.hurt = 0.5;
    },
    frame(dt) {
      if (!all.size) return;
      const ctx = getCtx();
      const k = Math.min(1, dt * 14);
      for (const a of all.values()) {
        if (a.model.model.root.parent !== ctx.renderer.scene) ctx.renderer.scene.add(a.model.model.root);
        const s = a.snap;
        const ox = a.pos.x, oz = a.pos.z;
        a.pos.x += (s.x - a.pos.x) * k;
        a.pos.y += (s.y - a.pos.y) * k;
        a.pos.z += (s.z - a.pos.z) * k;
        a.yaw = lerpAngle(a.yaw, s.yaw, k);
        a.pitch += (s.pitch - a.pitch) * k;
        const moved = Math.hypot(a.pos.x - ox, a.pos.z - oz);
        const speed = dt > 0 ? Math.min(1, (moved / dt / 20) * 4) : 0;
        a.walkSpeed += (speed - a.walkSpeed) * Math.min(1, dt * 8);
        a.walk += a.walkSpeed * dt * 20;
        if (moved > 0.002) a.bodyYaw = lerpAngle(a.bodyYaw, Math.atan2(-(a.pos.x - ox), -(a.pos.z - oz)), Math.min(1, dt * 6));
        let d = a.yaw - a.bodyYaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        if (Math.abs(d) > 0.9) a.bodyYaw = a.yaw - Math.sign(d) * 0.9;
        a.swing = Math.max(0, a.swing - dt / 0.3);
        a.hurt = Math.max(0, a.hurt - dt);
        const sneak = (s.f & F.sneak) !== 0;
        const sleep = (s.f & F.sleep) !== 0;
        const dead = (s.f & F.dead) !== 0;
        const root = a.model.model.root;
        root.visible = !dead;
        root.position.set(a.pos.x, a.pos.y - (sneak ? 0.125 : 0), a.pos.z);
        a.model.pose({
          bodyYaw: a.bodyYaw,
          headYaw: a.yaw,
          pitch: a.pitch,
          limbSwing: a.walk,
          limbAmount: a.walkSpeed,
          attack: a.swing > 0 ? 1 - a.swing : 0,
          sneaking: sneak,
          usingRight: false,
          flying: (s.f & F.fly) !== 0,
          holdRight: !!s.eq.held,
          holdLeft: !!s.eq.off,
        });
        root.rotation.order = "YXZ";
        root.rotation.x = sleep ? -Math.PI / 2 : (s.f & F.swim) !== 0 ? Math.PI / 2 - a.pitch : 0;
        a.tag.position.y = sleep ? 0.3 : sneak ? 1.95 : 2.1;
        const light = brightnessAt(ctx, a.pos.x, a.pos.y + 1, a.pos.z);
        const hurt = a.hurt > 0;
        a.model.setLight(light, hurt);
        const eq = s.eq;
        const st = (n: string | null | undefined) => (n ? { item: n, count: 1 } : null);
        a.armor.set({ head: st(eq.armor[0]), chest: eq.armor[1] === "elytra" ? null : st(eq.armor[1]), legs: st(eq.armor[2]), feet: st(eq.armor[3]) });
        a.armor.setLight(light, hurt);
        a.hand.setThirdPerson(a.model.model.parts.right_arm, st(eq.held));
        a.off.set(a.model.model.parts.left_arm, st(eq.off));
      }
    },
    dispose() {
      for (const a of all.values()) free(a);
      all.clear();
      items?.dispose();
      items = null;
    },
  };
}
