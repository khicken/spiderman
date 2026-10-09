import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CACHE = join(dirname(fileURLToPath(import.meta.url)), ".cache");
const UA = "kalebkim.com cars map builder (one-off build, cached)";
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cached(name) {
  mkdirSync(CACHE, { recursive: true });
  const f = join(CACHE, name);
  return { f, hit: existsSync(f) };
}

export async function overpass(query) {
  const { f, hit } = cached("op-" + createHash("sha1").update(query).digest("hex").slice(0, 16) + ".json");
  if (hit) return JSON.parse(readFileSync(f, "utf8"));
  for (let k = 0; k < 9; k++) {
    const url = OVERPASS[k % OVERPASS.length];
    try {
      const r = await fetch(url, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(query) });
      const t = await r.text();
      if (r.ok && t.startsWith("{")) {
        const j = JSON.parse(t);
        if (j.remark && /runtime error|timed out/i.test(j.remark)) throw new Error(j.remark);
        writeFileSync(f, t);
        return j;
      }
      console.warn(`  overpass ${r.status} from ${url}, retry`);
    } catch (e) {
      console.warn(`  overpass error ${e.message}, retry`);
    }
    await sleep(3000 * (k + 1));
  }
  throw new Error("overpass failed: " + query.slice(0, 120));
}

export async function terrarium(z, x, y) {
  const { f, hit } = cached(`t-${z}-${x}-${y}.png`);
  if (hit) return readFileSync(f);
  for (let k = 0; k < 5; k++) {
    try {
      const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, { headers: { "User-Agent": UA } });
      if (r.ok) {
        const b = Buffer.from(await r.arrayBuffer());
        writeFileSync(f, b);
        return b;
      }
    } catch {}
    await sleep(1000 * (k + 1));
  }
  throw new Error(`tile ${z}/${x}/${y} failed`);
}
