import * as THREE from "three";
import type { Entity, GameCtx, ItemStack, MobModel } from "../contracts";
import { mobDef } from "./registry";
import { daylight } from "./ai";
import { brightnessAt, shadeModel, shadeMaterials, nameTag, forgetModel } from "./render";
import { blockCube, blockStateOfItem, disposeCaches, isCubeItem, itemSpriteView, itemTexture } from "./block-cube";
import { orbIcon } from "./items";
import { extraView } from "./visuals-extra";
import { arrowGeometry, arrowMaterial, orbTextures, disposeMisc } from "./misc-art";

interface View {
  group: THREE.Group;
  model?: MobModel;
  tag?: { sprite: THREE.Sprite; dispose(): void };
  tagText?: string;
  key: string;
  seen: number;
  baby: boolean;
  bob: number;
  owned: (THREE.Material | THREE.BufferGeometry)[];
  update(e: Entity, pt: number, x: number, y: number, z: number): void;
}

const MOB_DIST = 80;
const MISC_DIST = 48;
const TAU = Math.PI * 2;

function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

function renderCount(n: number) {
  return n > 48 ? 5 : n > 32 ? 4 : n > 16 ? 3 : n > 1 ? 2 : 1;
}

function hash(n: number) {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  return (x >>> 0) / 4294967296;
}

export function createViews(getCtx: () => GameCtx) {
  const views = new Map<number, View>();
  let frameNo = 0;
  let day = 1;
  const camPos = new THREE.Vector3();

  function itemView(e: Entity, v: View) {
    const s = e.data.stack as ItemStack;
    const cube = isCubeItem(s.item);
    const n = renderCount(s.count);
    const spin = new THREE.Group();
    v.group.add(spin);
    const c = cube ? blockCube(blockStateOfItem(s.item)) : null;
    const sv = cube ? null : itemSpriteView(s.item);
    const cubeMats = c ? c.materials.map((m) => m.clone()) : [];
    const spriteMat = sv ? sv.material.clone() : null;
    v.owned.push(...cubeMats);
    if (spriteMat) v.owned.push(spriteMat);
    for (let i = 0; i < n; i++) {
      let m: THREE.Mesh;
      if (c) {
        m = new THREE.Mesh(c.geometry, cubeMats);
        m.scale.setScalar(0.25);
        if (i > 0) m.position.set((hash(e.id * 7 + i) - 0.5) * 0.15, (hash(e.id * 13 + i) - 0.5) * 0.15, (hash(e.id * 17 + i) - 0.5) * 0.15);
        m.position.y -= 0.125;
      } else {
        m = new THREE.Mesh(sv!.geometry, spriteMat!);
        m.scale.setScalar(0.5);
        if (i > 0) m.position.set((hash(e.id * 7 + i) - 0.5) * 0.15, (hash(e.id * 13 + i) - 0.5) * 0.15, -i * 0.09375 * 0.5);
      }
      spin.add(m);
    }
    v.key = `${s.item}:${n}`;
    v.update = (en, pt, x, y, z) => {
      const age = en.age + pt;
      const bob = Math.sin(age / 10 + v.bob) * 0.1 + 0.1;
      v.group.position.set(x, y + bob + (cube ? 0.125 : 0.25), z);
      spin.rotation.y = age / 20 + v.bob;
      shadeMaterials(spin, brightnessAt(getCtx(), x, y + 0.2, z, day), false);
    };
  }

  function orbView(e: Entity, v: View) {
    const tex = orbTextures()[orbIcon((e.data.value as number) ?? 1)];
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp.scale.setScalar(0.3);
    v.group.add(sp);
    v.owned.push(mat);
    v.update = (en, pt, x, y, z) => {
      v.group.position.set(x, y + 0.1, z);
      const t = (en.age + pt) / 2;
      mat.color.setRGB((Math.sin(t) + 1) * 0.5, 1, (Math.sin(t + 4.1887903) + 1) * 0.1);
    };
  }

  function arrowView(e: Entity, v: View) {
    const m = new THREE.Mesh(arrowGeometry(), arrowMaterial(e.type === "spectral_arrow"));
    v.group.add(m);
    v.group.rotation.order = "YXZ";
    v.update = (en, pt, x, y, z) => {
      v.group.position.set(x, y + 0.25, z);
      v.group.rotation.y = lerpAngle((en.data._pyaw as number) ?? en.yaw, en.yaw, pt);
      v.group.rotation.x = en.pitch;
      const shake = ((en.data.shake as number) ?? 0) - pt;
      v.group.rotation.z = shake > 0 ? -Math.sin(shake * 3) * shake * 0.05 : 0;
      shadeMaterials(v.group, brightnessAt(getCtx(), x, y, z, day), false);
    };
  }

  function thrownView(e: Entity, v: View) {
    const item = e.type === "fireball" || e.type === "small_fireball" ? "fire_charge" : e.type === "breeze_wind_charge" ? "wind_charge" : e.type === "potion" ? "splash_potion" : e.type;
    const mat = new THREE.SpriteMaterial({ map: itemTexture(item), alphaTest: 0.1 });
    const sp = new THREE.Sprite(mat);
    sp.scale.setScalar(e.type === "fireball" ? 1 : e.type === "small_fireball" ? 0.5 : 0.5);
    v.group.add(sp);
    v.owned.push(mat);
    const bright = e.type.includes("fireball");
    v.update = (_en, _pt, x, y, z) => {
      v.group.position.set(x, y + e.body.height / 2, z);
      const b = bright ? 1 : brightnessAt(getCtx(), x, y, z, day);
      mat.color.setScalar(b);
    };
  }

  function blockView(e: Entity, v: View) {
    const state = e.type === "tnt" ? blockStateOfItem("tnt") : ((e.data.state as number) ?? 0);
    const c = blockCube(state);
    const mats = c.materials.map((m) => m.clone());
    for (const m of mats) v.owned.push(m);
    const mesh = new THREE.Mesh(c.geometry, mats);
    mesh.position.y = 0;
    v.group.add(mesh);
    v.update = (en, pt, x, y, z) => {
      v.group.position.set(x, y, z);
      const br = brightnessAt(getCtx(), x, y + 0.5, z, day);
      shadeMaterials(v.group, br, false);
      if (en.type === "tnt") {
        const fuse = ((en.data.fuse as number) ?? 80) - pt + 1;
        let s = 1;
        if (fuse < 10) {
          let f = 1 - fuse / 10;
          f = Math.min(1, Math.max(0, f));
          f *= f;
          f *= f;
          s = 1 + f * 0.3;
        }
        mesh.scale.setScalar(s);
        mesh.position.set(0, -(s - 1) * 0.5, 0);
        if (Math.floor(fuse / 5) % 2 === 0) for (const m of mats) m.emissive.setScalar(0.8);
      }
    };
  }

  function mobView(e: Entity, v: View): boolean {
    const def = mobDef(e.type);
    if (!def) return false;
    let model: MobModel;
    try {
      model = def.createModel();
    } catch (err) {
      console.warn(`model ${e.type} failed`, err);
      return false;
    }
    v.model = model;
    const inner = new THREE.Group();
    inner.rotation.order = "YXZ";
    inner.add(model.root);
    v.group.add(inner);
    v.update = (en, pt, x, y, z) => {
      v.group.position.set(x, y, z);
      const yaw = lerpAngle((en.data._pyaw as number) ?? en.yaw, en.yaw, pt);
      const death = en.dead ? Math.min(1, Math.sqrt(Math.max(0, (((en.data._death as number) ?? 0) + pt - 1) / 20) * 1.6)) : 0;
      inner.rotation.set(0, yaw + Math.PI, death * (Math.PI / 2));
      const baby = ((en.data.grow as number) ?? 0) < 0;
      if (baby !== v.baby) {
        v.baby = baby;
        inner.scale.setScalar(baby ? 0.5 : 1);
      }
      const ws = (en.data._ws as number) ?? 0;
      const wso = (en.data._wso as number) ?? ws;
      const walk = Math.min(1, wso + (ws - wso) * pt);
      const phase = ((en.data._wp as number) ?? 0) - ws * (1 - pt);
      const hy = en.headYaw;
      en.headYaw = lerpAngle((en.data._phy as number) ?? hy, hy, pt) - yaw + en.yaw;
      model.animate(en, pt, walk, phase);
      en.headYaw = hy;
      shadeModel(model, getCtx(), en, day);
      const flash = (en.data.flash as number) ?? 0;
      if (flash > 0) model.root.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
        if (m && "emissive" in m) m.emissive.addScalar(flash);
      });
      updateTag(en, v, def.height);
    };
    return true;
  }

  function updateTag(e: Entity, v: View, h: number) {
    const text = e.data.name as string | undefined;
    if (text !== v.tagText) {
      if (v.tag) {
        v.group.remove(v.tag.sprite);
        v.tag.dispose();
        v.tag = undefined;
      }
      v.tagText = text;
      if (text) {
        v.tag = nameTag(text);
        v.group.add(v.tag.sprite);
      }
    }
    if (v.tag) v.tag.sprite.position.y = (v.baby ? h * 0.5 : h) + 0.5;
  }

  function create(e: Entity, scene: THREE.Scene): View | null {
    const v: View = { group: new THREE.Group(), key: "", seen: 0, baby: false, bob: hash(e.id) * TAU, owned: [], update: () => {} };
    if (mobDef(e.type)) {
      if (!mobView(e, v)) return null;
    } else if (e.type === "item") itemView(e, v);
    else if (e.type === "xp_orb") orbView(e, v);
    else if (e.type === "arrow" || e.type === "spectral_arrow") arrowView(e, v);
    else if (e.type === "tnt" || e.type === "falling_block") blockView(e, v);
    else if (e.type === "snowball" || e.type === "egg" || e.type === "ender_pearl" || e.type === "potion" || e.type === "experience_bottle" || e.type.includes("wind_charge") || e.type.includes("fireball")) thrownView(e, v);
    else {
      const x = extraView(e, getCtx());
      if (!x) return null;
      v.group.add(x.root);
      v.owned.push(...(x.owned as (THREE.Material | THREE.BufferGeometry)[]));
      v.update = (en, pt, px, py, pz) => x.update(en, pt, px, py, pz, day);
    }
    scene.add(v.group);
    return v;
  }

  function destroy(id: number, v: View) {
    v.group.parent?.remove(v.group);
    if (v.model) {
      forgetModel(v.model.root);
      v.model.dispose();
    }
    v.tag?.dispose();
    for (const o of v.owned) o.dispose();
    views.delete(id);
  }

  return {
    frame(list: Entity[], pt: number, _dt: number) {
      const ctx = getCtx();
      const scene = ctx.renderer?.scene;
      if (!scene) return;
      frameNo++;
      day = daylight(ctx);
      camPos.copy(ctx.renderer.camera.position);
      for (const e of list) {
        if (e.data._remove) continue;
        const px = (e.data._px as number) ?? e.body.pos.x;
        const py = (e.data._py as number) ?? e.body.pos.y;
        const pz = (e.data._pz as number) ?? e.body.pos.z;
        let x = px + (e.body.pos.x - px) * pt;
        let y = py + (e.body.pos.y - py) * pt;
        let z = pz + (e.body.pos.z - pz) * pt;
        const fly = e.data._fly as number | undefined;
        if (fly !== undefined) {
          const f = Math.min(1, (3 - fly + pt) / 3);
          const p = ctx.player.body.pos;
          x += (p.x - x) * f;
          y += (p.y + 0.8 - y) * f;
          z += (p.z - z) * f;
        }
        const max = e.type === "item" || e.type === "xp_orb" || e.type.includes("arrow") ? MISC_DIST : MOB_DIST;
        const dx = x - camPos.x, dz = z - camPos.z;
        let v = views.get(e.id);
        if (dx * dx + dz * dz > max * max) {
          if (v) v.group.visible = false;
          if (v) v.seen = frameNo;
          continue;
        }
        if (v && e.type === "item") {
          const s = e.data.stack as ItemStack;
          if (`${s.item}:${renderCount(s.count)}` !== v.key) {
            destroy(e.id, v);
            v = undefined;
          }
        }
        if (!v) {
          const nv = create(e, scene);
          if (!nv) continue;
          views.set(e.id, nv);
          v = nv;
        }
        v.seen = frameNo;
        v.group.visible = true;
        v.update(e, pt, x, y, z);
      }
      for (const [id, v] of views) if (v.seen !== frameNo) destroy(id, v);
    },
    clear() {
      for (const [id, v] of views) destroy(id, v);
    },
    dispose() {
      for (const [id, v] of views) destroy(id, v);
      disposeCaches();
      disposeMisc();
    },
  };
}

