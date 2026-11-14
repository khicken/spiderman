// Two-tab multiplayer mob-sync smoke test. Run: node e2e-mobs.mjs (dev server on :3420).
import { chromium } from "playwright-core";

const URL = process.env.URL ?? "http://localhost:3420/minecraft";
const OUT = process.env.OUT ?? "/tmp";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const r1 = (v) => Math.round(v * 10) / 10;

const launch = () =>
  chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
const browser = await launch();
const extraBrowsers = [];

const errors = { host: [], client: [] };
async function mkPage(tag) {
  // A second context in the same Chrome got truncated dev chunks (ERR_CONTENT_LENGTH_MISMATCH); use one Chrome per tab.
  const b = tag === "host" ? browser : await launch();
  if (b !== browser) extraBrowsers.push(b);
  const ctx = await b.newContext({ viewport: { width: 960, height: 600 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  page.on("requestfailed", (r) => errors[tag].push(`[requestfailed] ${r.url().slice(-90)} ${r.failure()?.errorText}`));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors[tag].push(`[${m.type()}] ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => errors[tag].push(`[pageerror] ${String(e).slice(0, 300)}`));
  // Dev server sometimes serves a truncated chunk; reload until the title screen shows.
  for (let i = 0; i < 4; i++) {
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    const ok = await page.waitForFunction(() => [...document.querySelectorAll("img")].some((i) => i.alt === "Singleplayer"), null, { timeout: 30000 }).then(() => true, () => false);
    if (ok) break;
    log(tag, "title screen missing, reloading");
  }
  return page;
}

// Buttons are divs whose label is <img alt=label>; they fire on mousedown.
async function click(page, label, timeout = 20000) {
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
const texts = (page) => page.evaluate(() => [...document.querySelectorAll("img[alt]")].map((i) => i.alt).filter(Boolean));
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` }).catch(() => {});
const waitMc = (page, timeout = 120000) => page.waitForFunction(() => !!window.__mc?.ctx?.player, null, { timeout, polling: 500 });

const results = {};
let exitCode = 0;
try {
  // ---- Host: create world, open to LAN ----
  // Load both tabs before the host world starts eating CPU.
  const host = await mkPage("host");
  const client = await mkPage("client");
  await click(host, "Singleplayer");
  await click(host, "Create New World");
  await sleep(800);
  log("create screen", (await texts(host)).filter((t) => /Cheats|Game Mode|Difficulty/.test(t)));
  await click(host, "Allow Cheats: OFF", 3000).catch(() => log("no cheats toggle"));
  await sleep(300);
  await click(host, "Create New World");
  await waitMc(host);
  log("host in world");
  await sleep(6000);
  for (let i = 0; i < 5; i++) {
    await host.bringToFront();
    await host.keyboard.press("Escape");
    await sleep(1000);
    if ((await texts(host)).includes("Open to LAN")) break;
    log("pause not open, texts:", (await texts(host)).slice(0, 8));
  }
  await click(host, "Open to LAN");
  await sleep(500);
  log("lan texts", (await texts(host)).slice(0, 12));
  await click(host, "Allow Cheats: OFF", 1500).catch(() => {});
  await click(host, "Start LAN World");
  let code = null;
  for (let i = 0; i < 60 && !code; i++) {
    await sleep(500);
    const m = (await texts(host)).join(" | ").match(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/);
    if (m) code = m[0];
  }
  log("room code", code);
  if (!code) throw new Error("no room code; host texts: " + (await texts(host)).slice(0, 15).join(" | "));

  // ---- Client: join ----
  await click(client, "Multiplayer");
  await sleep(800);
  log("mp texts", (await texts(client)).slice(0, 12));
  await click(client, "Direct Connection");
  await sleep(1000);
  log("direct texts", (await texts(client)).slice(0, 12), "inputs", await client.locator("input").count());
  await shot(client, "e2e-client-direct");
  await client.locator("input").last().fill(code, { timeout: 10000 });
  await sleep(300);
  await click(client, "Join Server");
  const t0 = Date.now();
  let joined = false;
  while (Date.now() - t0 < 90000) {
    joined = await client.evaluate(() => !!window.__mc?.ctx?.player && window.__mc?.game?.net?.role === "client").catch(() => false);
    if (joined) break;
    await sleep(1000);
  }
  if (!joined) {
    log("client status", (await texts(client)).slice(0, 10));
    await shot(client, "e2e-client-fail");
    results.connected = false;
    throw new Error("client did not connect in 90s");
  }
  results.connected = true;
  results.connectSeconds = Math.round((Date.now() - t0) / 1000);
  log("CONNECTED in", results.connectSeconds, "s");
  await sleep(8000);

  const H = (fn, arg) => host.evaluate(fn, arg);
  const C = (fn, arg) => client.evaluate(fn, arg);
  const ents = (page) =>
    page.evaluate(() =>
      window.__mc.ctx.entities
        .all()
        .filter((e) => e.type !== "player" && e.type !== "item" && e.type !== "xp_orb")
        .map((e) => ({ id: e.id, type: e.type, x: e.body.pos.x, y: e.body.pos.y, z: e.body.pos.z, health: e.health, data: JSON.parse(JSON.stringify(e.data ?? {}, (k, v) => (v instanceof Set ? [...v] : v))) })),
    );
  const ppos = (page) => page.evaluate(() => { const p = window.__mc.ctx.player.body.pos; return { x: p.x, y: p.y, z: p.z }; });
  const nearestOfType = (list, ref) => list.filter((e) => e.type === ref.type).sort((a, b) => Math.hypot(a.x - ref.x, a.z - ref.z) - Math.hypot(b.x - ref.x, b.z - ref.z))[0];

  log("host setup", await H(() => [window.__mc.cmd("/difficulty normal"), window.__mc.cmd("/gamerule doMobSpawning false"), window.__mc.cmd("/kill @e[type=!player]")]));
  await H(() => window.__mc.time(6000));
  const hp0 = await ppos(host);
  // Separate the players by 48 blocks. A client-local __mc.tp got snapped back by the host, so move the host instead.
  // Host goes creative so it takes no fall damage and mobs can only target the client.
  log("host gamemode", await H(() => window.__mc.cmd("/gamemode creative")));
  await H((p) => window.__mc.tp(p.x - 48, p.y + 30, p.z), hp0);
  await sleep(6000);
  const cp = await ppos(client);
  results.hostAfterMove = await ppos(host);
  const hostSeesClient = await H(() => window.__mc.game.net?.players?.());
  log("host pos", hp0, "client pos", cp);
  results.positions = { host: hp0, client: cp, hostPlayerList: hostSeesClient };

  // ---- Check 1: mirrors near client ----
  const cx = Math.floor(cp.x), cz = Math.floor(cp.z), cy = Math.floor(cp.y) + 1;
  log("summon", await H(({ cx, cz, cy }) => [
    window.__mc.cmd(`/summon pig ${cx + 4} ${cy} ${cz}`),
    window.__mc.cmd(`/summon cow ${cx - 4} ${cy} ${cz + 2}`),
    window.__mc.cmd(`/summon sheep ${cx} ${cy} ${cz + 5}`),
  ], { cx, cz, cy }));
  await sleep(3000);
  const he = await ents(host), ce = await ents(client);
  const near = (list, p) => list.filter((e) => Math.hypot(e.x - p.x, e.z - p.z) < 16);
  results.check1 = {
    host: he.map((e) => `${e.type}#${e.id}@${r1(e.x)},${r1(e.y)},${r1(e.z)}`),
    client: ce.map((e) => `${e.type}#${e.id}@${r1(e.x)},${r1(e.y)},${r1(e.z)}`),
    hostNearClient: near(he, cp).length,
    clientNear: near(ce, cp).length,
  };
  log("check1", results.check1);

  // ---- Check 2: smoothness (pig, pushed on host every 700ms so it moves) ----
  const pigC = ce.find((e) => e.type === "pig");
  const pigH = pigC && nearestOfType(he, pigC);
  if (pigC && pigH) {
    const sampler = (id) => new Promise((res) => {
      const out = [];
      const t0 = performance.now();
      const step = () => {
        const e = window.__mc.ctx.entities.get(id);
        if (e) out.push([performance.now() - t0, e.body.pos.x, e.body.pos.y, e.body.pos.z]);
        if (performance.now() - t0 < 3000) requestAnimationFrame(step);
        else res(out);
      };
      requestAnimationFrame(step);
    });
    const kick = H((id) => {
      let s = 1;
      const iv = setInterval(() => { window.__mc.ctx.entities.knockback(id, s, 0.3, 0.5); s = -s; }, 700);
      setTimeout(() => clearInterval(iv), 3200);
    }, pigH.id);
    const [sc, sh] = await Promise.all([C(sampler, pigC.id), H(sampler, pigH.id), kick]);
    const dist = (a, b) => Math.hypot(a[1] - b[1], a[2] - b[2], a[3] - b[3]);
    const stats = (s) => {
      let maxJump = 0, zero = 0, path = 0;
      for (let i = 1; i < s.length; i++) {
        const d = dist(s[i], s[i - 1]);
        maxJump = Math.max(maxJump, d);
        path += d;
        if (d === 0) zero++;
      }
      return { frames: s.length, fps: Math.round(s.length / 3), maxJump: Math.round(maxJump * 1000) / 1000, zeroFrames: zero, pathLen: r1(path) };
    };
    // Client frames that didn't move while the host copy moved in the same 1-frame window.
    const hostMovedBetween = (ta, tb) => {
      const seg = sh.filter((r) => r[0] >= ta - 20 && r[0] <= tb + 20);
      for (let i = 1; i < seg.length; i++) if (dist(seg[i], seg[i - 1]) > 0) return true;
      return false;
    };
    let frozenWhileHostMoved = 0;
    for (let i = 1; i < sc.length; i++) if (dist(sc[i], sc[i - 1]) === 0 && hostMovedBetween(sc[i - 1][0], sc[i][0])) frozenWhileHostMoved++;
    // body.pos changes once per 20 Hz game tick on both sides (render lerps _px..pos), so also judge per update.
    const updates = (s) => {
      const u = [s[0]];
      for (let i = 1; i < s.length; i++) if (dist(s[i], s[i - 1]) > 0) u.push(s[i]);
      const gaps = u.slice(1).map((r, i) => r[0] - u[i][0]);
      const steps = u.slice(1).map((r, i) => dist(r, u[i]));
      return { updates: u.length - 1, maxGapMs: Math.round(Math.max(0, ...gaps)), gapsOver120ms: gaps.filter((g) => g > 120).length, maxStep: Math.round(Math.max(0, ...steps) * 1000) / 1000 };
    };
    results.check2 = { perFrame: { client: stats(sc), host: stats(sh), clientFrozenWhileHostMoved: frozenWhileHostMoved }, perUpdate: { client: updates(sc), host: updates(sh) } };
  } else results.check2 = "no pig mirror";
  log("check2", results.check2);

  // ---- Check 4: client hits a mirror ----
  {
    // Host checks reach (entity reach + 1 from the client's eye), so hit a fresh cow 2 blocks away.
    const cp4 = await ppos(client);
    await H(({ x, y, z }) => window.__mc.cmd(`/summon cow ${x + 2} ${y} ${z}`), { x: Math.floor(cp4.x) + 0.5, y: Math.floor(cp4.y), z: Math.floor(cp4.z) + 0.5 });
    await sleep(1500);
    const ce2 = await ents(client), he2 = await ents(host);
    const tgt = ce2.filter((e) => e.type === "cow").sort((a, b) => Math.hypot(a.x - cp4.x, a.z - cp4.z) - Math.hypot(b.x - cp4.x, b.z - cp4.z))[0];
    if (tgt) log("cow dist to client", r1(Math.hypot(tgt.x - cp4.x, tgt.z - cp4.z)));
    const hm = tgt && nearestOfType(he2, tgt);
    if (tgt && hm) {
      const before = { host: hm.health, client: tgt.health, hostPos: [r1(hm.x), r1(hm.z)] };
      await C((id) => { window.__mc.ctx.entities.damage(id, 6, "player", "player"); window.__mc.ctx.entities.knockback(id, 0, 1, 0.4); }, tgt.id);
      const clientRightAfter = await C((id) => window.__mc.ctx.entities.get(id)?.health, tgt.id);
      await sleep(1200);
      const ha = await H((id) => { const e = window.__mc.ctx.entities.get(id); return e && { h: e.health, x: e.body.pos.x, z: e.body.pos.z }; }, hm.id);
      const ca = await C((id) => { const e = window.__mc.ctx.entities.get(id); return e && { h: e.health, x: e.body.pos.x, z: e.body.pos.z }; }, tgt.id);
      results.check4 = {
        type: tgt.type, before, clientRightAfter,
        hostAfter: ha && { health: ha.h, pos: [r1(ha.x), r1(ha.z)], moved: r1(Math.hypot(ha.x - hm.x, ha.z - hm.z)) },
        clientAfter1200ms: ca && { health: ca.h, pos: [r1(ca.x), r1(ca.z)] },
      };
    } else results.check4 = "no cow mirror";
    log("check4", results.check4);
  }

  // ---- Check 5: baby zombie with name tag, data + $hp sync ----
  {
    await H(() => window.__mc.time(18000)); // night, so the zombie does not burn mid-check
    const cp2 = await ppos(client);
    log("summon baby", await H(({ x, y, z }) => window.__mc.cmd(`/summon zombie ${x + 8} ${y} ${z + 8} {IsBaby:1b,CustomName:'"Bob"',PersistenceRequired:1b,NoAI:1b}`), { x: Math.floor(cp2.x), y: Math.floor(cp2.y) + 1, z: Math.floor(cp2.z) }));
    await sleep(2500);
    const h0 = (await ents(host)).find((e) => e.type === "zombie");
    const c0 = (await ents(client)).find((e) => e.type === "zombie");
    const pub = (d) => Object.keys(d ?? {}).filter((k) => !k.startsWith("_") && !k.startsWith("$")).sort();
    const r = { host: h0 && { data: h0.data, health: h0.health }, client: c0 && { data: c0.data, health: c0.health } };
    if (h0 && c0) {
      const hk = pub(h0.data), ck = pub(c0.data);
      r.missingOnClient = hk.filter((k) => !ck.includes(k));
      r.extraOnClient = ck.filter((k) => !hk.includes(k));
      r.valueMismatch = hk.filter((k) => ck.includes(k) && JSON.stringify(h0.data[k]) !== JSON.stringify(c0.data[k]));
      const hBefore = await H((id) => window.__mc.ctx.entities.get(id)?.health, h0.id);
      await H((id) => window.__mc.ctx.entities.damage(id, 3, "generic"), h0.id);
      const ht = await H((id) => window.__mc.ctx.entities.get(id)?.health, h0.id);
      const tStart = Date.now();
      let ch = null, matchedMs = null;
      const series = [];
      while (Date.now() - tStart < 2000) {
        const [hh, cc] = await Promise.all([H((id) => window.__mc.ctx.entities.get(id)?.health, h0.id), C((id) => window.__mc.ctx.entities.get(id)?.health, c0.id)]);
        ch = cc;
        series.push(`${Date.now() - tStart}ms h=${hh} c=${cc}`);
        if (cc === ht && matchedMs === null) matchedMs = Date.now() - tStart;
        await sleep(100);
      }
      r.hpSync = { hostBefore: hBefore, hostRightAfterHit: ht, clientMatchedAfterMs: matchedMs, clientFinal: ch, series: series.filter((_, i) => i % 3 === 0) };
      await H((id) => { const e = window.__mc.ctx.entities.get(id); if (e) e.data._remove = true; }, h0.id);
    }
    results.check5 = r;
    log("check5", JSON.stringify(r));
  }

  // ---- Check 3: zombie at night targets/attacks the client ----
  {
    await H(() => window.__mc.time(18000));
    await sleep(1500);
    const cp3 = await ppos(client);
    const chp0 = await C(() => ({ health: window.__mc.ctx.player.health, mode: window.__mc.ctx.player.gameMode }));
    const hhp0 = await H(() => window.__mc.ctx.player.health);
    log("summon z", await H(({ x, y, z }) => window.__mc.cmd(`/summon zombie ${x + 3} ${y} ${z}`), { x: Math.floor(cp3.x), y: Math.floor(cp3.y) + 1, z: Math.floor(cp3.z) }));
    const tStart = Date.now();
    let maxSwing = 0, minHealth = chp0.health, swingSeenAt = null, dmgAt = null, minDist = 99, n = 0;
    while (Date.now() - tStart < 20000) {
      const s = await C(() => {
        const p = window.__mc.ctx.player.body.pos;
        const z = window.__mc.ctx.entities.all().filter((e) => e.type === "zombie" && !e.dead);
        return { swing: Math.max(0, ...z.map((e) => Number(e.data?._swing ?? 0))), n: z.length, hp: window.__mc.ctx.player.health, d: Math.min(99, ...z.map((e) => Math.hypot(e.body.pos.x - p.x, e.body.pos.z - p.z))) };
      });
      n = Math.max(n, s.n);
      minDist = Math.min(minDist, s.d);
      if (s.swing > maxSwing) maxSwing = s.swing;
      if (s.swing > 0 && swingSeenAt === null) swingSeenAt = Date.now() - tStart;
      if (s.hp < minHealth) { minHealth = s.hp; dmgAt ??= Date.now() - tStart; }
      if (swingSeenAt !== null && dmgAt !== null && Date.now() - tStart > 6000) break;
      await sleep(30);
    }
    const hhp1 = await H(() => window.__mc.ctx.player.health);
    results.check3 = { clientMode: chp0.mode, zombiesOnClient: n, minDistToClient: r1(minDist), clientHealthStart: chp0.health, clientHealthMin: minHealth, maxSwing, swingSeenAtMs: swingSeenAt, firstDamageAtMs: dmgAt, hostHealth: [hhp0, hhp1] };
    log("check3", results.check3);
  }
} catch (e) {
  log("ERROR", e.message);
  exitCode = 1;
} finally {
  const dedupe = (a) => [...new Map(a.map((x) => [x.slice(0, 120), x])).values()];
  results.errors = { host: dedupe(errors.host).slice(0, 25), client: dedupe(errors.client).slice(0, 25) };
  console.log("RESULTS", JSON.stringify(results, null, 2));
  for (const b of extraBrowsers) await b.close().catch(() => {});
  await browser.close();
  process.exit(exitCode);
}
