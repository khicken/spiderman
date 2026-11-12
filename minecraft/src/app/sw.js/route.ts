// Served at /minecraft/sw.js. Prerendered at build time, so VERSION changes on every deploy and
// browsers see a new worker, which drives the "new version available" prompt.
export const dynamic = "force-static";

const VERSION = Date.now().toString(36);

const source = `
const VERSION = ${JSON.stringify(VERSION)};
const BASE = "/minecraft";
const SHELL = "mc-shell-" + VERSION;
const STATIC = "mc-static-" + VERSION;
const API = "mc-api";
const SHELL_URLS = [
  BASE,
  BASE + "/manifest.webmanifest",
  BASE + "/icons/icon-192.png",
  BASE + "/icons/icon-512.png",
  BASE + "/icons/apple-touch-icon.png",
];
const ASSET_RE = /(?:\\/minecraft\\/_next\\/)?static\\/(?:chunks|css|media|[\\w-]{8,})\\/[\\w\\-.\\/~%@]+?\\.(?:m?js|ts|css|woff2?|png|svg|wasm|json)/g;
const MAX_ASSETS = 400;

function assetUrl(m) {
  return m.startsWith(BASE) ? m : BASE + "/_next/" + m;
}

// Crawl the shell HTML and every JS/CSS file it pulls in. Lazy chunks (the game, workers) are only
// named inside other chunks, so following references is what makes single-player work offline.
async function precacheAssets(html) {
  const cache = await caches.open(STATIC);
  const seen = new Set();
  const queue = [];
  const add = (text) => {
    for (const m of text.match(ASSET_RE) || []) {
      const u = assetUrl(m);
      if (!seen.has(u) && seen.size < MAX_ASSETS) {
        seen.add(u);
        queue.push(u);
      }
    }
  };
  add(html);
  while (queue.length) {
    const batch = queue.splice(0, 8);
    await Promise.all(batch.map(async (u) => {
      try {
        const res = await fetch(u);
        if (!res.ok) return;
        await cache.put(u, res.clone());
        if (/\\.(m?js|ts|css)$/.test(u)) add(await res.text());
      } catch {}
    }));
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    const page = await fetch(BASE, { cache: "reload", credentials: "same-origin" });
    if (!page.ok) throw new Error("shell " + page.status);
    await shell.put(BASE, page.clone());
    await Promise.all(SHELL_URLS.slice(1).map((u) => fetch(u).then((r) => r.ok && shell.put(u, r)).catch(() => {})));
    await precacheAssets(await page.text());
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("mc-") && key !== SHELL && key !== STATIC && key !== API) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

async function networkFirst(req, cacheName, key, store) {
  try {
    const res = await fetch(req);
    if (store(res)) {
      const copy = res.clone();
      caches.open(cacheName).then((c) => c.put(key, copy));
    }
    return res;
  } catch (err) {
    const hit = await caches.match(key);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    const copy = res.clone();
    caches.open(STATIC).then((c) => c.put(req, copy));
  }
  return res;
}

async function staleWhileRevalidate(req) {
  const hit = await caches.match(req);
  const net = fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put(req, copy));
    }
    return res;
  });
  if (hit) {
    net.catch(() => {});
    return hit;
  }
  return net;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (path !== BASE && !path.startsWith(BASE + "/")) return;

  // Never touch auth, and drop cached API data whenever the session may change.
  if (path.startsWith(BASE + "/api/auth/")) {
    event.waitUntil(caches.delete(API));
    return;
  }
  if (req.method !== "GET") return;
  if (path === BASE + "/sw.js") return;

  if (path.startsWith(BASE + "/api/")) {
    if (req.cache === "no-store") return;
    event.respondWith(networkFirst(req, API, req, (res) => res.ok && !/no-store|private/i.test(res.headers.get("cache-control") || "")));
    return;
  }
  if (path.startsWith(BASE + "/_next/static/")) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (req.mode === "navigate") {
    const isShell = path === BASE || path === BASE + "/";
    event.respondWith(networkFirst(req, SHELL, isShell ? BASE : req, (res) => isShell && res.ok && res.type === "basic").catch(() => caches.match(BASE)));
    return;
  }
  if (req.headers.get("rsc") || url.searchParams.has("_rsc")) return;
  event.respondWith(staleWhileRevalidate(req));
});
`;

export function GET() {
  return new Response(source, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
      // The worker lives at /minecraft/sw.js but must control /minecraft itself (no trailing slash).
      "service-worker-allowed": "/minecraft",
    },
  });
}
