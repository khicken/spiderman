// Player packs live in this browser's IndexedDB only. Nothing is uploaded or bundled.

export interface PackMeta {
  id: string;
  name: string;
  description: string;
  format: number;
  icon: Uint8Array | null;
  vanilla: boolean;
  files: number;
  bytes: number;
  added: number;
}

export type PackFiles = Map<string, Uint8Array>;

const DB = "mc-resource-packs";
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbp)
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("meta", { keyPath: "id" });
        r.result.createObjectStore("files");
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  return dbp;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function listPacks(): Promise<PackMeta[]> {
  const d = await db();
  return req(d.transaction("meta").objectStore("meta").getAll() as IDBRequest<PackMeta[]>);
}

export async function loadPackFiles(id: string): Promise<PackFiles> {
  const d = await db();
  const v = (await req(d.transaction("files").objectStore("files").get(id))) as Record<string, Uint8Array> | undefined;
  return new Map(Object.entries(v ?? {}));
}

export async function savePack(meta: PackMeta, files: PackFiles): Promise<void> {
  const d = await db();
  const t = d.transaction(["meta", "files"], "readwrite");
  t.objectStore("meta").put(meta);
  t.objectStore("files").put(Object.fromEntries(files), meta.id);
  await new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function deletePack(id: string): Promise<void> {
  const d = await db();
  const t = d.transaction(["meta", "files"], "readwrite");
  t.objectStore("meta").delete(id);
  t.objectStore("files").delete(id);
  await new Promise<void>((resolve) => {
    t.oncomplete = () => resolve();
    t.onerror = () => resolve();
  });
}
