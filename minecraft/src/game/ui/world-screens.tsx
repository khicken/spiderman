"use client";

import { useMemo, useState } from "react";
import type { GameMode, Rules } from "../contracts";
import { Text, useGui } from "./gui";
import { Button, ListArea, Screen, TextField, onOff, playClick, useKeyDown } from "./widgets";
import { textWidth } from "./font";
import { pixelUrl } from "./sprites";

export interface WorldListEntry {
  id: string;
  name: string;
  lastPlayed: number; // epoch ms
  gameMode: GameMode;
  hardcore?: boolean;
  cheats?: boolean;
  icon?: string; // image URL, optional
}

export interface ConfirmScreenProps {
  title: string;
  message: string;
  yes: string;
  no: string;
  onYes: () => void;
  onNo: () => void;
}

export function ConfirmScreen({ title, message, yes, no, onYes, onNo }: ConfirmScreenProps) {
  const { width, height } = useGui();
  useKeyDown((e) => e.key === "Escape" && onNo());
  return (
    <Screen background="menu">
      <Text text={title} x={width / 2} y={70} align="center" />
      <Text text={message} x={width / 2} y={90} align="center" />
      <Button x={width / 2 - 155} y={Math.floor(height / 6 + 96)} width={150} label={yes} onClick={onYes} />
      <Button x={width / 2 + 5} y={Math.floor(height / 6 + 96)} width={150} label={no} onClick={onNo} />
    </Screen>
  );
}

const MODE_LABEL: Record<GameMode, string> = { survival: "Survival", creative: "Creative", adventure: "Adventure", spectator: "Spectator" };

const fmtDate = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${String(d.getFullYear()).slice(2)}, ${d.getHours() % 12 || 12}:${p(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`;
};

const defaultIcon = () =>
  pixelUrl("world_icon", 32, 32, (x, y) => {
    const n = ((x * 7 + y * 13) ^ (x * y)) % 5;
    if (y < 9) return n < 2 ? 0xff5b8c32 : n < 4 ? 0xff6fa83e : 0xff4f7a2b;
    return n < 2 ? 0xff79553a : n < 4 ? 0xff8b6a4a : 0xff5f412b;
  });

export interface SelectWorldScreenProps {
  worlds: WorldListEntry[];
  onPlay: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onCancel: () => void;
}

export function SelectWorldScreen({ worlds, onPlay, onCreate, onDelete, onCancel }: SelectWorldScreenProps) {
  const { width, height } = useGui();
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<WorldListEntry | null>(null);
  const [scroll, setScroll] = useState(0);
  const [lastClick, setLastClick] = useState({ id: "", t: 0 });
  const list = useMemo(
    () => [...worlds].sort((a, b) => b.lastPlayed - a.lastPlayed).filter((w) => w.name.toLowerCase().includes(search.toLowerCase())),
    [worlds, search],
  );
  const selected = list.find((w) => w.id === sel) ?? null;
  useKeyDown((e) => {
    if (confirm) return;
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter" && selected) onPlay(selected.id);
  });
  if (confirm)
    return (
      <ConfirmScreen
        title="Are you sure you want to delete this world?"
        message={`'${confirm.name}' will be lost forever! (A long time!)`}
        yes="Delete"
        no="Cancel"
        onYes={() => {
          onDelete(confirm.id);
          setConfirm(null);
          setSel(null);
        }}
        onNo={() => setConfirm(null)}
      />
    );
  const top = 48;
  const bottom = height - 64;
  const rowH = 36;
  const rowW = 270;
  const left = Math.floor(width / 2 - rowW / 2);
  const maxScroll = Math.max(0, list.length * rowH + 4 - (bottom - top));
  const sc = Math.min(scroll, maxScroll);
  return (
    <Screen background="menu">
      <Text text="Select World" x={width / 2} y={8} align="center" />
      <TextField x={Math.floor(width / 2 - 100)} y={22} width={200} value={search} onChange={setSearch} hint="Search..." autoFocus />
      <ListArea top={top} bottom={bottom}>
        <div onWheel={(e) => setScroll(Math.max(0, Math.min(maxScroll, sc + Math.sign(e.deltaY) * rowH / 2)))} style={{ position: "absolute", inset: 0 }}>
          {list.map((w, i) => {
            const y = 4 + i * rowH - sc;
            if (y < -rowH || y > bottom - top) return null;
            const isSel = w.id === sel;
            const mode = w.hardcore ? "§4Hardcore Mode!" : `${MODE_LABEL[w.gameMode]} Mode`;
            return (
              <div
                key={w.id}
                onMouseDown={() => {
                  const now = performance.now();
                  if (lastClick.id === w.id && now - lastClick.t < 250) onPlay(w.id);
                  setLastClick({ id: w.id, t: now });
                  setSel(w.id);
                }}
                style={{
                  position: "absolute",
                  left: left - 2,
                  top: y - 2,
                  width: rowW + 4,
                  height: rowH,
                  background: isSel ? "#000" : undefined,
                  boxShadow: isSel ? "inset 0 0 0 1px #fff" : undefined,
                  cursor: "pointer",
                }}
              >
                <img alt="" src={w.icon ?? defaultIcon()} width={32} height={32} draggable={false} style={{ position: "absolute", left: 2, top: 2, imageRendering: "pixelated" }} />
                <Text text={w.name} x={37} y={3} />
                <Text text={`${w.name.replace(/[^\w -]/g, "_")} (${fmtDate(w.lastPlayed)})`} color={0x808080} x={37} y={14} />
                <Text text={`${mode}${w.cheats ? ", Cheats" : ""}, Version: 1.21`} color={0x808080} x={37} y={24} />
              </div>
            );
          })}
          {list.length === 0 && <Text text={search ? "No worlds found" : "No worlds yet"} color={0xa0a0a0} x={width / 2} y={20} align="center" />}
        </div>
      </ListArea>
      <Button x={width / 2 - 154} y={height - 52} width={150} label="Play Selected World" disabled={!selected} onClick={() => selected && onPlay(selected.id)} />
      <Button x={width / 2 + 4} y={height - 52} width={150} label="Create New World" onClick={onCreate} />
      <Button x={width / 2 - 154} y={height - 28} width={72} label="Edit" disabled />
      <Button x={width / 2 - 76} y={height - 28} width={72} label="Delete" disabled={!selected} onClick={() => selected && setConfirm(selected)} />
      <Button x={width / 2 + 4} y={height - 28} width={72} label="Re-Create" disabled />
      <Button x={width / 2 + 82} y={height - 28} width={72} label="Back" onClick={onCancel} />
    </Screen>
  );
}

// Java String.hashCode, the vanilla rule for a seed that is not a number.
export function seedFromString(s: string): number {
  const t = s.trim();
  if (!t) return Math.floor(Math.random() * 0x7fffffff) * (Math.random() < 0.5 ? -1 : 1);
  if (/^-?\d+$/.test(t) && Math.abs(Number(t)) <= Number.MAX_SAFE_INTEGER) return Number(t);
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (Math.imul(31, h) + t.charCodeAt(i)) | 0;
  return h;
}

export type CreateMode = "survival" | "hardcore" | "creative";

export interface NewWorldOptions {
  name: string;
  gameMode: GameMode;
  hardcore: boolean;
  difficulty: Rules["difficulty"];
  cheats: boolean;
  seed: number;
  worldType: string;
  structures: boolean;
  bonusChest: boolean;
  rules?: Partial<Rules>;
}

export interface CreateWorldScreenProps {
  onCreate: (o: NewWorldOptions) => void;
  onCancel: () => void;
  worldTypes?: string[];
}

const MODE_DESC: Record<CreateMode, string> = {
  survival: "Search for resources, craft, gain levels, health and hunger",
  hardcore: "Same as Survival Mode, locked at hardest difficulty, and one life only",
  creative: "Unlimited resources, free flying and destroy blocks instantly",
};
const DIFFS: Rules["difficulty"][] = ["peaceful", "easy", "normal", "hard"];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
type GameRules = Pick<Rules, "keepInventory" | "doDaylightCycle" | "doMobSpawning" | "mobGriefing" | "doFireTick" | "randomTickSpeed">;
const DEFAULT_RULES: GameRules = { keepInventory: false, doDaylightCycle: true, doMobSpawning: true, mobGriefing: true, doFireTick: true, randomTickSpeed: 3 };

export function CreateWorldScreen({ onCreate, onCancel, worldTypes = ["Default"] }: CreateWorldScreenProps) {
  const { width, height } = useGui();
  const [tab, setTab] = useState<"game" | "world" | "more">("game");
  const [name, setName] = useState("New World");
  const [mode, setMode] = useState<CreateMode>("survival");
  const [diff, setDiff] = useState<Rules["difficulty"]>("normal");
  const [cheats, setCheats] = useState(false);
  const [seed, setSeed] = useState("");
  const [type, setType] = useState(0);
  const [structures, setStructures] = useState(true);
  const [bonus, setBonus] = useState(false);
  const [rules, setRules] = useState<GameRules>(DEFAULT_RULES);
  const [editRules, setEditRules] = useState(false);
  const create = () =>
    onCreate({
      name: name.trim() || "New World",
      gameMode: mode === "creative" ? "creative" : "survival",
      hardcore: mode === "hardcore",
      difficulty: mode === "hardcore" ? "hard" : diff,
      cheats: mode === "hardcore" ? false : cheats,
      seed: seedFromString(seed),
      worldType: worldTypes[type],
      structures,
      bonusChest: bonus,
      rules,
    });
  useKeyDown((e) => !editRules && e.key === "Escape" && onCancel());
  if (editRules) return <GameRulesScreen rules={rules} onDone={(r) => { setRules(r); setEditRules(false); }} onCancel={() => setEditRules(false)} />;
  const cx = Math.floor(width / 2);
  const bx = cx - 105;
  const tabW = Math.floor((Math.min(400, width) - 28) / 3 / 2) * 2;
  const tabX = cx - Math.floor((tabW * 3) / 2);
  return (
    <Screen background="menu">
      <div style={{ position: "absolute", left: 0, top: 0, width, height: 24, background: "rgba(0,0,0,0.45)" }} />
      <Separator y={22} width={width} />
      <TabButton x={tabX} w={tabW} label="Game" active={tab === "game"} onClick={() => setTab("game")} />
      <TabButton x={tabX + tabW} w={tabW} label="World" active={tab === "world"} onClick={() => setTab("world")} />
      <TabButton x={tabX + tabW * 2} w={tabW} label="More" active={tab === "more"} onClick={() => setTab("more")} />
      {tab === "game" && (
        <>
          <Text text="World Name" color={0xe0e0e0} x={bx + 1} y={40} />
          <TextField x={bx + 1} y={52} width={208} value={name} onChange={setName} autoFocus onEnter={create} />
          <Button
            x={bx}
            y={82}
            width={210}
            label={`Game Mode: ${cap(mode)}`}
            onClick={() => {
              const next = mode === "survival" ? "hardcore" : mode === "hardcore" ? "creative" : "survival";
              setMode(next);
              setCheats(next === "creative");
            }}
          />
          <Text text={MODE_DESC[mode]} color={0xa0a0a0} x={cx} y={106} align="center" />
          <Button x={bx} y={120} width={210} label={`Difficulty: ${mode === "hardcore" ? "Hard" : cap(diff)}`} disabled={mode === "hardcore"} onClick={() => setDiff(DIFFS[(DIFFS.indexOf(diff) + 1) % 4])} />
          <Button x={bx} y={144} width={210} label={`Allow Cheats: ${onOff(mode === "hardcore" ? false : cheats)}`} disabled={mode === "hardcore"} onClick={() => setCheats(!cheats)} />
          <Text text="Commands like /gamemode, /experience" color={0xa0a0a0} x={cx} y={168} align="center" />
        </>
      )}
      {tab === "world" && (
        <>
          <Button x={bx} y={40} width={150} label={`World Type: ${worldTypes[type]}`} onClick={() => setType((type + 1) % worldTypes.length)} />
          <Button x={bx + 154} y={40} width={56} label="Customize" disabled />
          <Text text="Seed for the World Generator" color={0xe0e0e0} x={bx + 1} y={72} />
          <TextField x={bx + 1} y={84} width={208} value={seed} onChange={setSeed} hint="Leave blank for a random seed" maxLength={32} />
          <Button x={bx} y={114} width={210} label={`Generate Structures: ${onOff(structures)}`} onClick={() => setStructures(!structures)} />
          <Button x={bx} y={138} width={210} label={`Bonus Chest: ${onOff(bonus)}`} onClick={() => setBonus(!bonus)} />
        </>
      )}
      {tab === "more" && (
        <>
          <Button x={bx} y={40} width={210} label="Game Rules" onClick={() => setEditRules(true)} />
          <Button x={bx} y={64} width={210} label="Data Packs" disabled />
          <Button x={bx} y={88} width={210} label="Experiments" disabled />
        </>
      )}
      <div style={{ position: "absolute", left: 0, top: height - 36, width, height: 36, background: "rgba(0,0,0,0.45)" }} />
      <Separator y={height - 36} width={width} flip />
      <Button x={cx - 155} y={height - 28} width={150} label="Create New World" onClick={create} />
      <Button x={cx + 5} y={height - 28} width={150} label="Cancel" onClick={onCancel} />
    </Screen>
  );
}

// 1.21 header_separator / footer_separator: one light and one dark row.
function Separator({ y, width, flip }: { y: number; width: number; flip?: boolean }) {
  const light = "rgba(255,255,255,0.25)";
  const dark = "rgba(0,0,0,0.75)";
  return (
    <>
      <div style={{ position: "absolute", left: 0, top: y, width, height: 1, background: flip ? dark : light }} />
      <div style={{ position: "absolute", left: 0, top: y + 1, width, height: 1, background: flip ? light : dark }} />
    </>
  );
}

function TabButton({ x, w, label, active, onClick }: { x: number; w: number; label: string; active: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const h = 24;
  const body = active ? "#5f5f5f" : hover ? "#4a4a4a" : "#2c2c2c";
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseDown={(e) => {
        if (e.button !== 0 || active) return;
        playClick();
        onClick();
      }}
      style={{
        position: "absolute",
        left: x,
        top: 0,
        width: w,
        height: active ? h : h - 2,
        background: body,
        boxShadow: active ? "inset 1px 1px 0 #a0a0a0, inset -1px 0 0 #000, inset 0 0 0 1px #000" : `inset 0 0 0 1px ${hover ? "#fff" : "#000"}`,
        pointerEvents: "auto",
        cursor: "pointer",
      }}
    >
      <Text text={label} color={active ? 0xffffff : 0xa0a0a0} x={w / 2} y={8} align="center" />
      {active && <div style={{ position: "absolute", left: Math.floor(w / 2 - textWidth(label) / 2), top: 17, width: textWidth(label) - 1, height: 1, background: "#fff" }} />}
    </div>
  );
}

const RULE_GROUPS: [string, [keyof GameRules, string][]][] = [
  ["Player", [["keepInventory", "Keep inventory after death"]]],
  ["Mobs", [["doMobSpawning", "Spawn mobs"], ["mobGriefing", "Allow destructive mob actions"]]],
  ["Updates", [["doDaylightCycle", "Advance time of day"], ["doFireTick", "Update fire"], ["randomTickSpeed", "Random tick speed rate"]]],
];

function GameRulesScreen({ rules, onDone, onCancel }: { rules: GameRules; onDone: (r: GameRules) => void; onCancel: () => void }) {
  const { width, height } = useGui();
  const [r, setR] = useState(rules);
  useKeyDown((e) => e.key === "Escape" && onCancel());
  const cx = Math.floor(width / 2);
  const rows: ({ cat: string } | { key: keyof GameRules; label: string })[] = [];
  for (const [cat, list] of RULE_GROUPS) {
    rows.push({ cat });
    for (const [key, label] of list) rows.push({ key, label });
  }
  return (
    <Screen background="menu">
      <Text text="Edit Game Rules" x={cx} y={13} align="center" />
      <ListArea top={33} bottom={height - 33}>
        {rows.map((row, i) => {
          const y = 4 + i * 24;
          if ("cat" in row) return <Text key={i} text={row.cat} color={0xffff55} x={cx} y={y + 8} align="center" />;
          const v = r[row.key];
          return (
            <div key={i}>
              <Text text={row.label} x={cx - 140} y={y + 6} />
              {typeof v === "boolean" ? (
                <Button x={cx + 96} y={y} width={44} label={onOff(v)} onClick={() => setR({ ...r, [row.key]: !v })} />
              ) : (
                <TextField x={cx + 97} y={y + 1} width={42} height={18} value={String(v)} maxLength={4} onChange={(t) => setR({ ...r, [row.key]: Math.max(0, Number(t.replace(/\D/g, "")) || 0) })} />
              )}
            </div>
          );
        })}
      </ListArea>
      <Button x={cx - 155} y={height - 27} width={150} label="Done" onClick={() => onDone(r)} />
      <Button x={cx + 5} y={height - 27} width={150} label="Cancel" onClick={onCancel} />
    </Screen>
  );
}
