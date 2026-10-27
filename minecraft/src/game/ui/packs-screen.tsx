"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CLAUDE_ID, listAllPacks, removePack, selectedPacks, setSelectedPacks, type PackMeta } from "../packs";
import { claudeIcon } from "../packs/claude-icon";
import { importDrop, importFileList } from "../packs/import";
import { wrapText } from "./font";
import { Text, useGui } from "./gui";
import { packUrl, pixelUrl } from "./sprites";
import { Button, ListArea, Screen, useKeyDown, type BackgroundKind } from "./widgets";

const ROW = 36;
const LIST_W = 200;

const CLAUDE: PackMeta = {
  id: CLAUDE_ID,
  name: "Claude Texture Pack",
  description: "Procedural textures and sounds. Always on.",
  format: 34,
  icon: null,
  vanilla: false,
  files: 0,
  bytes: 0,
  added: 0,
};

type Arrow = "select" | "unselect" | "move_up" | "move_down";
const ARROWS: Record<Arrow, string[]> = {
  select: ["..#....", "..##...", "..###..", "..####.", "..###..", "..##...", "..#...."],
  unselect: ["....#..", "...##..", "..###..", ".####..", "..###..", "...##..", "....#.."],
  move_up: ["", "...#...", "..###..", ".#####.", "#######", "", ""],
  move_down: ["", "", "#######", ".#####.", "..###..", "...#...", ""],
};

function arrowUrl(kind: Arrow, size: number): string {
  const pack = packUrl(`gui/sprites/transferable_list/${kind}_highlighted`, 32, 32);
  if (pack) return pack;
  const rows = ARROWS[kind];
  const k = Math.floor(size / 8), o = Math.floor((size - 7 * k) / 2);
  return pixelUrl(`plist:${kind}:${size}`, size, size, (x, y) => {
    const gx = Math.floor((x - o) / k), gy = Math.floor((y - o) / k);
    return gx >= 0 && gy >= 0 && gx < 7 && gy < 7 && rows[gy]?.[gx] === "#" ? 0xffffffff : 0;
  });
}

function useIcons(packs: PackMeta[]) {
  const urls = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of packs) if (p.icon) m.set(p.id, URL.createObjectURL(new Blob([p.icon as BlobPart], { type: "image/png" })));
    return m;
  }, [packs]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return urls;
}

const claudeIconUrl = () => pixelUrl("claude-pack-icon", 32, 32, (() => {
  const img = claudeIcon(32);
  return (x: number, y: number) => {
    const i = (y * 32 + x) * 4;
    return ((img.data[i + 3] << 24) | (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]) >>> 0;
  };
})());

const unknownIconUrl = () => pixelUrl("unknown-pack-icon", 32, 32, (x, y) => (x < 2 || y < 2 || x > 29 || y > 29 ? 0xff5a5a5a : 0xff2a2a2a));

export function PacksScreen({ onDone, background = "menu" }: { onDone: () => void; background?: BackgroundKind }) {
  const { width, height } = useGui();
  const [packs, setPacks] = useState<PackMeta[]>([]);
  const [sel, setSel] = useState<string[]>(() => selectedPacks());
  const [busy, setBusy] = useState("");
  const [hover, setHover] = useState<{ list: "a" | "s"; id: string } | null>(null);
  const [scroll, setScroll] = useState({ a: 0, s: 0 });
  const fileRef = useRef<HTMLInputElement | null>(null);
  const icons = useIcons(packs);
  const cx = Math.floor(width / 2);
  const top = 32, bottom = height - 36;

  const refresh = async () => setPacks(await listAllPacks());
  useEffect(() => {
    void refresh();
  }, []);

  const byId = new Map(packs.map((p) => [p.id, p]));
  const selected = [...sel.filter((id) => byId.has(id)).map((id) => byId.get(id) as PackMeta), CLAUDE];
  const available = packs.filter((p) => !sel.includes(p.id));

  const added = async (metas: PackMeta[]) => {
    await refresh();
    const vanilla = metas.filter((m) => m.vanilla).map((m) => m.id);
    if (vanilla.length) setSel((s) => [...vanilla, ...s.filter((x) => !vanilla.includes(x))]);
  };

  const run = async (label: string, f: () => Promise<void>) => {
    setBusy(label);
    try {
      await f();
    } catch (e) {
      console.warn(e);
      setBusy(`Failed: ${String((e as Error)?.message ?? e).slice(0, 40)}`);
      setTimeout(() => setBusy(""), 2500);
      return;
    }
    setBusy("");
  };

  const done = () => run("Applying packs...", async () => {
    await setSelectedPacks(sel.filter((id) => byId.has(id)));
    onDone();
  });

  const exportPack = () => run("Exporting...", async () => {
    const { exportClaudePack, downloadBytes } = await import("../packs/export");
    downloadBytes(await exportClaudePack(), "Claude Texture Pack.zip");
  });

  useKeyDown((e) => e.key === "Escape" && !busy && void done());

  const move = (id: string, d: number) =>
    setSel((s) => {
      const i = s.indexOf(id), j = i + d;
      if (i < 0 || j < 0 || j >= s.length) return s;
      const n = [...s];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const list = (kind: "a" | "s", items: PackMeta[], x: number) => {
    const max = Math.max(0, items.length * ROW + 14 - (bottom - top));
    const off = Math.min(scroll[kind], max);
    return (
      <div
        style={{ position: "absolute", left: x, top: 0, width: LIST_W, height: bottom - top, overflow: "hidden" }}
        onWheel={(e) => setScroll((s) => ({ ...s, [kind]: Math.max(0, Math.min(max, off + Math.sign(e.deltaY) * ROW)) }))}
      >
        <Text text={kind === "a" ? "Available" : "Selected"} x={LIST_W / 2} y={2} align="center" />
        {items.map((p, i) => {
          const y = 14 + i * ROW - off;
          if (y < -ROW || y > bottom - top) return null;
          const hot = hover?.list === kind && hover.id === p.id;
          const builtin = p.id === CLAUDE_ID;
          const desc = wrapText(p.description || (p.vanilla ? "Vanilla resources" : ""), LIST_W - 36 - 4).slice(0, 2);
          const si = sel.indexOf(p.id);
          return (
            <div
              key={p.id}
              onMouseEnter={() => setHover({ list: kind, id: p.id })}
              onMouseLeave={() => setHover((h) => (h?.id === p.id && h.list === kind ? null : h))}
              onMouseDown={(e) => {
                if (e.button !== 0 || builtin) return;
                const r = e.currentTarget.getBoundingClientRect();
                const k = r.width / LIST_W;
                const lx = (e.clientX - r.left) / k, ly = (e.clientY - r.top) / k;
                if (kind === "a") setSel((s) => [p.id, ...s]);
                else if (lx >= 33) return;
                else if (lx < 17) setSel((s) => s.filter((x) => x !== p.id));
                else if (ly < 17 && si > 0) move(p.id, -1);
                else if (ly >= 17 && si < sel.length - 1) move(p.id, 1);
              }}
              style={{ position: "absolute", left: 0, top: y, width: LIST_W, height: ROW - 2, pointerEvents: "auto", cursor: builtin ? "default" : "pointer", outline: hot && !builtin ? "1px solid #808080" : undefined }}
            >
              <img alt="" src={builtin ? claudeIconUrl() : icons.get(p.id) ?? (packUrl("misc/unknown_pack") || unknownIconUrl())} width={32} height={32} draggable={false} style={{ position: "absolute", left: 1, top: 1, imageRendering: "pixelated", pointerEvents: "none", background: builtin || icons.get(p.id) ? undefined : "#3a3a3a" }} />
              {hot && !builtin && (
                <div style={{ position: "absolute", left: 1, top: 1, width: 32, height: 32, background: "rgba(160,160,160,0.6)", pointerEvents: "none" }}>
                  {kind === "a" ? (
                    <img alt="" src={arrowUrl("select", 32)} width={32} height={32} style={{ position: "absolute", left: 0, top: 0 }} />
                  ) : (
                    <>
                      <img alt="" src={arrowUrl("unselect", 16)} width={16} height={16} style={{ position: "absolute", left: 0, top: 8 }} />
                      {si > 0 && <img alt="" src={arrowUrl("move_up", 16)} width={16} height={16} style={{ position: "absolute", left: 16, top: 0 }} />}
                      {si >= 0 && si < sel.length - 1 && <img alt="" src={arrowUrl("move_down", 16)} width={16} height={16} style={{ position: "absolute", left: 16, top: 16 }} />}
                    </>
                  )}
                </div>
              )}
              <Text text={p.name} x={36} y={2} />
              {desc.map((line, k) => (
                <Text key={k} text={line} color={0x808080} x={36} y={12 + k * 10} />
              ))}
              {hot && kind === "a" && !builtin && (
                <div
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    void run("Removing...", async () => {
                      await removePack(p.id);
                      await refresh();
                    });
                  }}
                  style={{ position: "absolute", right: 2, top: 1, width: 9, height: 10, pointerEvents: "auto", cursor: "pointer" }}
                >
                  <Text text="x" color={0xff5555} x={1} y={0} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Screen background={background}>
      <div
        style={{ position: "absolute", inset: 0 }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const dt = e.dataTransfer;
          void run("Adding pack...", async () => added(await importDrop(dt)));
        }}
      >
        <Text text="Select Resource Packs" x={cx} y={8} align="center" />
        <Text text={busy || "Drop a .zip, client .jar or folder to add a pack"} color={busy ? 0xffff55 : 0x808080} x={cx} y={20} align="center" />
        <ListArea top={top} bottom={bottom}>
          {list("a", available, cx - 15 - LIST_W)}
          {list("s", selected, cx + 15)}
        </ListArea>
        <Button x={cx - 154} y={height - 27} width={100} label="Add Pack..." disabled={!!busy} onClick={() => fileRef.current?.click()} />
        <Button x={cx - 50} y={height - 27} width={100} label="Export Claude Pack" disabled={!!busy} onClick={() => void exportPack()} />
        <Button x={cx + 54} y={height - 27} width={100} label="Done" disabled={!!busy} onClick={() => void done()} />
        <input
          ref={fileRef}
          data-testid="pack-file"
          type="file"
          accept=".zip,.jar,application/zip,application/java-archive"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) void run("Adding pack...", async () => added(await importFileList(files)));
          }}
        />
      </div>
    </Screen>
  );
}

