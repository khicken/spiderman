import * as THREE from "three";
import type { ChunkUniforms, GameCtx } from "../contracts";
import { createArmorLayer, type ArmorLayer } from "../entities/armor-layer";
import { brightnessAt } from "../entities/render";
import { createHand, createHeldSlot, type HandView } from "../player/hand";
import { createItemMeshes, type ItemMeshes } from "../player/item-mesh";
import { createPlayerModel, type PlayerModel } from "../player/model";
import { rasterText } from "../ui/font";
import { F, type PlayerSnap } from "./protocol";
import { createCape, paintLook, type Cape, type Look } from "./skins";

interface Avatar {
  snap: PlayerSnap;
  model: PlayerModel;
  hand: HandView;
  off: ReturnType<typeof createHeldSlot>;
  armor: ArmorLayer;
  tag: NameTag;
  pos: THREE.Vector3;
  yaw: number;
  bodyYaw: number;
  pitch: number;
  walk: number;
  walkSpeed: number;
  swing: number;
  lastSw: number;
  hurt: number;
  cape: Cape | null;
}

interface NameTag {
  group: THREE.Group;
  through: THREE.Sprite;
  front: THREE.Sprite;
}

// Vanilla renderNameTag: a see-through pass (black box at 25% alpha, text at 0x20FFFFFF) drawn over blocks,
// then white text that blocks hide. Sneaking draws only the first pass, depth tested.
function nameTag(name: string): NameTag {
  const r = rasterText(name, 0xffffff, false);
  const w = r.width + 2, h = r.height + 1;
  const sprite = (box: boolean, alpha: number, depthTest: boolean, order: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d")!;
    if (box) {
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.fillRect(0, r.top, w, h - r.top);
    }
    const text = new Uint8ClampedArray(r.data);
    for (let i = 3; i < text.length; i += 4) text[i] = Math.round(text[i] * alpha);
    const t = document.createElement("canvas");
    t.width = r.width;
    t.height = r.height;
    t.getContext("2d")!.putImageData(new ImageData(text, r.width, r.height), 0, 0);
    g.drawImage(t, 1, 1);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest, fog: false, toneMapped: false }));
    const s = 0.025;
    sp.scale.set(w * s, h * s, 1);
    // Glyphs taller than the line poke out above the box; the box stays where a plain name sits.
    sp.center.set(0.5, (h - r.top) / 2 / h);
    sp.renderOrder = order;
    return sp;
  };
  const group = new THREE.Group();
  const through = sprite(true, 0x20 / 255, false, 10);
  const front = sprite(false, 1, true, 11);
  group.add(through, front);
  return { group, through, front };
}

function sneakTag(t: NameTag, sneak: boolean) {
  const m = t.through.material as THREE.SpriteMaterial;
  if (m.depthTest !== sneak) {
    m.depthTest = sneak;
    m.needsUpdate = true;
  }
  t.front.visible = !sneak;
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
  look(id: number, l: Look): void;
  list(): { id: number; name: string; x: number; y: number; z: number; look: Look | null; cape: boolean }[];
  dispose(): void;
}

export function createAvatars(getCtx: () => GameCtx): Avatars {
  const all = new Map<number, Avatar>();
  const looks = new Map<number, Look>();
  let items: ItemMeshes | null = null;
  const meshes = () => (items ??= createItemMeshes(() => getCtx().renderer?.scene.userData.chunkUniforms as ChunkUniforms | undefined));

  function make(s: PlayerSnap): Avatar {
    const painted = paintLook(looks.get(s.id) ?? { kind: s.skin === 1 ? "alex" : "steve", slim: s.skin === 1 });
    const model = createPlayerModel(painted);
    void painted.ready.then(() => {
      model.skin.needsUpdate = true;
    });
    const cape = painted.cape ? createCape(model.model.root, painted.cape, painted.ready) : null;
    const hand = createHand(model, meshes());
    const off = createHeldSlot(meshes(), -1);
    const armor = createArmorLayer(model.model.parts, true);
    const tag = nameTag(s.name);
    tag.group.position.set(0, 2.1, 0);
    model.model.root.add(tag.group);
    getCtx().renderer.scene.add(model.model.root);
    model.model.root.userData.shadowRadius = 0.5;
    model.model.root.scale.setScalar(0.9375);
    return { snap: s, model, hand, off, armor, tag, pos: new THREE.Vector3(s.x, s.y, s.z), yaw: s.yaw, bodyYaw: s.yaw, pitch: s.pitch, walk: 0, walkSpeed: 0, swing: 0, lastSw: s.sw, hurt: 0, cape };
  }

  function free(a: Avatar) {
    a.model.model.root.removeFromParent();
    a.tag.group.removeFromParent();
    for (const sp of [a.tag.through, a.tag.front]) {
      const m = sp.material as THREE.SpriteMaterial;
      m.map?.dispose();
      m.dispose();
    }
    a.armor.dispose();
    a.cape?.dispose();
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
        if (a && (a.snap.name !== s.name || a.snap.skin !== s.skin)) {
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
    list: () => [...all.values()].map((a) => ({ id: a.snap.id, name: a.snap.name, x: a.pos.x, y: a.pos.y, z: a.pos.z, look: looks.get(a.snap.id) ?? null, cape: !!a.cape })),
    look(id, l) {
      looks.set(id, l);
      const a = all.get(id);
      if (!a) return;
      free(a);
      all.delete(id);
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
        a.tag.group.position.y = sleep ? 0.3 : sneak ? 1.95 : 2.1;
        sneakTag(a.tag, sneak);
        const light = brightnessAt(ctx, a.pos.x, a.pos.y + 1, a.pos.z);
        const hurt = a.hurt > 0;
        a.model.setLight(light, hurt);
        const eq = s.eq;
        const st = (n: string | null | undefined) => (n ? { item: n, count: 1 } : null);
        a.armor.set({ head: st(eq.armor[0]), chest: eq.armor[1] === "elytra" ? null : st(eq.armor[1]), legs: st(eq.armor[2]), feet: st(eq.armor[3]) });
        a.cape?.update({ x: a.pos.x, y: a.pos.y, z: a.pos.z, bodyYaw: a.bodyYaw, onGround: (s.f & F.ground) !== 0, sneaking: sneak, hidden: dead || sleep || eq.armor[1] === "elytra" }, dt);
        a.cape?.setLight(light);
        a.armor.setLight(light, hurt);
        a.hand.setThirdPerson(a.model.model.parts.right_arm, st(eq.held));
        a.off.set(a.model.model.parts.left_arm, st(eq.off));
      }
    },
    dispose() {
      for (const a of all.values()) free(a);
      all.clear();
      looks.clear();
      items?.dispose();
      items = null;
    },
  };
}
