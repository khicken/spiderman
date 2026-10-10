import PartySocket from "partysocket";
import * as THREE from "three";
import type { GameEvent, Player, PlayerMode, TitanPart, Titans } from "./contracts";
import { createMirror, NET_PARTS } from "./net-titans";
import { getCharacter } from "./progression-chars";
import { createScout, SCOUT_HALF, type Scout, type ScoutAnim, type ScoutFrame } from "./scout";

export type SquadOpts = { code: string; create: boolean; name: string; char: string };
export type SquadInfo = { code: string; host: boolean; ready: boolean; names: string[]; ended: string | null };

const HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "localhost:1999";
export const SQUAD_ON = !!process.env.NEXT_PUBLIC_PARTYKIT_HOST || process.env.NODE_ENV !== "production";
const MODES: PlayerMode[] = ["ground", "air", "reel", "wall", "held", "dead"];
const SNAP_S = 1 / 12;
const STATE_S = 1 / 15;
const r2 = (x: number) => Math.round(x * 100) / 100;
const UP = new THREE.Vector3(0, 1, 0);

type Remote = { key: string; scout: Scout; tag: THREE.Sprite; a: number[] | null; b: number[] | null; ta: number; tb: number; frame: ScoutFrame; yaw: number };

function nameTag(name: string) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.font = "600 34px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 6;
  g.strokeStyle = "rgba(0,0,0,0.75)";
  g.strokeText(name, 128, 32);
  g.fillStyle = "#f2ead8";
  g.fillText(name, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }));
  s.scale.set(0.2, 0.05, 1);
  s.renderOrder = 10;
  return s;
}

export function createSquad(scene: THREE.Scene, titans: Titans, o: SquadOpts, onInfo: (i: SquadInfo) => void) {
  const ws = new PartySocket({ host: HOST, room: o.code.toLowerCase(), query: { mode: o.create ? "create" : "join" } });
  const mirror = createMirror(titans);
  const remotes = new Map<string, Remote>();
  const hits: number[][] = [];
  let me = "";
  let host = "";
  let names: string[] = [];
  let ended: string | null = null;
  let clock = 0;
  let stateT = 0;
  let snapT = 0;

  const info = () => onInfo({ code: o.code, host: !!me && me === host, ready: !!me && !ended, names, ended });
  const send = (m: unknown[]) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };
  const drop = (id: string) => {
    const r = remotes.get(id);
    if (!r) return;
    scene.remove(r.scout.root, r.tag);
    r.scout.dispose();
    r.tag.material.map?.dispose();
    r.tag.material.dispose();
    remotes.delete(id);
  };
  const roster = (list: [string, string, string][]) => {
    names = list.map(([, n]) => n || "Scout");
    for (const id of [...remotes.keys()]) if (!list.some(([i]) => i === id)) drop(id);
    for (const [id, n, ch] of list) {
      if (id === me || remotes.get(id)?.key === n + ch) continue;
      drop(id);
      const scout = createScout(getCharacter(ch).look);
      const tag = nameTag(n || "Scout");
      scout.root.visible = tag.visible = false;
      scene.add(scout.root, tag);
      remotes.set(id, { key: n + ch, scout, tag, a: null, b: null, ta: 0, tb: 0, yaw: 0, frame: { anim: "idle", t: 0, k: 0, speed: 0, vel: new THREE.Vector3(), charge: 0, side: 0, broken: false } });
    }
  };

  ws.addEventListener("message", (e: MessageEvent) => {
    let m: unknown[];
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m[0] === "w") {
      me = m[1] as string;
      host = m[2] as string;
      send(["n", o.name, o.char]);
    } else if (m[0] === "r") {
      host = m[1] as string;
      roster(m[2] as [string, string, string][]);
    } else if (m[0] === "p") {
      const r = remotes.get(m[1] as string);
      if (r) {
        r.a = r.b;
        r.ta = r.tb;
        r.b = m.slice(2) as number[];
        r.tb = clock;
      }
      return;
    } else if (m[0] === "s") return mirror.push(m[1] as number[]);
    else if (m[0] === "h") return void hits.push(m.slice(2) as number[]);
    else if (m[0] === "e") {
      ended = m[1] as string;
      ws.close();
    }
    info();
  });

  const pos = new THREE.Vector3();
  const out: GameEvent[] = [];
  return {
    guest: !o.create,
    hit(id: number, part: TitanPart, dmg: number) {
      send(["h", id, NET_PARTS.indexOf(part), Math.round(dmg * 1000) / 1000]);
    },
    update(real: number, dt: number, player: Player, yaw: number): GameEvent[] {
      clock += real;
      stateT += real;
      if (stateT >= STATE_S) {
        stateT = 0;
        const p = player.pos, v = player.vel;
        send(["p", r2(p.x), r2(p.y), r2(p.z), r2(v.x), r2(v.y), r2(v.z), r2(yaw), MODES.indexOf(player.mode)]);
      }
      out.length = 0;
      if (!o.create) {
        const ev = mirror.show(real, dt);
        for (let i = 0; i < ev.length; i++) out.push(ev[i]);
      } else if (titans.net) {
        snapT += real;
        if (snapT >= SNAP_S && remotes.size) {
          snapT = 0;
          send(["s", titans.net.snap()]);
        }
        for (let i = 0; i < hits.length; i++) {
          const part = NET_PARTS[hits[i][1]];
          if (part) out.push(...titans.net.hit(hits[i][0], part, hits[i][2]));
        }
        hits.length = 0;
      }
      for (const r of remotes.values()) {
        const { a, b, frame } = r;
        if (!b) continue;
        const k = a ? Math.min(1, (clock - r.tb) / Math.max(r.tb - r.ta, 0.03)) : 1;
        const s = a ?? b;
        pos.set(s[0] + (b[0] - s[0]) * k, s[1] + (b[1] - s[1]) * k, s[2] + (b[2] - s[2]) * k);
        frame.vel.set(b[3], b[4], b[5]);
        const mode = MODES[b[7]] ?? "air";
        const hsp = Math.hypot(b[3], b[5]);
        const anim: ScoutAnim = mode === "ground" ? (hsp > 0.6 ? "run" : "idle") : mode === "air" ? "air" : mode;
        if (frame.anim !== anim) frame.t = 0;
        frame.anim = anim;
        frame.t += real;
        frame.speed = mode === "ground" || mode === "wall" ? hsp : frame.vel.length();
        r.yaw = hsp > 0.5 ? Math.atan2(b[3], b[5]) : b[6];
        r.scout.root.visible = r.tag.visible = true;
        r.scout.root.position.copy(pos);
        if (mode === "dead") r.scout.root.position.y -= SCOUT_HALF - 0.15;
        r.scout.root.quaternion.setFromAxisAngle(UP, r.yaw);
        r.scout.update(real, frame);
        r.tag.position.copy(pos).y += 1.5;
      }
      return out;
    },
    dispose() {
      ws.close();
      for (const id of [...remotes.keys()]) drop(id);
    },
  };
}

export type Squad = ReturnType<typeof createSquad>;
