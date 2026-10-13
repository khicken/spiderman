import { WORLD_ID } from "../game/cloud/pack";
import { TooLarge, authed, fail, offline, type Env } from "./http";
import { CloudError } from "./worlds";

type Handler = (a: { e: Env; uid: string; id: string }) => Promise<Response>;

export async function cloudRoute(req: Request, id: string | null, fn: Handler): Promise<Response> {
  const a = await authed(req);
  if (a instanceof Response) return a;
  if (id !== null && !WORLD_ID.test(id)) return fail(400, "Bad world id");
  try {
    return await fn({ e: a.e, uid: a.user.id, id: id ?? "" });
  } catch (err) {
    if (err instanceof CloudError) return fail(err.status, err.message, err.extra);
    if (err instanceof TooLarge) return fail(413, "Request too large");
    console.warn("cloud: request failed", err instanceof Error ? err.message : err);
    return offline();
  }
}
