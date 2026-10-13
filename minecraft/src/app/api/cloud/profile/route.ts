import { cloudRoute } from "../../../../server/cloud-route";
import { fail, json, readJson } from "../../../../server/http";
import { MAX_PROFILE_BYTES, checkProfile, getProfile, putProfile } from "../../../../server/worlds";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = (req: Request) => cloudRoute(req, null, async ({ e, uid }) => json({ profile: await getProfile(e.kv, uid) }));

export const PUT = (req: Request) =>
  cloudRoute(req, null, async ({ e, uid }) => {
    const b = await readJson(req, MAX_PROFILE_BYTES);
    if (!b) return fail(400, "Bad request");
    return json({ profile: await putProfile(e.kv, uid, checkProfile(b)) });
  });
