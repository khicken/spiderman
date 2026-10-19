"use client";

import { useState } from "react";
import type { GameMode } from "../contracts";
import { cleanRoomCode, validCode } from "../net/protocol";
import { Text, useGui } from "./gui";
import { pixelUrl } from "./sprites";
import { Button, ListArea, Screen, TextField, onOff, useKeyDown } from "./widgets";

export interface ServerRow {
  name: string;
  code: string;
}

const serverIcon = () =>
  pixelUrl("server_icon", 32, 32, (x, y) => {
    const n = ((x * 5 + y * 11) ^ (x * y * 3)) % 7;
    if (x < 2 || y < 2 || x > 29 || y > 29) return 0xff3c3c3c;
    return n < 2 ? 0xff7d7d7d : n < 5 ? 0xff8f8f8f : 0xff6b6b6b;
  });

function Bars({ x, y, level }: { x: number; y: number; level: number }) {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{ position: "absolute", left: x + i * 2, top: y + 6 - i - 1, width: 1, height: i + 2, background: i < level ? "#00ff21" : "#3a3a3a" }} />
      ))}
    </>
  );
}

export interface MultiplayerScreenProps {
  servers: ServerRow[];
  name: string;
  onName: (n: string) => void;
  onJoin: (code: string) => void;
  onDirect: () => void;
  onDelete: (code: string) => void;
  onBack: () => void;
}

export function MultiplayerScreen({ servers, name, onName, onJoin, onDirect, onDelete, onBack }: MultiplayerScreenProps) {
  const { width, height } = useGui();
  const [sel, setSel] = useState<string | null>(null);
  const [last, setLast] = useState({ code: "", t: 0 });
  useKeyDown((e) => {
    if (e.key === "Escape") onBack();
    if (e.key === "Enter" && sel) onJoin(sel);
  });
  const top = 46;
  const bottom = height - 64;
  const rowH = 36;
  const rowW = 270;
  const left = Math.floor(width / 2 - rowW / 2);
  const lanY = 4 + servers.length * rowH;
  return (
    <Screen background="menu">
      <Text text="Play Multiplayer" x={width / 2} y={8} align="center" />
      <Text text="Name:" x={Math.floor(width / 2 - 104)} y={26} color={0xa0a0a0} align="right" />
      <TextField x={Math.floor(width / 2 - 100)} y={20} width={200} value={name} onChange={onName} maxLength={16} hint="Player name" />
      <ListArea top={top} bottom={bottom}>
        {servers.map((s, i) => {
          const y = 4 + i * rowH;
          const on = s.code === sel;
          return (
            <div
              key={s.code}
              onMouseDown={() => {
                const now = performance.now();
                if (last.code === s.code && now - last.t < 250) onJoin(s.code);
                setLast({ code: s.code, t: now });
                setSel(s.code);
              }}
              style={{ position: "absolute", left: left - 2, top: y - 2, width: rowW + 4, height: rowH, background: on ? "#000" : undefined, boxShadow: on ? "inset 0 0 0 1px #fff" : undefined, cursor: "pointer" }}
            >
              <img alt="" src={serverIcon()} width={32} height={32} draggable={false} style={{ position: "absolute", left: 2, top: 2, imageRendering: "pixelated" }} />
              <Text text={s.name} x={37} y={3} />
              <Text text={`Room code ${s.code}`} color={0x808080} x={37} y={14} />
              <Text text="Peer-to-peer LAN world" color={0x808080} x={37} y={24} />
              <Bars x={rowW - 12} y={3} level={5} />
            </div>
          );
        })}
        <div style={{ position: "absolute", left: 0, top: lanY, width, height: rowH }}>
          <Text text="Scanning for games on your local network" color={0xffffff} x={width / 2} y={6} align="center" />
          <Text text={"o O o".slice(0, 1 + (Math.floor(performance.now() / 300) % 5))} color={0x808080} x={width / 2} y={18} align="center" />
        </div>
      </ListArea>
      <Button x={width / 2 - 154} y={height - 52} width={100} label="Join Server" disabled={!sel} onClick={() => sel && onJoin(sel)} />
      <Button x={width / 2 - 50} y={height - 52} width={100} label="Direct Connection" onClick={onDirect} />
      <Button x={width / 2 + 54} y={height - 52} width={100} label="Add Server" onClick={onDirect} />
      <Button x={width / 2 - 154} y={height - 28} width={74} label="Edit" disabled />
      <Button x={width / 2 - 76} y={height - 28} width={74} label="Delete" disabled={!sel} onClick={() => sel && (onDelete(sel), setSel(null))} />
      <Button x={width / 2 + 2} y={height - 28} width={74} label="Refresh" onClick={() => setSel(null)} />
      <Button x={width / 2 + 80} y={height - 28} width={74} label="Back" onClick={onBack} />
    </Screen>
  );
}

export function DirectConnectScreen({ initial = "", onJoin, onCancel }: { initial?: string; onJoin: (code: string) => void; onCancel: () => void }) {
  const { width, height } = useGui();
  const [code, setCode] = useState(initial);
  const ok = validCode(cleanRoomCode(code));
  useKeyDown((e) => e.key === "Escape" && onCancel());
  return (
    <Screen background="menu">
      <Text text="Direct Connection" x={width / 2} y={20} align="center" />
      <Text text="Room Code" color={0xa0a0a0} x={width / 2 - 100} y={100} />
      <TextField x={width / 2 - 100} y={116} width={200} value={code} onChange={(v) => setCode(v.toUpperCase())} onEnter={() => ok && onJoin(cleanRoomCode(code))} maxLength={14} hint="ABCD-EFGH-JKLM" autoFocus />
      <Button x={width / 2 - 100} y={Math.floor(height / 4 + 96 + 12)} label="Join Server" disabled={!ok} onClick={() => onJoin(cleanRoomCode(code))} />
      <Button x={width / 2 - 100} y={Math.floor(height / 4 + 120 + 12)} label="Cancel" onClick={onCancel} />
    </Screen>
  );
}

const MODES: GameMode[] = ["survival", "spectator", "creative", "adventure"];
const MODE_NAME: Record<GameMode, string> = { survival: "Survival", creative: "Creative", adventure: "Adventure", spectator: "Spectator" };

export function OpenToLanScreen({ initialMode, onStart, onCancel }: { initialMode: GameMode; onStart: (o: { gameMode: GameMode; cheats: boolean }) => void; onCancel: () => void }) {
  const { width, height } = useGui();
  const [mode, setMode] = useState<GameMode>(initialMode);
  const [cheats, setCheats] = useState(false);
  useKeyDown((e) => e.key === "Escape" && onCancel());
  return (
    <Screen background="ingame">
      <Text text="Open to LAN" x={width / 2} y={50} align="center" />
      <Text text="Settings for Other Players" x={width / 2} y={82} align="center" />
      <Button x={width / 2 - 155} y={100} width={150} label={`Game Mode: ${MODE_NAME[mode]}`} onClick={() => setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length])} />
      <Button x={width / 2 + 5} y={100} width={150} label={`Allow Cheats: ${onOff(cheats)}`} onClick={() => setCheats(!cheats)} />
      <Text text="Players join with the room code shown in chat" color={0xa0a0a0} x={width / 2} y={132} align="center" />
      <Button x={width / 2 - 155} y={height - 28} width={150} label="Start LAN World" onClick={() => onStart({ gameMode: mode, cheats })} />
      <Button x={width / 2 + 5} y={height - 28} width={150} label="Cancel" onClick={onCancel} />
    </Screen>
  );
}

export function ConnectingScreen({ status, onCancel }: { status: string; onCancel: () => void }) {
  const { width, height } = useGui();
  useKeyDown((e) => e.key === "Escape" && onCancel());
  return (
    <Screen background="dirt">
      <Text text={status} x={width / 2} y={Math.floor(height / 2 - 50)} align="center" />
      <Button x={width / 2 - 100} y={Math.floor(height / 4 + 120 + 12)} label="Cancel" onClick={onCancel} />
    </Screen>
  );
}

export function DisconnectedScreen({ title, reason, onBack }: { title: string; reason: string; onBack: () => void }) {
  const { width, height } = useGui();
  return (
    <Screen background="dirt">
      <Text text={title} color={0xa0a0a0} x={width / 2} y={Math.floor(height / 2 - 30)} align="center" />
      <Text text={reason} x={width / 2} y={Math.floor(height / 2 - 10)} align="center" />
      <Button x={width / 2 - 100} y={Math.floor(height / 2 + 20)} label="Back to Server List" onClick={onBack} />
    </Screen>
  );
}

export function PlayerListOverlay({ players }: { players: { name: string; ping: number }[] }) {
  const { width } = useGui();
  const nameW = Math.max(60, ...players.map((p) => p.name.length * 6));
  const colW = nameW + 18;
  const cols = Math.ceil(players.length / 20);
  const rows = Math.ceil(players.length / cols);
  const total = cols * colW + (cols - 1) * 5;
  const x0 = Math.floor(width / 2 - total / 2);
  return (
    <div style={{ position: "absolute", left: x0 - 1, top: 9, width: total + 2, height: rows * 9 + 1, background: "rgba(0,0,0,0.5)", pointerEvents: "none" }}>
      {players.map((p, i) => {
        const c = Math.floor(i / rows), r = i % rows;
        const x = 1 + c * (colW + 5), y = 1 + r * 9;
        const level = p.ping < 150 ? 5 : p.ping < 300 ? 4 : p.ping < 600 ? 3 : p.ping < 1000 ? 2 : 1;
        return (
          <div key={p.name} style={{ position: "absolute", left: x, top: y, width: colW, height: 8, background: "rgba(255,255,255,0.13)" }}>
            <Text text={p.name} x={1} y={0} />
            <Bars x={colW - 11} y={0} level={level} />
          </div>
        );
      })}
    </div>
  );
}
