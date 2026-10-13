const BASE = "/minecraft/api";

export class ApiError extends Error {
  constructor(public status: number, message: string, public data: Record<string, unknown> = {}) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; json?: unknown; body?: Uint8Array; raw?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "x-mc-client": "1" };
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  } else if (init.body) {
    headers["content-type"] = "application/octet-stream";
    body = init.body as BodyInit;
  }
  let res: Response;
  try {
    res = await fetch(BASE + path, { method: init.method ?? "GET", headers, body, credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiError(0, "Offline");
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ApiError(res.status, typeof data.error === "string" ? data.error : `Error ${res.status}`, data);
  }
  return (init.raw ? new Uint8Array(await res.arrayBuffer()) : await res.json()) as T;
}
