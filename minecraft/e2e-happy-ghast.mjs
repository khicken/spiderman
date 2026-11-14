// Happy ghast smoke test: harness, riding, dried ghast stages, ghastling hatch. Run: node e2e-happy-ghast.mjs (dev server on :3443).
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const URL = process.env.URL ?? "http://localhost:3443/minecraft";
const OUT = process.env.OUT ?? ".shots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 }, serviceWorkers: "block" })).newPage();
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
        if (el && el.style.cursor === "pointer") {
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
const E = (fn, arg) => page.evaluate(fn, arg);
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });

const results = {};
try {
  for (let i = 0; i < 4; i++) {
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    if (await page.waitForFunction(() => [...document.querySelectorAll("img")].some((i) => i.alt === "Singleplayer"), null, { timeout: 60000 }).then(() => true, () => false)) break;
  }
  await click("Singleplayer");
  await click("Create New World");
  await sleep(800);
  await click("Allow Cheats: OFF", 3000).catch(() => log("no cheats toggle"));
  await sleep(300);
  await click("Create New World");
  await page.waitForFunction(() => !!window.__mc?.ctx?.player, null, { timeout: 180000, polling: 500 });
  log("in world");
  await sleep(4000);

  // A glass deck high in the sky so terrain does not matter.
  await E(() => {
    const mc = window.__mc, w = mc.ctx.world;
    mc.cmd("/gamemode creative");
    mc.cmd("/gamerule doMobSpawning false");
    mc.time(6000);
    const p = mc.ctx.player.body.pos, X = Math.floor(p.x), Z = Math.floor(p.z), Y = 200;
    window.__deck = { X, Y, Z };
    mc.cmd(`/fill ${X - 8} ${Y - 1} ${Z - 4} ${X + 12} ${Y - 1} ${Z + 16} glass`);
    mc.tp(X + 0.5, Y, Z + 0.5);
  });
  await sleep(1500);

  // Dried ghast stages 0..3 in a row facing the player, the last one waterlogged.
  results.stages = await E(() => {
    const { X, Y, Z } = window.__deck, mc = window.__mc, w = mc.ctx.world;
    mc.cmd(`/setblock ${X} ${Y} ${Z + 3} dried_ghast`);
    const base = w.getBlock(X, Y, Z + 3) & 0xfff;
    const out = [];
    for (let h = 0; h < 4; h++) {
      w.setBlock(X - 3 + h * 2, Y, Z + 3, base | ((h << 2) | 2) << 12);
      out.push(mc.block(X - 3 + h * 2, Y, Z + 3));
    }
    w.setBlock(X, Y, Z + 3, 0);
    return out;
  });
  await E(() => {
    const { X, Y, Z } = window.__deck;
    window.__mc.tp(X + 0.5, Y, Z - 1.5);
    window.__mc.look(180, -30);
  });
  await sleep(2500);
  await sleep(1500);
  await shot("dried-ghast-stages");

  // Hatch: hydration 3 in water, tick due now.
  results.hatch = await E(async () => {
    const { X, Y, Z } = window.__deck, mc = window.__mc, w = mc.ctx.world;
    const x = X + 3, y = Y, z = Z + 3;
    const before = mc.ctx.entities.all().filter((e) => e.type === "happy_ghast").length;
    w.setWaterlogged(x, y, z, true);
    const wet = w.isWaterlogged(x, y, z);
    // Each placement already queued a 5000-tick step; jump the clock past it.
    const t0 = mc.ctx.time.tick;
    mc.ctx.time.tick += 5001;
    await new Promise((r) => setTimeout(r, 1500));
    const g = mc.ctx.entities.all().filter((e) => e.type === "happy_ghast");
    const baby = g.find((e) => (e.data.grow ?? 0) < 0);
    return { wet, t0, t1: mc.ctx.time.tick, before, after: g.length, block: mc.block(x, y, z), babyGrow: baby?.data.grow, babyWidth: baby?.body.width };
  });
  log("hatch", results.hatch);

  // Dry stage-0 ghast out of water must not progress.
  results.dry = await E(async () => {
    const { X, Y, Z } = window.__deck, mc = window.__mc, w = mc.ctx.world;
    const x = X - 3, y = Y, z = Z + 3;
    return { hydration: (w.getBlock(x, y, z) >> 14) & 3, ticked: mc.ctx.time.tick };
  });

  // Adult happy ghast: harness on, color, then ride.
  results.harness = await E(() => {
    const { X, Y, Z } = window.__deck, mc = window.__mc, ctx = mc.ctx;
    const g = ctx.entities.spawn("happy_ghast", X + 0.5, Y + 2, Z + 10);
    window.__g = g.id;
    ctx.inventory.setSlot(ctx.inventory.selected, { item: "light_blue_harness", count: 1 });
    const ok = ctx.entities.interact(g.id, ctx.inventory.held());
    return { ok, harness: g.data.harness };
  });
  await E(() => {
    const { X, Y, Z } = window.__deck, mc = window.__mc;
    mc.tp(X + 0.5, Y, Z - 1);
    mc.look(180, 8);
    mc.ctx.inventory.setSlot(mc.ctx.inventory.selected, null);
    const baby = mc.ctx.entities.all().find((e) => e.type === "happy_ghast" && (e.data.grow ?? 0) < 0);
    window.__pin = () => {
      const g = mc.ctx.entities.get(window.__g);
      g.body.pos.set(X + 0.5, Y + 0.5, Z + 10);
      g.body.vel.set(0, 0, 0);
      g.yaw = Math.PI;
      if (baby) {
        baby.body.pos.set(X + 4, Y + 1.5, Z + 6);
        baby.body.vel.set(0, 0, 0);
      }
    };
  });
  for (let i = 0; i < 20; i++) {
    await E(() => window.__pin());
    await sleep(100);
  }
  await shot("happy-ghast-harness");

  results.ride = await E(async () => {
    const mc = window.__mc, ctx = mc.ctx, g = ctx.entities.get(window.__g);
    ctx.inventory.setSlot(ctx.inventory.selected, null);
    const mounted = ctx.entities.interact(g.id, null);
    const start = g.body.pos.clone();
    return { mounted, vehicle: ctx.player.vehicle === g.id, start: [start.x, start.y, start.z] };
  });
  // Look along +x (yaw -90 in this engine's convention is unknown, so measure the move direction against the look).
  await E(() => window.__mc.look(0, 0));
  await page.mouse.click(550, 350).catch(() => {});
  await page.keyboard.down("KeyW");
  await sleep(2500);
  await page.keyboard.up("KeyW");
  results.rideMove = await E(() => {
    const mc = window.__mc, g = mc.ctx.entities.get(window.__g), d = mc.ctx.player.lookDir();
    return { pos: [g.body.pos.x, g.body.pos.y, g.body.pos.z], look: [d.x, d.y, d.z] };
  });
  await shot("happy-ghast-riding");
  {
    const s = results.ride.start, p = results.rideMove.pos, l = results.rideMove.look;
    const mv = [p[0] - s[0], p[1] - s[1], p[2] - s[2]];
    const len = Math.hypot(...mv);
    results.rideAlign = len > 0 ? (mv[0] * l[0] + mv[1] * l[1] + mv[2] * l[2]) / len : 0;
    results.rideDist = len;
  }

  // Harness icons in the hotbar.
  await E(() => {
    const ctx = window.__mc.ctx;
    ["white", "red", "lime", "light_blue", "purple", "black", "orange", "yellow"].forEach((c, i) => ctx.inventory.setSlot(i, { item: `${c}_harness`, count: 1 }));
    ctx.inventory.setSlot(8, { item: "dried_ghast", count: 1 });
    ctx.inventory.setSlot(9, { item: "music_disc_tears", count: 1 });
  });
  await sleep(800);
  await shot("harness-hotbar");
} catch (e) {
  results.error = String(e);
  await shot("error").catch(() => {});
}
console.log(JSON.stringify(results, null, 1));
console.log("errors", errors.slice(0, 10));
await browser.close();
