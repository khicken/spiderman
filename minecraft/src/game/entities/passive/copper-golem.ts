import type { Entity, GameCtx, MobDef } from "../../contracts";
import { clearPath, idleLook, wander } from "../ai";
import { rig, wrap, setRot, look, type VPart } from "../rig";
import { skin, shade, type Pix } from "./paint";
import { num, sound, useItem } from "./common";

// Data: oxidation 0..3 (unaffected, exposed, weathered, oxidized), waxed, statue, oxTimer (ticks to next stage).
const STAGES = ["unaffected", "exposed", "weathered", "oxidized"] as const;
const PALETTES: number[][] = [
  [0xc66a43, 0xe0804f, 0xa9512f, 0xd4733f],
  [0xa8826a, 0xc0957a, 0x8e6a55, 0x9e7d62],
  [0x6c9e74, 0x63a682, 0x4f8a6a, 0x7aa77c],
  [0x4fa38c, 0x5fbea0, 0x3e8c78, 0x4fae94],
];
// Vanilla stage times are many real hours; shortened so the change is visible in play.
const STAGE_TICKS: [number, number] = [24000, 36000];
const near: Entity[] = [];

function stageOf(e: Entity) {
  return Math.max(0, Math.min(3, num(e, "oxidation")));
}

function paintGolem(p: Pix, stage: number) {
  const C = PALETTES[stage];
  const dark = shade(C[0], 0.6);
  const head = p.fillCuboid(0, 0, 8, 5, 10, C);
  const f = head.front;
  p.rect([f[0] + 1, f[1] + 2, 2, 1], 0x1e1410);
  p.rect([f[0] + 5, f[1] + 2, 2, 1], 0x1e1410);
  p.rect([f[0], f[1] + 4, 8, 1], dark);
  p.fillCuboid(40, 0, 2, 3, 2, C.map((c) => shade(c, 0.9)));
  p.fillCuboid(40, 8, 2, 4, 2, C.map((c) => shade(c, 0.8)));
  const knob = p.fillCuboid(48, 0, 4, 4, 4, C.map((c) => shade(c, 1.1)));
  p.rect([knob.top[0] + 1, knob.top[1] + 1, 2, 2], shade(C[1], 1.25));
  const body = p.fillCuboid(0, 16, 8, 6, 6, C);
  p.rect([body.front[0] + 3, body.front[1] + 1, 2, 2], dark);
  p.fillCuboid(32, 16, 3, 8, 4, C.map((c) => shade(c, 0.95)));
  p.fillCuboid(0, 32, 4, 5, 4, C.map((c) => shade(c, 0.85)));
  if (stage >= 2) {
    for (const r of [head.top, head.front, body.front]) {
      p.px(r[0] + 1, r[1] + 1, shade(C[1], 1.2));
      p.px(r[0] + r[2] - 2, r[1] + r[3] - 2, shade(C[1], 1.2));
    }
  }
}

function golemModel() {
  const leg = (name: string, x: number): VPart => ({ name, pivot: [x, 19, 0], box: [-2, 0, -2, 4, 5, 4], uv: [0, 32] });
  const parts: VPart[] = [
    { name: "body", pivot: [0, 19, 0], box: [-4, -6, -3, 8, 6, 6], uv: [0, 16] },
    { name: "head", pivot: [0, 13, 0], box: [-4, -5, -5, 8, 5, 10], uv: [0, 0] },
    { name: "nose", parent: "head", pivot: [0, 0, 0], box: [-1, -3, -7, 2, 3, 2], uv: [40, 0] },
    { name: "rod", parent: "head", pivot: [0, 0, 0], box: [-1, -9, -1, 2, 4, 2], uv: [40, 8] },
    { name: "knob", parent: "head", pivot: [0, 0, 0], box: [-2, -13, -2, 4, 4, 4], uv: [48, 0] },
    { name: "right_arm", pivot: [-4, 13, 0], box: [-3, 0, -2, 3, 8, 4], uv: [32, 16] },
    { name: "left_arm", pivot: [4, 13, 0], box: [0, 0, -2, 3, 8, 4], uv: [32, 16], mirror: true },
    leg("right_leg", -2),
    leg("left_leg", 2),
  ];
  const key = (s: number) => `copper_golem_${STAGES[s]}`;
  const paint = (s: number) => skin(key(s), 64, 64, (p) => paintGolem(p, s));
  const r = rig(paint(0), parts);
  return wrap(
    r,
    (a) => {
      if (a.e.data.statue) return;
      look(r.p.head, a);
      const s = Math.cos(a.phase * 0.6662) * 1.2 * a.walk;
      setRot(r.p.right_leg, s, 0, 0);
      setRot(r.p.left_leg, -s, 0, 0);
      setRot(r.p.right_arm, -s * 0.8, 0, 0);
      setRot(r.p.left_arm, s * 0.8, 0, 0);
      const spin = num(a.e, "_spin");
      if (spin > 0) setRot(r.p.head, a.pitch, a.yaw + (spin - a.pt) * 0.6, 0);
    },
    {
      variant: (e) => key(stageOf(e)),
      variantSkin: (k) => paint(Math.max(0, STAGES.indexOf(k.slice("copper_golem_".length) as (typeof STAGES)[number]))),
    },
  );
}

function nextTimer(ctx: GameCtx) {
  return STAGE_TICKS[0] + Math.floor(ctx.random() * (STAGE_TICKS[1] - STAGE_TICKS[0]));
}

function setStage(e: Entity, stage: number) {
  e.data.oxidation = stage;
  e.data.statue = false;
  e.data.oxTimer = undefined;
}

function particles(ctx: GameCtx, e: Entity, kind: "happy" | "dust", color?: number) {
  const p = e.body.pos;
  ctx.emit({ type: "particles", kind, x: p.x, y: p.y + e.body.height * 0.6, z: p.z, count: 8, color });
}

// Lightning damages first, so only look for a fresh bolt on ticks where the golem was hurt.
function checkLightning(e: Entity, ctx: GameCtx) {
  if (e.hurtTicks <= 0) return;
  const p = e.body.pos;
  ctx.entities.near(p.x, p.y, p.z, 6, near);
  const bolt = near.find((o) => o.type === "lightning_bolt" && o.id !== e.data._zap);
  near.length = 0;
  if (!bolt) return;
  e.data._zap = bolt.id;
  if (stageOf(e) > 0 || e.data.statue) {
    setStage(e, 0);
    particles(ctx, e, "dust", 0xe0804f);
  }
}

function oxidize(e: Entity, ctx: GameCtx) {
  if (e.data.waxed || e.data.statue) return;
  let t = e.data.oxTimer as number | undefined;
  if (typeof t !== "number") t = nextTimer(ctx);
  if (--t > 0) {
    e.data.oxTimer = t;
    return;
  }
  const s = stageOf(e);
  if (s < 3) {
    setStage(e, s + 1);
    return;
  }
  // Vanilla turns a fully oxidized golem into a statue block; here it freezes in place instead.
  e.data.statue = true;
  e.data.oxTimer = undefined;
  clearPath(e);
  sound(ctx, e, "entity.copper_golem.statue");
}

function tick(e: Entity, ctx: GameCtx) {
  e.data.persistent = true;
  checkLightning(e, ctx);
  oxidize(e, ctx);
  const spin = num(e, "_spin");
  if (spin > 0) e.data._spin = spin - 1;
  if (e.data.statue) {
    clearPath(e);
    e.body.vel.x = 0;
    e.body.vel.z = 0;
    return;
  }
  if (spin <= 0 && ctx.random() < 1 / 800) {
    e.data._spin = 20;
    sound(ctx, e, "entity.copper_golem.spin", 0.6);
  }
  if (!wander(e, ctx, num(e, "_speed", 0.2))) idleLook(e, ctx);
}

export const COPPER_GOLEM_DEF: MobDef = {
  type: "copper_golem",
  displayName: "Copper Golem",
  category: "misc",
  width: 0.49,
  height: 0.98,
  maxHealth: 12,
  speed: 0.2,
  drops: [{ item: "lightning_rod", count: [1, 1] }],
  sounds: { ambient: "entity.copper_golem.ambient", hurt: "entity.copper_golem.hurt", death: "entity.copper_golem.death", step: "entity.copper_golem.step" },
  createModel: golemModel,
  tick,
  onInteract(e, ctx, held) {
    if (!held) return false;
    if (held.item === "honeycomb") {
      if (e.data.waxed) return false;
      e.data.waxed = true;
      e.data.oxTimer = undefined;
      useItem(ctx);
      sound(ctx, e, "entity.copper_golem.wax_on");
      particles(ctx, e, "happy");
      return true;
    }
    if (held.item.endsWith("_axe")) {
      if (e.data.waxed) {
        e.data.waxed = false;
        sound(ctx, e, "entity.copper_golem.wax_off");
      } else if (e.data.statue) {
        e.data.statue = false;
        sound(ctx, e, "entity.copper_golem.scrape");
      } else if (stageOf(e) > 0) {
        setStage(e, stageOf(e) - 1);
        sound(ctx, e, "entity.copper_golem.scrape");
      } else return false;
      particles(ctx, e, "dust", 0xe0804f);
      if (ctx.player.gameMode !== "creative") ctx.inventory.damageHeld(1);
      return true;
    }
    return false;
  },
};
