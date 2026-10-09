"use client";

import { useEffect, useRef, useState } from "react";
import type { Controls, Lobby } from "../../contracts";
import { createNet, newRoomCode, SNAP, type NetPlus } from "../../net";

const COLORS = ["#ff4d4d", "#4dd2ff", "#ffd24d", "#7dff4d", "#d24dff", "#ff9a4d", "#4dffb8", "#ffffff"];
const ctl: Controls = { throttle: 1, brake: 0, steer: 0.3, handbrake: 0, shiftUp: false, shiftDown: false };

type Info = { id: string; host: boolean; hostId: string; offset: number; ping: number; peers: string; connect: number | null; bytes: number; jitter: number; countdown: string; spec: boolean; lobby: string };

export default function NetLab() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const netRef = useRef<NetPlus | null>(null);
  const [info, setInfo] = useState<Info | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    let room = q.get("room");
    if (!room) {
      room = newRoomCode();
      history.replaceState(null, "", `?room=${room}`);
    }
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const net = createNet(room, { id: "me", name: q.get("name") ?? "P" + Math.floor(Math.random() * 90 + 10), color, car: "gt3", me: true, ai: false });
    netRef.current = net;
    const lab = { net, go: null as number | null, goHost: null as number | null, events: [] as string[] };
    (window as unknown as { __net: typeof lab }).__net = lab;
    const off = net.on((e) => {
      lab.events.push(e.type === "finish" ? `finish ${e.id}` : e.type === "lobby" ? `lobby ${e.lobby.startAt}` : `${e.type} ${e.who.name}`);
      if (e.type === "lobby" && e.lobby.startAt !== lab.goHost) { lab.goHost = e.lobby.startAt; lab.go = null; }
    });

    const snap = new Float32Array(SNAP.size);
    const out = new Float32Array(SNAP.size);
    const phase = Math.random() * Math.PI * 2;
    let raf = 0;
    let lastHud = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const hostNow = net.hostNow();
      const a = phase + now / 1000;
      const r = 80;
      snap[0] = Math.cos(a) * r; snap[1] = 0; snap[2] = Math.sin(a) * r;
      const yaw = -a;
      snap[3] = 0; snap[4] = Math.sin(yaw / 2); snap[5] = 0; snap[6] = Math.cos(yaw / 2);
      snap[7] = -Math.sin(a) * r; snap[8] = 0; snap[9] = Math.cos(a) * r;
      snap[10] = 0; snap[11] = -1; snap[12] = 0;
      net.sendCar(snap, ctl);

      const startAt = net.lobby?.startAt ?? null;
      if (startAt !== null && lab.go === null && hostNow >= startAt) lab.go = performance.timeOrigin + now;

      const c = canvas.current;
      const g = c?.getContext("2d");
      if (c && g) {
        g.fillStyle = "#07080a";
        g.fillRect(0, 0, c.width, c.height);
        g.strokeStyle = "#333";
        g.beginPath();
        g.arc(c.width / 2, c.height / 2, r * 2, 0, Math.PI * 2);
        g.stroke();
        const dot = (x: number, z: number, col: string, label: string, stale: boolean) => {
          g.fillStyle = stale ? "#555" : col;
          g.beginPath();
          g.arc(c.width / 2 + x * 2, c.height / 2 + z * 2, 9, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = "#ccc";
          g.font = "12px sans-serif";
          g.fillText(label, c.width / 2 + x * 2 + 12, c.height / 2 + z * 2 + 4);
        };
        dot(snap[0], snap[2], color, "me", false);
        for (const p of net.peers) {
          if (p.me) continue;
          const ok = net.remote(p.id, now, out);
          dot(out[0], out[2], p.color, p.name + (p.id === net.hostId ? " (host)" : ""), !ok);
        }
        if (startAt !== null) {
          const left = (startAt - hostNow) / 1000;
          g.fillStyle = "#fff";
          g.font = "bold 64px sans-serif";
          g.textAlign = "center";
          g.fillText(left > 0 ? String(Math.ceil(left)) : left > -2 ? "GO" : "", c.width / 2, c.height / 2 + 22);
          g.textAlign = "left";
        }
      }
      if (now - lastHud > 120) {
        lastHud = now;
        const l = net.lobby;
        setInfo({
          id: net.id, host: net.host, hostId: net.hostId, offset: net.clockOffset, ping: net.ping,
          peers: net.peers.map((p) => p.name + (p.me ? "*" : "")).join(", "),
          connect: net.stats.connectMs, bytes: net.stats.bytes, jitter: net.stats.jitter,
          countdown: startAt === null ? "-" : ((startAt - hostNow) / 1000).toFixed(2), spec: net.spectating,
          lobby: l ? `${l.map} ${l.mode} ${l.laps}` : "none",
        });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      off();
      net.leave();
    };
  }, []);

  const start = () => {
    const net = netRef.current;
    if (!net?.host) return;
    const l: Lobby = { map: "monaco", mode: "race", laps: 3, weather: "map", hour: "map", startAt: net.hostNow() + 3000, ai: 0 };
    net.setLobby(l);
  };

  return (
    <main className="flex h-dvh flex-col gap-2 bg-[#07080a] p-4 font-mono text-sm text-neutral-300">
      <div id="hud" className="flex flex-wrap gap-x-6">
        <span>id {info?.id.slice(0, 6)}</span>
        <span id="role">{info?.host ? "HOST" : "guest"}</span>
        <span>host {info?.hostId.slice(0, 6)}</span>
        <span id="offset">offset {info?.offset.toFixed(1)} ms</span>
        <span id="ping">ping {info?.ping.toFixed(1)} ms</span>
        <span>jitter {info?.jitter.toFixed(1)} ms</span>
        <span>connect {info?.connect?.toFixed(0) ?? "-"} ms</span>
        <span>msg {info?.bytes} B</span>
        <span>{info?.spec ? "spectating" : "racing"}</span>
        <span>lobby {info?.lobby}</span>
        <span>t {info?.countdown}</span>
      </div>
      <div id="peers">peers {info?.peers}</div>
      <button id="start" onClick={start} disabled={!info?.host} className="w-fit cursor-pointer rounded bg-neutral-800 px-3 py-1 disabled:opacity-40">
        start race
      </button>
      <canvas ref={canvas} width={600} height={500} className="rounded bg-black" />
    </main>
  );
}
