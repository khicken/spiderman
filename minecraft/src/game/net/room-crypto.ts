// Keys and identities for a room. Everything a public broker or signaling relay sees is derived from the
// room code with PBKDF2, so the code never travels and guessing it costs a PBKDF2 run per try.
const enc = new TextEncoder();
const SALT = "kalebkim-minecraft/room/v2:";
const ROUNDS = 150_000;
const subtle = () => globalThis.crypto.subtle;

export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export interface RoomKeys {
  topic: string;
  password: string;
  key: CryptoKey;
}

export async function roomKeys(code: string): Promise<RoomKeys> {
  const room = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const base = await subtle().importKey("raw", enc.encode(room), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(SALT + room), iterations: ROUNDS }, base, 512));
  const key = await subtle().importKey("raw", bits.slice(0, 32), "AES-GCM", false, ["encrypt", "decrypt"]);
  return { key, topic: hex(bits.slice(32, 48)), password: hex(bits.slice(48, 64)) };
}

const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;
export const PUB_BYTES = 65;
export const SIG_BYTES = 64;

export const idOfPub = async (pub: Uint8Array) => hex(new Uint8Array(await subtle().digest("SHA-256", pub as BufferSource)).slice(0, 10));

// One key pair per session. The peer id is a hash of the public key, so only its owner can sign as that id.
export interface Identity {
  id: string;
  pub: Uint8Array;
  sign(data: Uint8Array): Promise<Uint8Array>;
}

export async function newIdentity(): Promise<Identity> {
  const pair = (await subtle().generateKey(ECDSA, false, ["sign", "verify"])) as CryptoKeyPair;
  const pub = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
  return { id: await idOfPub(pub), pub, sign: async (d) => new Uint8Array(await subtle().sign(SIGN, pair.privateKey, d as BufferSource)) };
}

const pubCache = new Map<string, Promise<CryptoKey | null>>();

export async function verifyFrom(pub: Uint8Array, sig: Uint8Array, data: Uint8Array): Promise<string | null> {
  if (pub.length !== PUB_BYTES || sig.length !== SIG_BYTES) return null;
  const h = hex(pub);
  let k = pubCache.get(h);
  if (!k) {
    if (pubCache.size > 256) pubCache.clear();
    pubCache.set(h, (k = subtle().importKey("raw", pub as BufferSource, ECDSA, false, ["verify"]).catch(() => null)));
  }
  const key = await k;
  if (!key || !(await subtle().verify(SIGN, key, sig as BufferSource, data as BufferSource).catch(() => false))) return null;
  return idOfPub(pub);
}

export async function seal(key: CryptoKey, plain: Uint8Array): Promise<Uint8Array> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const c = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, plain as BufferSource));
  const out = new Uint8Array(12 + c.length);
  out.set(iv);
  out.set(c, 12);
  return out;
}

export async function open(key: CryptoKey, sealed: Uint8Array): Promise<Uint8Array | null> {
  if (sealed.length < 12 + 16) return null;
  try {
    return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: sealed.subarray(0, 12) as BufferSource }, key, sealed.subarray(12) as BufferSource));
  } catch {
    return null;
  }
}

// Accepts each counter once and refuses anything older than the window, so captured packets cannot be replayed.
export class ReplayWindow {
  private max = -1;
  private seen = new Set<number>();
  constructor(private size = 1024) {}
  accept(n: number): boolean {
    if (n <= this.max - this.size || this.seen.has(n)) return false;
    this.seen.add(n);
    if (n > this.max) {
      this.max = n;
      if (this.seen.size > this.size * 2) for (const k of this.seen) if (k <= this.max - this.size) this.seen.delete(k);
    }
    return true;
  }
}
