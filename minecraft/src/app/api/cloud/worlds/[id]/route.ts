import { isEntryKey } from "../../../../../game/cloud/pack";
import { cloudRoute } from "../../../../../server/cloud-route";
import { fail, json, readJson } from "../../../../../server/http";
import { MAX_META_BYTES, commitWorld, deleteWorld, getWorld } from "../../../../../server/worlds";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return cloudRoute(req, (await params).id, async ({ e, uid, id }) => {
    const w = await getWorld(e.kv, e.blobs, uid, id);
    return w ? json(w) : fail(404, "World not found");
  });
}

export async function PUT(req: Request, { params }: Ctx) {
  return cloudRoute(req, (await params).id, async ({ e, uid, id }) => {
    const b = await readJson(req, MAX_META_BYTES + 512 * 1024);
    if (!b) return fail(400, "Bad request");
    const baseRev = Number(b.baseRev);
    const keep = b.keep;
    if (!Number.isInteger(baseRev) || baseRev < 0) return fail(400, "Bad revision");
    if (keep !== undefined && (!Array.isArray(keep) || keep.length > 20000 || keep.some((k) => typeof k !== "string" || !isEntryKey(k)))) return fail(400, "Bad key list");
    const device = typeof b.device === "string" ? b.device : "";
    return json(await commitWorld(e.kv, e.blobs, uid, id, { meta: b.meta, baseRev, force: b.force === true, device, keep: keep as string[] | undefined }));
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return cloudRoute(req, (await params).id, async ({ e, uid, id }) => {
    await deleteWorld(e.kv, e.blobs, uid, id);
    return json({ ok: true });
  });
}
