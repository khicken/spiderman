// Turntable shots of the hero lab page (src/app/lab/t14). Needs the dev server: NEXT_DIST_DIR=.next-3102 npx next dev --turbopack -p 3102
// Usage: node scripts/hero/hero-shot.mjs [poseName ...]   Output: v2/shots/t14/<pose>-<view>.png
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const URL = process.env.HERO_URL || "http://localhost:3102/zelda/lab/t14";
const OUT = path.resolve(import.meta.dirname, "../../v2/shots/t14");
fs.mkdirSync(OUT, { recursive: true });

const POSES = {
  idle: { o: {}, steps: 60 },
  run: { o: { speed: 6, sprint: false }, steps: 47 },
  sprint: { o: { speed: 9, sprint: true, lean: 0.8, turn: 1 }, steps: 50 },
  climb: { o: { mode: "climb", climbY: 1.4, grounded: false }, steps: 40, lift: 0 },
  glide: { o: { mode: "glide", grounded: false, vy: -2, speed: 10, lean: -0.6, glideMode: 0 }, steps: 90, lift: 1.2 },
  ride: { o: { mode: "ride", rideT: 0.4, speed: 7, grounded: false }, steps: 60, lift: 0.6 },
  attack: { o: { action: "attack1", actionT: 0.17, armed: true, combo: 1, speed: 0 }, steps: 20, hold: true },
  aim: { o: { action: "aim", draw: 0.9, hasBow: true, armed: false }, steps: 40 },
  skid: { o: { speed: 5, skid: 0.25 }, steps: 40 },
  vault: { o: { vault: 0.5, speed: 6, grounded: false, mode: "air" }, steps: 30 },
  pin: { o: { pinAim: true, lanternLean: { x: 1, y: 0 } }, steps: 40 },
};
const VIEWS = { front: [0, 5.2], side: [Math.PI / 2, 5.2], back: [Math.PI, 5.2], three: [0.7, 5.2], close: [0.35, 2.4] };

const exe = process.env.CHROMIUM || [
  "chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
].map((p) => path.join(os.homedir(), "Library/Caches/ms-playwright", p)).find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text()));
await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => window.__hero, null, { timeout: 120000 });
const want = process.argv.slice(2);
const stats = {};
for (const [name, def] of Object.entries(POSES)) {
  if (want.length && !want.includes(name)) continue;
  for (const [vn, [yaw, dist]] of Object.entries(VIEWS)) {
    if (vn === "close" && name !== "idle") continue;
    stats[name] = await page.evaluate(([d, yaw, dist]) => {
      const h = window.__hero;
      h.st.run = false;
      h.set(d.o);
      h.lift(d.lift ?? 0);
      h.step(d.steps);
      h.view(yaw, dist, vn_h(d, dist));
      return h.info();
      function vn_h(dd, dst) { return dst < 3 ? 1.5 : 1.0 + (dd.lift ?? 0) * 0.8; }
    }, [def, yaw, dist]);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, `${name}-${vn}.png`) });
  }
}
const withOutline = await page.evaluate(() => { const h = window.__hero; h.set({}); h.step(5); h.outline(true); return h.info(); });
console.log("renderer.info per frame (calls, tris):", JSON.stringify(stats), "with outline:", JSON.stringify(withOutline));
await browser.close();
