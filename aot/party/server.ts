import type * as Party from "partykit/server";

const MAX = 4;

// One room per squad. The first player hosts the titans. Messages are JSON arrays: [type, ...data].
export default class Squad implements Party.Server {
  host: string | null = null;
  ended = false;
  who = new Map<string, [string, string]>();

  constructor(readonly room: Party.Room) {}

  onConnect(c: Party.Connection, ctx: Party.ConnectionContext) {
    const create = new URL(ctx.request.url).searchParams.get("mode") === "create";
    const fail = (why: string) => c.send(JSON.stringify(["e", why]));
    if (this.ended) return fail("This room is closed");
    if (!this.host) {
      if (!create) return fail("No room with that code");
      this.host = c.id;
    } else if (create) return fail("Code in use. Try again");
    else if (this.who.size >= MAX) return fail("Room is full");
    this.who.set(c.id, ["", "cadet"]);
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
    else if (m[0] === "h" && !isHost && this.host) this.room.getConnection(this.host)?.send(JSON.stringify(["h", from.id, ...m.slice(1)]));
  }

  onClose(c: Party.Connection) {
    if (!this.who.delete(c.id)) return;
    if (c.id === this.host) {
      this.ended = true;
      this.room.broadcast(JSON.stringify(["e", "Host left. Room closed"]));
    } else this.roster();
  }

  roster() {
    this.room.broadcast(JSON.stringify(["r", this.host, [...this.who].map(([id, [n, ch]]) => [id, n, ch])]));
  }
}
