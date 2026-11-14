import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_Y, idOf, metaOf } from "../src/game/contracts";
import { blockId } from "../src/game/blocks/registry";
import { BIOMES, biomeId } from "../src/game/worldgen/biomes";
import { generateChunk } from "../src/game/worldgen/index";
import { overworldGen } from "../src/game/worldgen/overworld";
import { palePlan } from "../src/game/worldgen/pale-garden";
import { createRng } from "../src/game/worldgen/rng";

// Seed 2024 has a pale garden around x 736, z -160.
const SEED = 2024, X = 736, Z = -160;

test("pale garden biome is appended with vanilla colors", () => {
  const b = BIOMES[biomeId("pale_garden")];
  assert.equal(b.name, "pale_garden");
  assert.equal(b.id, BIOMES.length - 1);
  assert.equal(b.skyColor, 0xb9b9b9);
  assert.equal(b.fogColor, 0x817770);
  assert.equal(b.waterColor, 0x76889d);
});

test("pale garden is selected by the climate", () => {
  assert.equal(overworldGen(SEED).ow.biomeAt(X, Z), biomeId("pale_garden"));
});

test("pale oak plan has a 2x2 trunk and trunk cells with logs above and below", () => {
  for (let s = 1; s < 50; s++) {
    const p = palePlan(createRng(s), 0, 70, 0);
    const logs = new Set<string>();
    for (let i = 0; i < p.logs.length; i += 3) logs.add(`${p.logs[i]},${p.logs[i + 1]},${p.logs[i + 2]}`);
    for (const [x, z] of [[0, 0], [1, 0], [0, 1], [1, 1]]) assert.ok(logs.has(`${x},70,${z}`));
    assert.ok(p.trunk.length > 0);
    for (let i = 0; i < p.trunk.length; i += 3) {
      const [x, y, z] = [p.trunk[i], p.trunk[i + 1], p.trunk[i + 2]];
      assert.ok(logs.has(`${x},${y - 1},${z}`) && logs.has(`${x},${y + 1},${z}`));
    }
  }
});

test("pale garden chunks get pale oaks, moss and creaking hearts inside trunks", () => {
  const LOG = blockId("pale_oak_log"), HEART = blockId("creaking_heart"), MOSS = blockId("pale_hanging_moss"), CARPET = blockId("pale_moss_carpet");
  const H = [[0, 1], [-1, 0], [0, -1], [1, 0]];
  let logs = 0, moss = 0, hearts = 0, climbing = 0;
  for (let cx = (X >> 4) - 3; cx <= (X >> 4) + 3; cx++) {
    for (let cz = (Z >> 4) - 3; cz <= (Z >> 4) + 3; cz++) {
      const c = generateChunk(SEED, "overworld", cx, cz);
      const at = (lx: number, y: number, lz: number) => c.blocks[((y - MIN_Y) << 8) | (lz << 4) | lx];
      for (const s of c.blocks) {
        if (idOf(s) === LOG) logs++;
        else if (idOf(s) === MOSS) moss++;
      }
      for (let i = 0; i < c.blocks.length; i++) {
        const s = c.blocks[i];
        if (idOf(s) !== CARPET || !(metaOf(s) & 15)) continue;
        const lx = i & 15, lz = (i >> 4) & 15, y = (i >> 8) + MIN_Y;
        climbing++;
        for (let h = 0; h < 4; h++) {
          if (!(metaOf(s) & (1 << h))) continue;
          const nx = lx + H[h][0], nz = lz + H[h][1];
          if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16) assert.equal(idOf(at(nx, y, nz)), LOG, `moss side ${h} at ${lx},${y},${lz} faces a log`);
        }
      }
      for (const be of (c.blockEntities ?? []).filter((e) => e.type === "creaking_heart")) {
        hearts++;
        const lx = be.x - cx * 16, lz = be.z - cz * 16;
        const s = at(lx, be.y, lz);
        assert.equal(idOf(s), HEART);
        assert.equal(metaOf(s), 1 << 2);
        assert.equal(idOf(at(lx, be.y + 1, lz)), LOG);
        assert.equal(idOf(at(lx, be.y - 1, lz)), LOG);
      }
    }
  }
  assert.ok(logs > 200, `pale oak logs ${logs}`);
  assert.ok(moss > 10, `hanging moss ${moss}`);
  assert.ok(hearts > 0, "no creaking hearts");
  assert.ok(climbing > 5, `trunk moss carpets ${climbing}`);
});
