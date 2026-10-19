import { isEntryKey, packEntries, unpackEntries } from "../../../../../../game/cloud/pack";
import { cloudRoute } from "../../../../../../server/cloud-route";
import { fail, json, readBody, readJson } from "../../../../../../server/http";
import { fetchEntries, putEntries } from "../../../../../../server/worlds";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_UPLOAD = 4 * 1024 * 1024;

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  return cloudRoute(req, (await params).id, async ({ e, uid, id }) => {
    const url = new URL(req.url);
    const baseRev = Number(url.searchParams.get("baseRev"));
    if (!Number.isInteger(baseRev) || baseRev < 0) return fail(400, "Bad revision");
    let entries;
    try {
      entries = unpackEntries(await readBody(req, MAX_UPLOAD), 2000);
    } catch (err) {
      if (err instanceof Error && err.message.includes("pack")) return fail(400, "Bad upload");
      throw err;
    }
    return json(await putEntries(e.kv, e.blobs, uid, id, entries, baseRev, url.searchParams.get("force") === "1"));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  return cloudRoute(req, (await params).id, async ({ e, uid, id }) => {
    const b = await readJson(req, 256 * 1024);
    const keys = b?.keys;
    if (!Array.isArray(keys) || keys.length > 4000 || keys.some((k) => typeof k !== "string" || !isEntryKey(k))) return fail(400, "Bad key list");
    const out = packEntries(await fetchEntries(e.kv, e.blobs, uid, id, keys as string[]));
    return new Response(out.buffer as ArrayBuffer, { headers: { "content-type": "application/octet-stream", "cache-control": "no-store" } });
  });
}
