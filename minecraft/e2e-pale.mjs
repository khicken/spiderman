// Pale garden smoke test. Run: node e2e-pale.mjs (dev server on :3442). Screenshots go to .shots/.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const URL = process.env.URL ?? "http://localhost:3442/minecraft";
const OUT = process.env.OUT ?? ".shots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 }, serviceWorkers: "block" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));

async function click(label, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ok = await page.evaluate((label) => {
      for (const img of [...document.querySelectorAll("img")].filter((i) => i.alt === label)) {
        let el = img.parentElement;
        while (el && !(el.style && el.style.cursor)) el = el.parentElement;
        if (el) {
          el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
          el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
          el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
          return true;
        }
      }
      return false;
    }, label);
    if (ok) return;
    await sleep(250);
  }
  throw new Error(`button not found: ${label}`);
}
const mc = (fn, arg) => page.evaluate(fn, arg);
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });

try {
  for (let i = 0; i < 4; i++) {
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    const ok = await page.waitForFunction(() => [...document.querySelectorAll("img")].some((i) => i.alt === "Singleplayer"), null, { timeout: 60000 }).then(() => true, () => false);
    if (ok) break;
  }
  await click("Singleplayer");
  await click("Create New World");
  await sleep(800);
  await click("Allow Cheats: OFF", 3000).catch(() => log("no cheats toggle"));
  await click("Create New World");
  await page.waitForFunction(() => !!window.__mc?.ctx?.player, null, { timeout: 180000, polling: 500 });
  log("in world");
  await sleep(3000);
  const loc = await mc(() => {
    window.__mc.cmd("/gamemode creative");
    return JSON.stringify(window.__mc.cmd("/locate biome pale_garden"));
  });
  log("locate", loc);
  const m = /\[(-?\d+), ~, (-?\d+)\]/.exec(loc);
  if (!m) throw new Error("no pale garden found");
  const [x, z] = [Number(m[1]), Number(m[2])];
  await mc(([x, z]) => window.__mc.tp(x + 0.5, 140, z + 0.5), [x, z]);
  await mc(() => window.__mc.time(6000));
  // Wait for chunks, then drop to the canopy top.
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const ready = await mc(([x, z]) => window.__mc.ctx.world.isLoaded(x, z) && window.__mc.ctx.world.topY(x, z) > 0, [x, z]);
    if (ready) break;
  }
  const info = await mc(([x, z]) => {
    const w = window.__mc.ctx.world;
    const y = w.topY(x, z);
    window.__mc.tp(x + 0.5, y + 6, z + 0.5);
    window.__mc.look(30, -15);
    return { y, biome: w.getBiome(x, z).name, top: window.__mc.block(x, y, z) };
  }, [x, z]);
  log("site", info);
  await sleep(6000);
  await shot("pale-garden-day");
  await mc(([x, z, y]) => { window.__mc.tp(x + 0.5, y + 3, z + 0.5); window.__mc.look(0, -80); }, [x, z, info.y]);
  await sleep(2500);
  await shot("pale-leaves-close");
  // Under the canopy: find a column with ground, stand there.
  const ground = await mc(([x, z]) => {
    const w = window.__mc.ctx.world;
    for (let d = 0; d < 30; d++) for (const [dx, dz] of [[d, 0], [0, d], [-d, 0], [0, -d]]) {
      for (let y = w.topY(x + dx, z + dz); y > 60; y--) {
        const n = window.__mc.block(x + dx, y, z + dz);
        if (n === "pale_moss_block" || n === "grass_block" || n === "pale_moss_carpet") return { x: x + dx, y: y + 1, z: z + dz, n };
        if (!/leaves|air|moss|log|eyeblossom|grass/.test(n)) break;
      }
    }
    return null;
  }, [x, z]);
  log("ground", ground);
  if (ground) {
    await mc((g) => { window.__mc.tp(g.x + 0.5, g.y + 0.2, g.z + 0.5); window.__mc.look(45, -5); }, ground);
    await sleep(3000);
    await shot("pale-garden-floor");
  }

  // Find a natural heart near here.
  const heart = await mc(([x, z]) => {
    const w = window.__mc.ctx.world;
    for (let r = 0; r < 48; r++)
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const top = w.topY(x + dx, z + dz);
          for (let y = top; y > top - 20; y--) if (window.__mc.block(x + dx, y, z + dz) === "creaking_heart") return { x: x + dx, y, z: z + dz };
        }
    return null;
  }, [x, z]);
  log("natural heart", heart);
  let h = heart;
  if (!h) {
    h = await mc(([x, z]) => {
      const w = window.__mc.ctx.world;
      const y = w.topY(x + 4, z + 4) + 1;
      window.__mc.cmd(`/setblock ${x + 4} ${y} ${z + 4} pale_oak_log`);
      window.__mc.cmd(`/setblock ${x + 4} ${y + 1} ${z + 4} creaking_heart`);
      window.__mc.cmd(`/setblock ${x + 4} ${y + 2} ${z + 4} pale_oak_log`);
      return { x: x + 4, y: y + 1, z: z + 4 };
    }, [x, z]);
    log("placed heart", h);
  }
  // Night, survival, normal: the awake heart spawns a creaking.
  await mc(() => {
    window.__mc.cmd("/gamemode survival");
    window.__mc.cmd("/difficulty normal");
    window.__mc.cmd("/effect give @s resistance 600 4 true");
    window.__mc.cmd("/effect give @s night_vision 600 0 true");
    window.__mc.time(18000);
  });
  await mc((h) => window.__mc.tp(h.x + 5.5, window.__mc.ctx.world.topY(h.x + 5, h.z + 5) + 1, h.z + 5.5), h);
  let creaking = null;
  for (let i = 0; i < 30 && !creaking; i++) {
    await sleep(1000);
    creaking = await mc(() => {
      const list = [...(window.__mc.ctx.entities.all?.() ?? window.__mc.ctx.entities.list ?? [])];
      const c = list.find((e) => e.type === "creaking" && !e.dead);
      return c ? { id: c.id, x: c.body.pos.x, y: c.body.pos.y, z: c.body.pos.z, hp: c.health, heart: c.data.heart } : null;
    });
  }
  log("creaking", creaking, "heart meta", await mc((h) => window.__mc.ctx.world.getBlock(h.x, h.y, h.z) >>> 12, h));
  if (creaking) {
    h = creaking.heart;
    // Hit it while linked: health stays.
    const after = await mc((c) => {
      window.__mc.ctx.entities.damage(c.id, 6, "player", "player");
      const e = [...(window.__mc.ctx.entities.all?.() ?? [])].find((e) => e.id === c.id);
      return e ? e.health : null;
    }, creaking);
    log("hp after hit", after);
    // Frame a view with both the creaking and the heart.
    await mc(([c, h]) => {
      const w = window.__mc.ctx.world;
      let px = (c.x + h.x) / 2 + 4, pz = (c.z + h.z) / 2 + 4;
      for (const [ox, oz] of [[4, 4], [-4, 4], [4, -4], [-4, -4], [6, 0], [0, 6], [-6, 0], [0, -6]]) {
        const tx = Math.floor((c.x + h.x) / 2 + ox), tz = Math.floor((c.z + h.z) / 2 + oz), ty = Math.floor(Math.max(c.y, h.y));
        if (window.__mc.block(tx, ty, tz) === "air" && window.__mc.block(tx, ty + 1, tz) === "air") { px = tx + 0.5; pz = tz + 0.5; break; }
      }
      window.__mc.tp(px, Math.max(c.y, h.y), pz);
      const dx = (c.x + h.x) / 2 - px, dz = (c.z + h.z) / 2 - pz;
      window.__mc.look((Math.atan2(-dx, dz) * 180) / Math.PI, 5);
    }, [creaking, h]);
    await sleep(2500);
    await shot("creaking-with-heart");
    // Close-up of the heart.
    await mc((h) => {
      const w = window.__mc.ctx.world;
      for (const [dx, dz, yaw] of [[0, 3, 180], [0, -3, 0], [3, 0, 90], [-3, 0, -90], [0, 2, 180], [0, -2, 0], [2, 0, 90], [-2, 0, -90]]) {
        if (window.__mc.block(h.x + dx, h.y, h.z + dz) === "air" && window.__mc.block(h.x + dx, h.y - 1, h.z + dz) === "air") {
          window.__mc.tp(h.x + dx + 0.5, h.y - 1, h.z + dz + 0.5);
          window.__mc.look(yaw, 0);
          return;
        }
      }
      window.__mc.tp(h.x + 0.5, h.y - 1, h.z + 3.5);
      window.__mc.look(180, 0);
    }, h);
    await sleep(2000);
    await shot("creaking-heart-awake");
  }
  // Staged scene: a heart in a short trunk on open ground, its creaking a few blocks away.
  if (ground) {
    const g = ground;
    await mc((g) => {
      const c = window.__mc.cmd;
      c(`/fill ${g.x - 8} ${g.y} ${g.z - 8} ${g.x + 8} ${g.y + 12} ${g.z + 8} air`);
      c(`/fill ${g.x - 8} ${g.y - 1} ${g.z - 8} ${g.x + 8} ${g.y - 1} ${g.z + 8} pale_moss_block`);
      c(`/fill ${g.x - 8} ${g.y} ${g.z + 6} ${g.x + 8} ${g.y} ${g.z + 6} pale_moss_carpet`);
      c(`/setblock ${g.x - 3} ${g.y} ${g.z - 2} closed_eyeblossom`);
      c(`/setblock ${g.x + 3} ${g.y} ${g.z - 3} open_eyeblossom`);
      c(`/setblock ${g.x} ${g.y} ${g.z} pale_oak_log`);
      c(`/setblock ${g.x} ${g.y + 1} ${g.z} creaking_heart`);
      c(`/setblock ${g.x} ${g.y + 2} ${g.z} pale_oak_log`);
      c(`/setblock ${g.x} ${g.y + 3} ${g.z} pale_oak_log`);
      c(`/fill ${g.x - 2} ${g.y + 4} ${g.z - 2} ${g.x + 2} ${g.y + 5} ${g.z + 2} pale_oak_leaves`);
      c(`/setblock ${g.x + 2} ${g.y + 3} ${g.z} pale_hanging_moss`);
      c(`/setblock ${g.x - 2} ${g.y + 3} ${g.z + 1} pale_hanging_moss`);
      for (const e of window.__mc.ctx.entities.all()) if (e.type === "creaking") e.data._remove = true;
      window.__mc.tp(g.x + 0.5, g.y, g.z + 9.5);
      window.__mc.look(0, 0);
    }, g);
    let cr = null;
    for (let i = 0; i < 20 && !cr; i++) {
      await sleep(1000);
      cr = await mc((g) => {
        for (const e of window.__mc.ctx.entities.all()) if (e.type === "creaking" && !e.dead && e.data.heart?.x === g.x) return e.id;
        return null;
      }, g);
    }
    log("staged creaking", cr, "heart", await mc((g) => window.__mc.block(g.x, g.y + 1, g.z) + " meta " + (window.__mc.ctx.world.getBlock(g.x, g.y + 1, g.z) >>> 12), g));
    if (cr) {
      await mc(([g, id]) => {
        const e = window.__mc.ctx.entities.get(id);
        e.body.pos.set(g.x + 3.5, g.y, g.z + 1.5);
        e.yaw = Math.PI;
        window.__mc.tp(g.x + 1.5, g.y + 0.5, g.z + 8.5);
        window.__mc.look(0, 8);
      }, [g, cr]);
      await sleep(800);
      const hp = await mc((id) => {
        window.__mc.ctx.entities.damage(id, 6, "player", "player");
        return window.__mc.ctx.entities.get(id)?.health;
      }, cr);
      log("staged hp after hit", hp);
      await sleep(250);
      await shot("creaking-with-heart");
      await mc(() => window.__mc.time(6000));
      await sleep(3000);
      log("after day: creaking alive?", await mc((id) => !!window.__mc.ctx.entities.get(id) && !window.__mc.ctx.entities.get(id).dead, cr));
      await shot("heart-dormant-day");
    }
  }
  log("errors", errors.slice(0, 10));
} catch (e) {
  log("FAIL", e);
  await shot("fail").catch(() => {});
} finally {
  await browser.close();
}
