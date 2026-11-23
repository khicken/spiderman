#!/usr/bin/env node
// Perf run: a scripted flyover (teleports along the main route) and a Glade fight, per quality preset. Logs per-pass
// GPU ms (EXT_disjoint_timer_query_webgl2), frame ms, draw calls and triangles, and checks them against budget.json.
//
//   node scripts/perf/perf-run.mjs --url http://localhost:3101/zelda --mode desktop|phone [--presets low,medium]
//        [--out result.json] [--shots dir] [--governor 1] [--uncapped 1]
//
// desktop = 1440x900 at DPR 2. phone = DECISIONS.md proxy: 390x844, DPR 3, touch, 4x CPU throttle, held in landscape
// (844x390) because portrait shows the "turn your device" screen. Same pixel count either way.
// --uncapped launches without vsync or a frame-rate limit, so the mean frame ms is the real per-frame cost. Use it for
// GPU cost on ANGLE Metal: its timer queries report the command-buffer span (often 5-8x the true cost), so there the
// per-pass timer split is only a relative guide. Needs a dev server (window.__hm is dev only).
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]?.startsWith("--") ? "1" : all[i + 1] ?? "1"]] : a), []),
);
const url = args.url ?? "http://localhost:3101/zelda";
const mode = args.mode ?? "desktop";
const presets = (args.presets ?? (mode === "phone" ? "low" : "low,medium,high,ultra")).split(",");
const budget = JSON.parse(readFileSync(join(here, "budget.json"), "utf8"));
const SAMPLE_MS = Number(args.sample ?? 2500);

function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = join(homedir(), "Library/Caches/ms-playwright");
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) {
    for (const p of [
      "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
      "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      "chrome-linux/chrome",
    ]) {
      const f = join(root, d, p);
      if (existsSync(f)) return f;
    }
  }
  return undefined;
}

// Route stops (x, z) and where the camera looks: meadow at spawn, Glade, shrine, Mirebrook, Whisperwood, Cinder flank,
// Sunken Lake shore. Teleports keep the run short and the same every time.
const ROUTE = [
  { name: "spawn-meadow", x: -40, z: 330 },
  { name: "glade", x: -35, z: 215 },
  { name: "shrine", x: -60, z: 350 },
  { name: "mirebrook", x: -230, z: 190 },
  { name: "whisperwood", x: -280, z: -110 },
  { name: "cinder-flank", x: 60, z: 80 },
  { name: "lake-shore", x: 180, z: -250 },
];

const viewport = mode === "phone" ? (args.portrait ? { width: 390, height: 844 } : { width: 844, height: 390 }) : { width: 1440, height: 900 };
const dpr = mode === "phone" ? 3 : 2;

const exe = findChromium();
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: [
    "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist",
    ...(args.uncapped ? ["--disable-gpu-vsync", "--disable-frame-rate-limit"] : []),
  ],
});
const results = { mode, uncapped: !!args.uncapped, url, date: new Date().toISOString(), presets: {} };
try {
  for (const q of presets) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, isMobile: mode === "phone", hasTouch: mode === "phone" });
    await ctx.addInitScript((quality) => {
      try {
        localStorage.setItem("hollowmere.settings.v1", JSON.stringify({ quality, dynamicRes: false, master: 0, music: 0, sfx: 0 }));
      } catch {}
    }, q);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    const cdp = await ctx.newCDPSession(page);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForFunction(() => window.__hm?.render && window.__hm?.game, null, { timeout: 180_000 });
    // React Strict Mode mounts twice in dev: wait until the handle stops changing
    await page.evaluate(async () => {
      let h = window.__hm;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 250));
        if (window.__hm === h && i > 6) break;
        h = window.__hm;
      }
    });
    await page.evaluate(async ({ quality, timing }) => {
      const hm = window.__hm;
      hm.game.setSettings({
        quality, dynamicRes: false, master: 0, music: 0, sfx: 0, lookSens: 1, invertY: false, touchScale: 1, showFps: false,
        reduceMotion: false, renderScale: 1, ambience: 0, voice: 0, subtitles: true, hints: false, cameraFollow: true, fpsCap: 0,
      });
      await hm.game.start(null);
      hm.game.pause(false);
      hm.render.setTime?.(10);
      hm.render.setTiming?.(timing);
      // frame recorder: rAF intervals plus the busiest draw-call/triangle frame of the window
      const rec = (window.__perf = { t: [], calls: 0, tris: 0, on: false });
      const tick = (now) => {
        if (rec.on) {
          rec.t.push(now);
          const s = hm.render.stats();
          rec.calls = Math.max(rec.calls, s.calls);
          rec.tris = Math.max(rec.tris, s.tris);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { quality: q, timing: !args.uncapped });
    if (mode === "phone") await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.waitForTimeout(3000);

    const sample = async (name) => {
      await page.evaluate(() => {
        const r = window.__perf;
        r.t = []; r.calls = 0; r.tris = 0; r.on = true;
      });
      await page.waitForTimeout(SAMPLE_MS);
      return page.evaluate((name) => {
        const r = window.__perf;
        r.on = false;
        const d = [];
        for (let i = 1; i < r.t.length; i++) d.push(r.t[i] - r.t[i - 1]);
        d.sort((a, b) => a - b);
        const pct = (p) => (d.length ? d[Math.min(d.length - 1, Math.floor(d.length * p))] : 0);
        const s = window.__hm.render.stats();
        const tm = window.__hm.render.timing;
        const gpu = s.gpu ?? { supported: false, total: 0, passes: {} };
        const passes = Object.fromEntries(Object.entries(gpu.passes).map(([k, v]) => [k, +v.toFixed(2)]));
        const gl = window.__hm.render.renderer.getContext();
        return {
          name, frames: d.length, fps: d.length ? +(1000 / (d.reduce((a, b) => a + b, 0) / d.length)).toFixed(1) : 0,
          mean: d.length ? +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(2) : 0, p50: +pct(0.5).toFixed(1), p95: +pct(0.95).toFixed(1), calls: r.calls, tris: r.tris,
          gpuSupported: gpu.supported, gpuTotal: +gpu.total.toFixed(2), gpuP95: tm ? +tm.p95().toFixed(2) : 0, passes,
          buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], scale: s.scale,
        };
      }, name);
    };

    if (args.ablate) {
      // Render cost per part by subtraction: mean uncapped frame ms with the part hidden vs everything drawn. Parts come
      // from the timing labels (render.ts classify); grass is any mesh with the aCut blade attribute.
      const at = ROUTE.find((r) => r.name === (args.ablate === "1" ? "whisperwood" : args.ablate)) ?? ROUTE[0];
      await page.evaluate(({ x, z }) => window.__hm.teleport(x, z), at);
      await page.evaluate(async () => {
        const r = window.__hm.render;
        r.setTiming(true);
        await new Promise((res) => setTimeout(res, 1500));
        r.setTiming(false);
        const parts = (window.__parts = {});
        r.scene.traverse((o) => {
          if (!o.isMesh && !o.isPoints && !o.isSprite) return;
          const lab = o.geometry?.attributes?.aCut ? "grass" : o.userData.hmTimingLabel ?? "opaque";
          (parts[lab] ??= []).push(o);
        });
      });
      const labels = await page.evaluate(() => Object.keys(window.__parts));
      const run = async (hide) => {
        await page.evaluate((hide) => {
          for (const [k, list] of Object.entries(window.__parts)) for (const o of list) o.visible = hide === "all" || !hide.includes(k) ? hide !== "all" : false;
        }, hide);
        await page.waitForTimeout(500);
        const r = await sample(`-${hide}`);
        return r;
      };
      const f = await run([]);
      const ab = { at: at.name, full: { ms: f.mean, tris: f.tris, calls: f.calls } };
      for (const l of labels) {
        const r = await run([l]);
        ab[l] = { ms: +(f.mean - r.mean).toFixed(2), tris: f.tris - r.tris, calls: f.calls - r.calls };
      }
      const e = await run("all");
      ab.emptyScene = { ms: e.mean, tris: e.tris, calls: e.calls };
      await run([]);
      results.ablation ??= {};
      results.ablation[q] = ab;
      console.log(`ablation ${q} (uncapped frame ms; part = full minus hidden): ${JSON.stringify(ab)}`);
    }

    const rows = [];
    for (const stop of ROUTE) {
      await page.evaluate(({ x, z }) => window.__hm.teleport(x, z), stop);
      await page.waitForTimeout(800);
      rows.push(await sample(stop.name));
    }
    // Glade fight: 4 bramblings around Wren at the Glade
    await page.evaluate(() => {
      const hm = window.__hm;
      hm.teleport(-35, 225);
      const p = hm.player.state.pos;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        hm.emit({ type: "spawn", kind: "brambling", pos: { x: p.x + Math.cos(a) * 5, y: p.y, z: p.z + Math.sin(a) * 5 }, group: "perf" });
      }
    });
    await page.waitForTimeout(800);
    rows.push(await sample("glade-fight"));
    if (args.shots) {
      mkdirSync(args.shots, { recursive: true });
      await page.screenshot({ path: join(args.shots, `${mode}-${q}-glade.png`) });
      // the shrine arch: thin bright stone against the sky, where stair-steps show first
      await page.evaluate(() => {
        const hm = window.__hm;
        const x = -60, z = 362;
        hm.player.place({ x, y: hm.game.world.heightAt(x, z) + 0.1, z }, Math.atan2(0, 18));
        hm.rig.snapBehind();
      });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(args.shots, `${mode}-${q}-shrine.png`) });
    }

    if (args.governor) {
      // shouldRender as game.ts will call it, once per rAF tick, 3 s per state
      const gov = await page.evaluate(async () => {
        const r = window.__hm.render;
        const out = {};
        for (const st of ["play", "idle", "paused", "hidden"]) {
          let n = 0;
          const t0 = performance.now();
          await new Promise((res) => {
            const f = (now) => {
              if (r.shouldRender(now, st)) n++;
              if (now - t0 < 3000) requestAnimationFrame(f);
              else res();
            };
            requestAnimationFrame(f);
          });
          out[st] = +(n / 3).toFixed(1);
        }
        r.shouldRender(performance.now(), "play");
        return out;
      });
      // Hidden tab: a second page in the same headed window does not flip document.hidden, so force the Page Visibility
      // state the way a backgrounded tab reports it, fire visibilitychange, and count frames render() drew over 5 s.
      const f0 = await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
        return { frames: window.__hm.render.frames?.() ?? -1 };
      });
      await page.waitForTimeout(5000);
      const f1 = await page.evaluate(() => {
        const r = { frames: window.__hm.render.frames?.() ?? -1, hidden: document.hidden };
        delete document.hidden;
        delete document.visibilityState;
        document.dispatchEvent(new Event("visibilitychange"));
        return r;
      });
      results.governor = { fpsByState: gov, hiddenTab: { hidden: f1.hidden, framesIn5s: f1.frames - f0.frames } };
      console.log(`governor ${q}: renders/s by state ${JSON.stringify(gov)}; hidden tab (document.hidden=${f1.hidden}), frames in 5 s: ${f1.frames - f0.frames}`);
    }

    const agg = (k) => Math.max(...rows.map((r) => r[k]));
    const sum = {
      calls: agg("calls"), tris: agg("tris"), meanMax: agg("mean"),
      meanAvg: +(rows.reduce((a, r) => a + r.mean, 0) / rows.length).toFixed(2), gpuP95: agg("gpuP95"), gpuAvg: agg("gpuTotal"), frameP95: agg("p95"),
      fpsMin: Math.min(...rows.map((r) => r.fps)),
    };
    const b = budget[q];
    const checks = b
      ? {
          calls: sum.calls <= b.calls, tris: sum.tris <= b.tris, gpu: !rows[0].gpuSupported || sum.gpuP95 <= b.gpuMs,
          ...(mode === "phone" ? { frameP95: sum.frameP95 <= b.phoneFrameP95 } : {}),
        }
      : {};
    results.presets[q] = { rows, sum, budget: b, pass: Object.values(checks).every(Boolean), checks, errors: errors.slice(0, 5) };

    console.log(`\n== ${mode}${args.uncapped ? " uncapped" : ""} ${q}  buffer ${rows[0].buffer.join("x")}  gpu timer ${rows[0].gpuSupported ? "yes" : "no"}`);
    console.log("stop            fps  mean   p50   p95  calls    tris  gpu avg  gpu p95  passes");
    for (const r of rows) {
      const ps = Object.entries(r.passes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
      console.log(
        `${r.name.padEnd(14)} ${String(r.fps).padStart(5)} ${String(r.mean).padStart(5)} ${String(r.p50).padStart(5)} ${String(r.p95).padStart(5)} ${String(r.calls).padStart(6)} ${String(r.tris).padStart(7)} ${String(r.gpuTotal).padStart(8)} ${String(r.gpuP95).padStart(8)}  ${ps}`,
      );
    }
    console.log(`frame ms mean ${sum.meanAvg} (worst stop ${sum.meanMax}); max: calls ${sum.calls}, tris ${sum.tris}, gpu p95 ${sum.gpuP95} ms, frame p95 ${sum.frameP95} ms -> ${results.presets[q].pass ? "PASS" : "FAIL"} ${JSON.stringify(checks)}`);
    if (errors.length) console.log("page errors:", errors.slice(0, 3));
    await ctx.close();
  }
} finally {
  await browser.close();
}
if (args.out) writeFileSync(args.out, JSON.stringify(results, null, 2));
const allPass = Object.values(results.presets).every((p) => p.pass);
process.exitCode = allPass ? 0 : 1;
