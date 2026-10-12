import type { Entity, GameCtx, MobDef } from "../../contracts";
import { blockDef } from "../../blocks/registry";
import { clearPath, moveTo, randomSpot } from "../ai";
import { isBaby } from "../geom";
import { rig, wrap, setRot, look, type VPart } from "../rig";
import { skin, shade, type Pix } from "./paint";
import { animalAI, feed, num, sound, type AnimalOpts } from "./common";

const RED = 0x8c2e1e;
const MOSS = [0x3e8c4a, 0x4aa058, 0x2f7a3e, 0x5ab468];
const DIGGABLE = new Set(["grass_block", "dirt", "coarse_dirt", "podzol", "rooted_dirt", "moss_block", "mud", "muddy_mangrove_roots"]);

function paintSniffer(p: Pix) {
  const R = [RED, shade(RED, 0.92), shade(RED, 1.08), shade(RED, 0.85)];
  const body = p.fillCuboid(0, 0, 25, 29, 40, R);
  for (let i = 0; i < 70; i++) {
    const x = body.top[0] + Math.floor(p.rand() * 25), y = body.top[1] + Math.floor(p.rand() * 40);
    p.rect([x, y, 2 + Math.floor(p.rand() * 3), 2], MOSS[i % 4]);
  }
  for (const r of [body.right, body.left]) {
    p.noise([r[0], r[1], r[2], 5], MOSS);
    for (let x = 0; x < r[2]; x++) if (p.rand() < 0.5) p.px(r[0] + x, r[1] + 5, MOSS[x % 4]);
    p.noise([r[0], r[1] + 24, r[2], 5], [shade(RED, 0.7), shade(RED, 0.65)]);
  }
  p.noise(body.bottom, [shade(RED, 0.6), shade(RED, 0.55)]);
  for (let i = 0; i < 6; i++) {
    const u = (i % 3) * 32, v = 72 + Math.floor(i / 3) * 20;
    const leg = p.fillCuboid(u, v, 7, 10, 8, [shade(RED, 0.8), shade(RED, 0.74)]);
    p.rect([u, leg.front[1] + 8, 30, 2], 0x3a2418);
  }
  const head = p.fillCuboid(100, 72, 13, 18, 11, R);
  const f = head.front;
  p.noise([f[0], f[1], 13, 4], MOSS);
  p.rect([f[0] + 2, f[1] + 6, 2, 2], 0x1a0e0a);
  p.rect([f[0] + 9, f[1] + 6, 2, 2], 0x1a0e0a);
  p.px(f[0] + 2, f[1] + 6, 0xe8d8c0);
  p.px(f[0] + 9, f[1] + 6, 0xe8d8c0);
  p.noise([f[0], f[1] + 12, 13, 6], [0x4c9a6a, 0x3e8a5c, 0x5aa878]);
  p.fillCuboid(0, 116, 1, 19, 7, R);
  p.fillCuboid(20, 116, 1, 19, 7, R);
  const nose = p.fillCuboid(40, 116, 13, 3, 4, [0x5ab07a, 0x4a9a68, 0x68c088]);
  p.rect([nose.front[0] + 3, nose.front[1] + 1, 2, 1], 0x24442e);
  p.rect([nose.front[0] + 8, nose.front[1] + 1, 2, 1], 0x24442e);
}

function snifferModel() {
  const leg = (name: string, x: number, z: number, i: number): VPart => ({ name, parent: "bone", pivot: [x, 10, z], box: [-3.5, -1, -4, 7, 10, 8], uv: [(i % 3) * 32, 72 + Math.floor(i / 3) * 20] });
  const parts: VPart[] = [
    { name: "bone", pivot: [0, 5, 0], box: [0, 0, 0, 0, 0, 0], uv: [190, 190] },
    { name: "body", parent: "bone", pivot: [0, 0, 0], box: [-12.5, -14, -20, 25, 29, 40], uv: [0, 0] },
    leg("right_front_leg", -7.5, -15, 0),
    leg("right_mid_leg", -7.5, 0, 1),
    leg("right_hind_leg", -7.5, 15, 2),
    leg("left_front_leg", 7.5, -15, 3),
    leg("left_mid_leg", 7.5, 0, 4),
    leg("left_hind_leg", 7.5, 15, 5),
    { name: "head", parent: "body", pivot: [0, 6.5, -19.5], box: [-6.5, -7.5, -11.5, 13, 18, 11], uv: [100, 72] },
    { name: "left_ear", parent: "head", pivot: [6.51, -7.5, -4.51], box: [0, 0, -3, 1, 19, 7], uv: [0, 116] },
    { name: "right_ear", parent: "head", pivot: [-6.51, -7.5, -4.51], box: [-1, 0, -3, 1, 19, 7], uv: [20, 116] },
    { name: "nose", parent: "head", pivot: [0, 0, 0], box: [-6.5, 7.5, -15.5, 13, 3, 4], uv: [40, 116] },
  ];
  const r = rig(skin("sniffer", 192, 192, paintSniffer), parts);
  return wrap(
    r,
    (a) => {
      const s = Math.cos(a.phase * 0.6662) * 0.8 * a.walk;
      setRot(r.p.right_front_leg, s, 0, 0);
      setRot(r.p.left_mid_leg, s, 0, 0);
      setRot(r.p.right_hind_leg, s, 0, 0);
      setRot(r.p.left_front_leg, -s, 0, 0);
      setRot(r.p.right_mid_leg, -s, 0, 0);
      setRot(r.p.left_hind_leg, -s, 0, 0);
      const st = a.e.data.state as string | undefined;
      if (st === "digging") setRot(r.p.head, 0.9 + Math.sin(a.age * 0.8) * 0.15, 0, 0);
      else if (st === "scenting" || st === "sniffing") setRot(r.p.head, 0.2 + Math.sin(a.age * 1.6) * 0.06, a.yaw, 0);
      else look(r.p.head, a);
      const flop = Math.sin(a.age * 0.12) * 0.1 + a.walk * Math.sin(a.phase * 0.6662) * 0.3;
      setRot(r.p.left_ear, 0, 0, -flop);
      setRot(r.p.right_ear, 0, 0, flop);
    },
    { scale: 1, head: [], babyHead: 1 },
  );
}

const snifferOpts: AnimalOpts = { food: ["torchflower_seeds"] };

function floorName(ctx: GameCtx, e: Entity) {
  return blockDef(ctx.world.getBlock(Math.floor(e.body.pos.x), Math.floor(e.body.pos.y - 0.2), Math.floor(e.body.pos.z))).name;
}

function setState(e: Entity, s: string | undefined, ticks = 0) {
  e.data.state = s;
  e.data._st = ticks;
}

export const SNIFFER: MobDef = {
  type: "sniffer",
  displayName: "Sniffer",
  category: "passive",
  width: 1.9,
  height: 1.75,
  maxHealth: 14,
  speed: 0.1,
  xp: [1, 3],
  sounds: { ambient: "entity.sniffer.idle", hurt: "entity.sniffer.hurt", death: "entity.sniffer.death", step: "entity.sniffer.step" },
  createModel: snifferModel,
  tick(e, ctx) {
    e.data.ambientInterval = 160;
    const cd = num(e, "digCd", 600);
    if (cd > 0) e.data.digCd = cd - 1;
    const st = e.data.state as string | undefined;
    if (st && num(e, "_panic") > 0) setState(e, undefined);
    let t = num(e, "_st");
    if (st) e.data._st = --t;
    const p = e.body.pos;
    if (st === "scenting") {
      clearPath(e);
      if (t <= 0) {
        const spot = randomSpot(ctx, e, 10, 4);
        e.data._dig = spot ? [spot.x, spot.y, spot.z] : undefined;
        setState(e, "sniffing", 200);
        sound(ctx, e, "entity.sniffer.searching");
      }
      return;
    }
    if (st === "sniffing") {
      const g = e.data._dig as [number, number, number] | undefined;
      if (e.age % 40 === 0) sound(ctx, e, "entity.sniffer.sniffing");
      const there = !g || !moveTo(e, ctx, g[0], g[1], g[2], 0.1 * 1.25) || (g[0] - p.x) ** 2 + (g[2] - p.z) ** 2 < 2;
      if (there || t <= 0) {
        clearPath(e);
        if (DIGGABLE.has(floorName(ctx, e))) {
          setState(e, "digging", 120);
          sound(ctx, e, "entity.sniffer.digging");
        } else setState(e, undefined);
      }
      return;
    }
    if (st === "digging") {
      clearPath(e);
      const fx = p.x - Math.sin(e.yaw) * 1.6, fz = p.z - Math.cos(e.yaw) * 1.6;
      const below = ctx.world.getBlock(Math.floor(fx), Math.floor(p.y - 0.5), Math.floor(fz));
      if (e.age % 4 === 0) ctx.emit({ type: "particles", kind: "block", x: fx, y: p.y + 0.1, z: fz, count: 3, state: below });
      if (t <= 0) {
        ctx.entities.dropItem({ item: ctx.random() < 0.5 ? "torchflower_seeds" : "pitcher_pod", count: 1 }, fx, p.y + 0.3, fz);
        sound(ctx, e, "entity.sniffer.drop_seed");
        setState(e, "rising", 20);
        e.data.digCd = 9600;
      }
      return;
    }
    if (st === "rising") {
      if (t <= 0) {
        setState(e, undefined);
        sound(ctx, e, "entity.sniffer.happy");
      }
      return;
    }
    if (cd <= 0 && !isBaby(e) && e.body.onGround && num(e, "_love") <= 0 && DIGGABLE.has(floorName(ctx, e)) && ctx.random() < 1 / 200) {
      clearPath(e);
      setState(e, "scenting", 40);
      sound(ctx, e, "entity.sniffer.scenting");
      return;
    }
    animalAI(e, ctx, snifferOpts);
  },
  onInteract(e, ctx, held) {
    return feed(e, ctx, SNIFFER, held, snifferOpts);
  },
};
