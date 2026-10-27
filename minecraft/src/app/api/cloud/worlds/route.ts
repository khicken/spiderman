import { cloudRoute } from "../../../../server/cloud-route";
import { json } from "../../../../server/http";
import { listWorlds } from "../../../../server/worlds";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = (req: Request) => cloudRoute(req, null, async ({ e, uid }) => json(await listWorlds(e.kv, uid)));
