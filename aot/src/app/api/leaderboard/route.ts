import { Redis } from "@upstash/redis";
import { quotaFor } from "../../titan-waves";

export const dynamic = "force-dynamic";

const TOP = "aot:lb";
const KEEP = 20;
const NAME = /^[A-Za-z0-9 -]{1,12}$/;

const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token, automaticDeserialization: false }) : null;

export type Entry = { name: string; score: number; wave: number; level: number };

const offline = () => Response.json({ error: "offline" }, { status: 503 });

// Generous: every titan of every wave killed at the best cut, plus wave and boss bonuses.
const maxScore = (wave: number) => {
  let max = 10000;
  for (let k = 1; k <= wave; k++) max += quotaFor(k, false) * 3000 + 200 * k + 4000;
  return max;
};

async function top(r: Redis): Promise<Entry[]> {
  const raw = await r.zrange<string[]>(TOP, 0, KEEP - 1, { rev: true, withScores: true });
  const out: Entry[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    try {
      const m = JSON.parse(String(raw[i])) as { n: string; w: number; l: number };
      out.push({ name: m.n, score: Number(raw[i + 1]), wave: m.w, level: m.l });
    } catch {
      console.warn("leaderboard: bad member", raw[i]);
    }
  }
  return out;
}

export async function GET() {
  if (!redis) return offline();
  try {
    return Response.json({ top: await top(redis) });
  } catch (e) {
    console.warn("leaderboard: read failed", e);
    return offline();
  }
}

export async function POST(req: Request) {
  if (!redis) return offline();
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof b?.name === "string" ? b.name.trim() : "";
  const runId = typeof b?.runId === "string" ? b.runId : "";
  const [score, wave, level] = [b?.score, b?.wave, b?.level].map((v) => (Number.isInteger(v) ? (v as number) : -1));
  if (!NAME.test(name) || !/^[a-z0-9]{8,32}$/.test(runId) || score < 0 || wave < 0 || wave > 999 || level < 1 || level > 999)
    return Response.json({ error: "bad input" }, { status: 400 });

  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
    const hits = await redis.incr(`aot:lb:ip:${ip}`);
    if (hits === 1) await redis.expire(`aot:lb:ip:${ip}`, 600);
    if (hits > 10) return Response.json({ error: "slow down" }, { status: 429 });
    if (!(await redis.set(`aot:lb:run:${runId}`, 1, { nx: true, ex: 86400 })))
      return Response.json({ error: "already sent" }, { status: 409 });

    const member = JSON.stringify({ n: name, id: runId.slice(0, 6), w: wave, l: level });
    await redis.zadd(TOP, { score: Math.min(score, maxScore(wave)), member });
    await redis.zremrangebyrank(TOP, 0, -KEEP - 1);
    return Response.json({ top: await top(redis) });
  } catch (e) {
    console.warn("leaderboard: write failed", e);
    return offline();
  }
}
