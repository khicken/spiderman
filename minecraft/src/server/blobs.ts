import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, getKv, isProd, type Kv } from "./kv";

export interface BlobStore {
  readonly kind: "vercel" | "redis" | "file";
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  del(keys: string[]): Promise<void>;
}

const SAFE_KEY = /^[A-Za-z0-9_\-/,.]{1,200}$/;
const check = (key: string) => {
  if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error("bad blob key");
  return key;
};

// Upstash caps one value near 1 MB; base64 grows bytes by 4/3, so 700 KB of bytes stays under it.
export const PART_BYTES = 700 * 1024;

export function redisBlobs(kv: Kv, partBytes = PART_BYTES): BlobStore {
  const head = (key: string) => `mc:blob:${check(key)}`;
  const part = (key: string, i: number) => `${head(key)}:${i}`;
  const parts = async (key: string) => Number(await kv.get(head(key))) || 0;
  return {
    kind: "redis",
    async put(key, data) {
      const old = await parts(key);
      const n = Math.max(1, Math.ceil(data.length / partBytes));
      for (let i = 0; i < n; i++) await kv.set(part(key, i), Buffer.from(data.subarray(i * partBytes, (i + 1) * partBytes)).toString("base64"));
      await kv.set(head(key), String(n));
      if (old > n) await kv.del(Array.from({ length: old - n }, (_, i) => part(key, n + i)));
    },
    async get(key) {
      const n = await parts(key);
      if (!n) return null;
      const vals = await kv.mget(Array.from({ length: n }, (_, i) => part(key, i)));
      if (vals.some((v) => v == null)) return null;
      return new Uint8Array(Buffer.concat(vals.map((v) => Buffer.from(v as string, "base64"))));
    },
    async del(keys) {
      const all: string[] = [];
      for (const key of keys) {
        const n = await parts(key);
        all.push(head(key), ...Array.from({ length: n }, (_, i) => part(key, i)));
      }
      if (all.length) await kv.del(all);
    },
  };
}

export function fileBlobs(dir: string): BlobStore {
  const file = (key: string) => path.join(dir, `${Buffer.from(check(key)).toString("base64url")}.bin`);
  return {
    kind: "file",
    async put(key, data) {
      await mkdir(dir, { recursive: true });
      await writeFile(file(key), data);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(file(key)));
      } catch {
        return null;
      }
    },
    async del(keys) {
      await Promise.all(keys.map((k) => rm(file(k), { force: true })));
    },
  };
}

export function vercelBlobs(token: string): BlobStore {
  const sdk = () => import("@vercel/blob");
  const name = (key: string) => `minecraft/${check(key)}`;
  return {
    kind: "vercel",
    async put(key, data) {
      const { put } = await sdk();
      await put(name(key), Buffer.from(data), { access: "private", token, addRandomSuffix: false, allowOverwrite: true, contentType: "application/octet-stream" });
    },
    async get(key) {
      const { get } = await sdk();
      const r = await get(name(key), { access: "private", token, useCache: false });
      if (!r || r.statusCode !== 200) return null;
      return new Uint8Array(await new Response(r.stream).arrayBuffer());
    },
    async del(keys) {
      if (!keys.length) return;
      const { del } = await sdk();
      for (let i = 0; i < keys.length; i += 500) await del(keys.slice(i, i + 500).map(name), { token });
    },
  };
}

let cached: BlobStore | null | undefined;

export function getBlobs(): BlobStore | null {
  if (cached !== undefined) return cached;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const kv = getKv();
  if (token) cached = vercelBlobs(token);
  else if (kv?.kind === "upstash") cached = redisBlobs(kv);
  else cached = !isProd() && kv ? fileBlobs(path.join(DATA_DIR, "blobs")) : null;
  return cached;
}
