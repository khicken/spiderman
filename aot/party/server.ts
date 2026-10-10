import type * as Party from "partykit/server";

const MAX = 4;
const GRACE_MS = 10000;
const HIT_S = 30;

// One room per squad. The first player hosts the titans. Messages are JSON arrays: [type, ...data].
export default class Squad implements Party.Server {
  host: string | null = null;
  ended = false;
  who = new Map<string, [string, string]>();
  gone: ReturnType<typeof setTimeout> | null = null;
  hostN = 0;
  hitT = new Map<string, [number, number]>();

  constructor(readonly room: Party.Room) {}

  onConnect(c: Party.Connection, ctx: Party.ConnectionContext) {
    const create = new URL(ctx.request.url).searchParams.get("mode") === "create";
    const fail = (why: string) => {
      c.send(JSON.stringify(["e", why]));
      c.close();
    };
    if (this.ended) return fail("This room is closed");
    if (c.id === this.host) {
      if (this.gone) clearTimeout(this.gone);
      this.gone = null;
    } else if (!this.host) {
      if (!create) return fail("No room with that code");
      this.host = c.id;
    } else if (create) return fail("Code in use. Try again");
    else if (this.who.size >= MAX) return fail("Room is full");
    if (c.id === this.host) c.setState({ n: ++this.hostN });
    if (!this.who.has(c.id)) this.who.set(c.id, ["", "cadet"]);
    c.send(JSON.stringify(["w", c.id, this.host]));
    this.roster();
  }

  onMessage(raw: string, from: Party.Connection) {
    if (!this.who.has(from.id) || typeof raw !== "string") return;
    let m: unknown[];
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(m)) return;
    const isHost = from.id === this.host;
    if (m[0] === "n") {
      this.who.set(from.id, [String(m[1] ?? "").slice(0, 12), String(m[2] ?? "cadet").slice(0, 12)]);
      this.roster();
    } else if (m[0] === "p") this.room.broadcast(JSON.stringify(["p", from.id, ...m.slice(1)]), [from.id]);
    else if (m[0] === "s" && isHost) this.room.broadcast(raw, [from.id]);
    else if (m[0] === "h" && !isHost && this.host && this.hitOk(from.id)) this.room.getConnection(this.host)?.send(JSON.stringify(["h", from.id, ...m.slice(1)]));
  }

  onClose(c: Party.Connection) {
    if (!this.who.has(c.id)) return;
    if (c.id === this.host) {
      // A reconnect can open before the old socket closes.
      if ((c.state as { n?: number } | null)?.n !== this.hostN) return;
      this.gone ??= setTimeout(() => {
        this.ended = true;
        this.room.broadcast(JSON.stringify(["e", "Host left. Room closed"]));
      }, GRACE_MS);
      return;
    }
    this.who.delete(c.id);
    this.hitT.delete(c.id);
    this.roster();
  }

  hitOk(id: string) {
    const now = Date.now();
    const t = this.hitT.get(id);
    if (t && now - t[0] < 1000) return ++t[1] <= HIT_S;
    this.hitT.set(id, [now, 1]);
    return true;
  }

  roster() {
    this.room.broadcast(JSON.stringify(["r", this.host, [...this.who].map(([id, [n, ch]]) => [id, n, ch])]));
  }
}
