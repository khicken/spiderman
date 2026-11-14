// Run: npx tsx --test tests/pale-multiface.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BlockState, GameCtx, ItemStack, PlaceInfo } from "../src/game/contracts";
import { AIR, Face, idOf, metaOf, stateOf } from "../src/game/contracts";
import { blockId } from "../src/game/blocks/registry";
import { BEHAVIORS } from "../src/game/mechanics/index";
import { outlineBoxes } from "../src/game/mechanics/shapes";
import { applyBoneMeal } from "../src/game/mechanics/bonemeal";
import { blockGeometry } from "../src/game/mesh/block-geometry";

const RESIN = blockId("resin_clump");
const CARPET = blockId("pale_moss_carpet");
const STONE = stateOf(blockId("stone"));
const DIR = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const OPP = [1, 0, 3, 2, 5, 4];

function setup(rand = 0.5) {
  const blocks = new Map<string, BlockState>();
  const drops: ItemStack[] = [];
  const k = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const world = {
    dim: "overworld",
    getBlock: (x: number, y: number, z: number) => blocks.get(k(x, y, z)) ?? AIR,
    setBlock(x: number, y: number, z: number, s: BlockState) {
      blocks.set(k(x, y, z), s);
      return true;
    },
    getBlockEntity: () => undefined,
    setBlockEntity: () => {},
    scheduleTick: () => {},
    isLoaded: () => true,
  };
  const ctx = {
    world,
    random: () => rand,
    rules: {},
    emit: () => {},
    player: { gameMode: "survival" },
    entities: { dropItem: (s: ItemStack) => drops.push(s) },
    inventory: { removeHeld: () => {} },
  } as unknown as GameCtx;
  return { ctx, world, drops };
}

const info = (face: Face): PlaceInfo => ({ face, hitX: 0.5, hitY: 0.5, hitZ: 0.5, yaw: 0, pitch: 0, sneaking: false });

function bounds(s: BlockState) {
  const p = blockGeometry(s).attributes.position.array as Float32Array;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], p[i] + 0.5);
    hi[i % 3] = Math.max(hi[i % 3], p[i] + 0.5);
  }
  return { lo, hi, n: p.length / 3 };
}

test("resin clump attaches to each of the 6 faces with one thin box and one plane", () => {
  for (let f = 0; f < 6; f++) {
    const s = setup();
    const [dx, dy, dz] = DIR[f];
    s.world.setBlock(dx, 64 + dy, dz, STONE);
    const st = BEHAVIORS.resin_clump.place!(s.ctx, 0, 64, 0, info(OPP[f] as Face), stateOf(RESIN));
    assert.ok(st !== null, `face ${f} placeable`);
    assert.equal(metaOf(st!), f);

    const boxes = outlineBoxes(st!, s.world as never, 0, 64, 0);
    assert.equal(boxes.length, 1);
    const b = boxes[0];
    const lo = [b.minX, b.minY, b.minZ], hi = [b.maxX, b.maxY, b.maxZ];
    const axis = f < 2 ? 0 : f < 4 ? 1 : 2;
    const pos = f % 2 === 0;
    assert.ok(Math.abs(hi[axis] - lo[axis] - 1 / 16) < 1e-9, `face ${f} box is 1px thick`);
    assert.equal(pos ? hi[axis] : lo[axis], pos ? 1 : 0, `face ${f} box sits against the support`);
    for (let a = 0; a < 3; a++) if (a !== axis) assert.equal(hi[a] - lo[a], 1);

    const g = bounds(st!);
    assert.ok(g.n > 0);
    assert.ok(g.hi[axis] - g.lo[axis] < 1e-6, `face ${f} mesh is one plane`);
    assert.ok(pos ? g.lo[axis] > 0.9 : g.hi[axis] < 0.1, `face ${f} mesh is next to the support`);

    s.world.setBlock(0, 64, 0, st!);
    BEHAVIORS.resin_clump.neighborChanged!(s.ctx, 0, 64, 0, st!, dx, 64 + dy, dz);
    assert.equal(s.world.getBlock(0, 64, 0), st!, "stays while supported");
    s.world.setBlock(dx, 64 + dy, dz, AIR);
    BEHAVIORS.resin_clump.neighborChanged!(s.ctx, 0, 64, 0, st!, dx, 64 + dy, dz);
    assert.equal(s.world.getBlock(0, 64, 0), AIR, `face ${f} breaks without support`);
    assert.deepEqual(s.drops.map((d) => d.item), ["resin_clump"]);
  }
});

test("resin clump needs a sturdy face and falls back to another one", () => {
  const s = setup();
  assert.equal(BEHAVIORS.resin_clump.place!(s.ctx, 0, 64, 0, info(Face.Up), stateOf(RESIN)), null);
  s.world.setBlock(0, 65, 0, STONE);
  const st = BEHAVIORS.resin_clump.place!(s.ctx, 0, 64, 0, info(Face.Up), stateOf(RESIN));
  assert.equal(metaOf(st!), Face.Up);
});

test("pale moss carpet grows sides on sturdy walls and drops them when the wall goes", () => {
  const s = setup(0);
  s.world.setBlock(0, 63, 0, STONE);
  s.world.setBlock(0, 64, 1, STONE); // south wall, h 0
  s.world.setBlock(1, 64, 0, STONE); // east wall, h 3
  const st = BEHAVIORS.pale_moss_carpet.place!(s.ctx, 0, 64, 0, info(Face.Up), stateOf(CARPET))!;
  assert.equal(idOf(st), CARPET);
  assert.equal(metaOf(st), 0b1001);
  assert.equal(metaOf(BEHAVIORS.pale_moss_carpet.place!(setupWith(s, 0.9), 0, 64, 0, info(Face.Up), stateOf(CARPET))!), 0b1001);

  const boxes = outlineBoxes(st, s.world as never, 0, 64, 0);
  assert.equal(boxes.length, 1);
  assert.ok(boxes[0].maxY <= 1 / 16 + 1e-9);

  const flat = bounds(stateOf(CARPET));
  assert.ok(flat.hi[1] <= 1 / 16 + 1e-6);
  const south = bounds(stateOf(CARPET, 1));
  assert.equal(south.hi[1], 1);
  assert.ok(south.n > flat.n);

  s.world.setBlock(0, 64, 0, st);
  s.world.setBlock(1, 64, 0, AIR);
  BEHAVIORS.pale_moss_carpet.neighborChanged!(s.ctx, 0, 64, 0, st, 1, 64, 0);
  assert.equal(metaOf(s.world.getBlock(0, 64, 0)), 0b0001);

  s.world.setBlock(-1, 64, 0, STONE); // west wall, h 1
  assert.equal(applyBoneMeal(s.ctx, 0, 64, 0, s.world.getBlock(0, 64, 0)), true);
  assert.equal(metaOf(s.world.getBlock(0, 64, 0)), 0b0011);
  assert.equal(applyBoneMeal(s.ctx, 0, 64, 0, s.world.getBlock(0, 64, 0)), false);
});

function setupWith(s: ReturnType<typeof setup>, rand: number): GameCtx {
  return { ...s.ctx, random: () => rand } as GameCtx;
}
