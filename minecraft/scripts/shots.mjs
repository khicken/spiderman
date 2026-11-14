// Dev tool: in-game screenshots for visual review. Needs the app on PORT (default 3417).
// node scripts/shots.mjs <outDir> [scene,...]   scenes: water, skeleton, ice
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? ".shots/run";
const scenes = (process.argv[3] ?? "water,skeleton,ice").split(",");
const PORT = process.env.PORT ?? "3417";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: false,
  args: ["--window-size=1280,800", "--use-angle=metal", "--enable-gpu"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("pageerror", e.message));
const wait = (ms) => page.waitForTimeout(ms);

async function clickLabel(text) {
  const el = page.locator(`img[alt^="${text}"]`).first();
  await el.waitFor({ timeout: 15000 });
  return el.click({ force: true });
}

async function cmd(c) {
  await page.keyboard.press("Slash");
  await wait(250);
  await page.keyboard.type(c.replace(/^\//, ""), { delay: 5 });
  await page.keyboard.press("Enter");
  await wait(400);
}

await page.goto(`http://localhost:${PORT}/minecraft`, { waitUntil: "domcontentloaded" });
await wait(4000);
await clickLabel("Singleplayer");
await wait(1200);
await clickLabel("Create New World");
await wait(1200);
for (let i = 0; i < 3; i++) {
  const gm = page.locator(`img[alt^="Game Mode"]`).first();
  const t = await gm.getAttribute("alt").catch(() => "");
  if (/Creative/.test(t ?? "")) break;
  await gm.click({ force: true });
  await wait(200);
}
await clickLabel("Create New World");
await wait(16000);
await page.mouse.click(640, 360);
await wait(500);

await cmd("/difficulty normal");
await cmd("/time set noon");
await cmd("/weather clear");
await cmd("/gamerule doDaylightCycle false");
await cmd("/gamerule doMobSpawning false");

// Synthetic movementX/Y turns the camera while the pointer is locked (about 0.15 degrees per unit at default sensitivity).
async function look(dx, dy = 0) {
  await page.evaluate(async ([x, y]) => {
    for (let i = 0; i < 30; i++) {
      window.dispatchEvent(new MouseEvent("mousemove", { movementX: x / 30, movementY: y / 30 }));
      await new Promise((r) => requestAnimationFrame(r));
    }
  }, [dx, dy]);
  await wait(300);
}

async function shot(name) {
  await wait(300);
  await page.keyboard.press("F1").catch(() => {});
  await wait(200);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.keyboard.press("F1").catch(() => {});
  console.log("shot", `${out}/${name}.png`);
}

// Build a scene well above terrain so nothing blocks it. The camera faces whatever the spawn yaw is, so surround it.
if (scenes.includes("skeleton")) {
  await cmd("/tp ~ 200 ~");
  await cmd("/fill ~-10 199 ~-10 ~10 199 ~10 grass_block");
  await cmd("/fill ~-10 200 ~-10 ~10 204 ~10 air");
  await cmd("/kill @e[type=!player]");
  // Night so they do not burn; night vision so they are lit.
  await cmd("/time set 18000");
  await cmd("/effect give @s night_vision 99999 0 true");
  await cmd("/effect give @s resistance 99999 4 true");
  const kinds = ["skeleton", "stray", "wither_skeleton", "bogged"];
  for (const [ax, az] of [[0, 1], [0, -1], [1, 0], [-1, 0]])
    for (let i = 0; i < 4; i++) {
      const o = -3 + i * 2;
      const x = ax * 4 + (az ? o : 0), z = az * 4 + (ax ? o : 0);
      await cmd(`/summon ${kinds[i]} ~${x} 200 ~${z} {NoAI:1b}`);
    }
  await cmd("/tp ~ 200 ~");
  await wait(2000);
  for (let i = 0; i < 4; i++) {
    await shot(`skeleton_row_${i}`);
    await look(1200);
  }
  await cmd("/kill @e[type=!player]");
  await cmd("/gamemode survival");
  await cmd("/fill ~-30 199 ~-30 ~30 199 ~30 grass_block");
  for (const [dx, dz] of [[0, 7]]) await cmd(`/summon skeleton ~${dx} 200 ~${dz}`);
  await wait(1200);
  for (let i = 0; i < 4; i++) {
    await shot(`skeleton_aiming_${i}`);
    await look(1200);
  }
  await cmd("/kill @e[type=!player]");
  await cmd("/gamemode creative");
  await cmd("/effect clear @s");
  await cmd("/time set noon");
}

if (scenes.includes("ice")) {
  await cmd("/tp ~ 200 ~");
  await cmd("/fill ~-10 199 ~-10 ~10 199 ~10 grass_block");
  await cmd("/fill ~-10 200 ~-10 ~10 204 ~10 air");
  await cmd("/kill @e[type=!player]");
  // In every direction: packed ice, ice (with a gold block behind it to show translucency), blue ice, frosted ice.
  for (const [ax, az] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const at = (o, d) => [ax * d + (az ? o : 0), az * d + (ax ? o : 0)];
    const put = async (o, d, y0, y1, b) => {
      const [x, z] = at(o, d);
      await cmd(`/fill ~${x} ${y0} ~${z} ~${x} ${y1} ~${z} ${b}`);
    };
    await put(-3, 4, 200, 201, "packed_ice");
    await put(-1, 4, 200, 201, "ice");
    await put(-1, 5, 200, 201, "gold_block");
    await put(1, 4, 200, 201, "blue_ice");
    await put(3, 4, 200, 201, "frosted_ice");
  }
  await cmd("/tp ~ 200 ~");
  await wait(2000);
  await shot("ice");
}

if (scenes.includes("water")) {
  await cmd("/tp ~ 120 ~");
  await cmd("/fill ~-20 100 ~-20 ~20 100 ~20 sand");
  await cmd("/fill ~-20 101 ~-20 ~20 115 ~20 water");
  for (let i = 0; i < 6; i++) await cmd(`/fill ~${-18 + i * 7} 101 ~-18 ~${-17 + i * 7} 108 ~-17 stone`);
  for (let i = 0; i < 6; i++) await cmd(`/fill ~${-18 + i * 7} 101 ~17 ~${-17 + i * 7} 108 ~18 oak_planks`);
  for (let i = 0; i < 6; i++) await cmd(`/fill ~17 101 ~${-18 + i * 7} ~18 108 ~${-17 + i * 7} gold_block`);
  for (let i = 0; i < 6; i++) await cmd(`/fill ~-18 101 ~${-18 + i * 7} ~-17 108 ~${-17 + i * 7} diamond_block`);
  await cmd("/tp ~ 106 ~");
  await wait(800);
  await shot("water_enter");
  await wait(5000);
  await shot("water_5s");
  await wait(25000);
  await shot("water_30s");
  await cmd("/effect give @s night_vision 60");
  await wait(1500);
  await shot("water_nightvision");
}

await browser.close();
