"use client";

import { useEffect, useRef, useState } from "react";
import type { ContainerView } from "../contracts";
import { Text } from "./gui";
import { ItemIcon, tooltipLines } from "./item-icon";
import { panelUrl, pixelUrl } from "./sprites";
import { TextField, playClick } from "./widgets";
import { keyFor } from "./settings";
import { BOOK_TABS, bookEntries, bookTabs, bookTypeOf, fillRecipe, ghostRecipe, type BookTab, type BookType, type GhostSlot } from "../systems/features/recipe-book";

const O = (c: number) => (0xff000000 | c) >>> 0;
const PER_PAGE = 20;

export const recipeButtonUrl = () =>
  pixelUrl("recipe_book_button", 20, 18, (x, y) => {
    if (x === 0 || y === 0 || x === 19 || y === 17) return O(0x000000);
    const inBook = x >= 5 && x <= 14 && y >= 3 && y <= 14;
    if (inBook) {
      if (x === 5 || x === 14 || y === 3 || y === 14) return O(0x0f2f0f);
      if (y === 13) return O(0xe8e2c8);
      if ((y === 5 || y === 8) && x >= 7 && x <= 12) return O(0x7ad36a);
      if ((x === 7 || x === 12) && y > 5 && y < 8) return O(0x7ad36a);
      return O(0x2f8f2f);
    }
    if (x === 1 || y === 1) return O(0xffffff);
    if (x === 18 || y === 16) return O(0x555555);
    return O(0xc6c6c6);
  });

function cellUrl(ok: boolean, many: boolean) {
  const s = many ? 23 : 25;
  return pixelUrl(`recipe_cell:${ok}:${many}`, 25, 25, (x, y) => {
    const back = many && x >= 2 && y >= 2;
    const inFront = x < s && y < s;
    if (!inFront) {
      if (!back) return 0;
      if (x === 24 || y === 24 || x === s || y === s) return O(0x000000);
      return O(ok ? 0x6b6b6b : 0x7a2a2a);
    }
    if (x === 0 || y === 0 || x === s - 1 || y === s - 1) return O(0x000000);
    if (x === 1 || y === 1) return O(ok ? 0xd0d0d0 : 0xd88080);
    if (x === s - 2 || y === s - 2) return O(ok ? 0x505050 : 0x601818);
    return O(ok ? 0x8b8b8b : 0xa03c3c);
  });
}

function filterUrl(on: boolean, hover: boolean) {
  return pixelUrl(`recipe_filter:${on}:${hover}`, 26, 16, (x, y) => {
    if (x === 0 || y === 0 || x === 25 || y === 15) return O(hover ? 0xffffff : 0x000000);
    if (x === 1 || y === 1) return O(on ? 0x2a5a2a : 0xffffff);
    if (x === 24 || y === 14) return O(on ? 0x9fd89f : 0x555555);
    return O(on ? 0x3f7f3f : 0x8b8b8b);
  });
}

// Vanilla recipe_book/tab and tab_selected, 35x27. The selected one is drawn 2px further left and covers the panel edge.
function tabUrl(selected: boolean) {
  return pixelUrl(`recipe_tab:${selected}`, 35, 27, (x, y) => {
    const right = selected ? 34 : 29;
    if (x > right) return 0;
    const ry = 26 - y;
    if ((x === 0 && (y <= 1 || ry <= 1)) || (x === 1 && (y === 0 || ry === 0))) return 0;
    if (x === 0 || y === 0 || ry === 0 || (x === 1 && (y === 1 || ry === 1))) return O(0x000000);
    if (ry <= 2) return O(0x555555);
    if (x <= 2 || y <= 2) return O(0xffffff);
    return O(0xc6c6c6);
  });
}

function pageUrl(forward: boolean, hover: boolean) {
  return pixelUrl(`recipe_page:${forward}:${hover}`, 12, 17, (px, y) => {
    const x = forward ? px : 11 - px;
    const half = (10 - x) * 0.9;
    const d = Math.abs(y - 8);
    if (x < 2 || x > 10 || d > half + 0.5) return 0;
    if (x === 2 || d > half - 0.6) return O(0x000000);
    return O(hover ? 0xffffff : 0xc6c6c6);
  });
}

const FILTER_NAME: Record<BookType, string> = { crafting: "Showing Craftable", furnace: "Showing Smeltable", blast_furnace: "Showing Blastable", smoker: "Showing Smokable" };
const FILTER_ICON: Record<BookType, string> = { crafting: "crafting_table", furnace: "furnace", blast_furnace: "furnace", smoker: "furnace" };
const filterKey = (t: BookType) => `mc-recipe-filter:${t}`;

function stored(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

const Img = ({ src, x, y, w, h }: { src: string; x: number; y: number; w: number; h: number }) => (
  <img alt="" src={src} width={w} height={h} draggable={false} style={{ position: "absolute", left: x, top: y, imageRendering: "pixelated", pointerEvents: "none" }} />
);

export interface RecipeBookProps {
  view: ContainerView;
  x: number;
  y: number;
  setTip: (lines: string[]) => void;
  setGhost: (g: GhostSlot[] | null) => void;
}

// Vanilla RecipeBookComponent: 147x166 panel, 5x4 result buttons, red when the inventory lacks ingredients.
export function RecipeBookPanel({ view, x, y, setTip, setGhost }: RecipeBookProps) {
  const type = bookTypeOf(view.kind) ?? "crafting";
  const [tab, setTab] = useState<BookTab>("search");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [craftable, setCraftable] = useState(() => stored(filterKey(type)));
  const [hover, setHover] = useState("");
  const input = useRef<HTMLInputElement | null>(null);
  const tabs = bookTabs(view);
  const current = tabs.includes(tab) ? tab : "search";
  const entries = bookEntries(view, current, craftable, search);
  const pages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
  const p = Math.min(page, pages - 1);
  const shown = entries.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (document.activeElement === input.current || e.code !== keyFor("chat")) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  const toggleFilter = () => {
    playClick();
    setCraftable(!craftable);
    setPage(0);
    try {
      localStorage.setItem(filterKey(type), craftable ? "0" : "1");
    } catch {}
  };
  const tip = (lines: string[]) => () => setTip(lines);
  const clear = () => setTip([]);

  return (
    <div style={{ position: "absolute", left: x, top: y, width: 147, height: 166 }} onMouseDown={(e) => e.stopPropagation()} onMouseLeave={clear}>
      <Img src={panelUrl(147, 166)} x={0} y={0} w={147} h={166} />
      <TextField
        x={25}
        y={13}
        width={81}
        height={14}
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(0);
        }}
        hint="Search..."
        maxLength={50}
        textColor={0xffffff}
        inputRef={input}
      />
      <div style={{ position: "absolute", left: 110, top: 12, width: 26, height: 16, cursor: "pointer" }} onClick={toggleFilter} onMouseEnter={() => { setHover("filter"); setTip([craftable ? FILTER_NAME[type] : "Showing All"]); }} onMouseLeave={() => { setHover(""); clear(); }}>
        <Img src={filterUrl(craftable, hover === "filter")} x={0} y={0} w={26} h={16} />
        <ItemIcon stack={{ item: FILTER_ICON[type], count: 1 }} x={5} y={0} count={false} />
      </div>
      {tabs.map((t, n) => {
        const sel = t === current;
        const icons = BOOK_TABS[type].find((b) => b.tab === t)?.icons ?? [];
        const tx = -30 - (sel ? 2 : 0);
        return (
          <div
            key={t}
            style={{ position: "absolute", left: tx, top: 3 + 27 * n, width: 35, height: 27, cursor: "pointer", zIndex: sel ? 1 : 0 }}
            onClick={() => {
              if (sel) return;
              playClick();
              setTab(t);
              setPage(0);
            }}
          >
            <Img src={tabUrl(sel)} x={0} y={0} w={35} h={27} />
            {icons.length === 1 ? <ItemIcon stack={{ item: icons[0], count: 1 }} x={9} y={5} count={false} /> : icons.map((it, k) => <ItemIcon key={it} stack={{ item: it, count: 1 }} x={k ? 14 : 3} y={5} count={false} />)}
          </div>
        );
      })}
      {shown.map((e, i) => {
        const bx = 11 + (i % 5) * 25, by = 31 + Math.floor(i / 5) * 25;
        return (
          <div
            key={e.key}
            style={{ position: "absolute", left: bx, top: by, width: 25, height: 25, cursor: "pointer" }}
            onMouseEnter={tip(tooltipLines(e.result))}
            onMouseLeave={clear}
            onMouseDown={(ev) => {
              if (ev.button !== 0) return;
              playClick();
              setGhost(fillRecipe(e.key, ev.shiftKey) ? null : ghostRecipe(e.key, view));
            }}
          >
            <Img src={cellUrl(e.craftable, e.count > 1)} x={0} y={0} w={25} h={25} />
            {e.count > 1 && <ItemIcon stack={e.result} x={5} y={5} count={false} />}
            <ItemIcon stack={e.result} x={e.count > 1 ? 3 : 4} y={e.count > 1 ? 3 : 4} />
          </div>
        );
      })}
      {pages > 1 && (
        <>
          {p > 0 && (
            <div style={{ position: "absolute", left: 38, top: 137, width: 12, height: 17, cursor: "pointer" }} onClick={() => { playClick(); setPage(p - 1); }} onMouseEnter={() => setHover("back")} onMouseLeave={() => setHover("")}>
              <Img src={pageUrl(false, hover === "back")} x={0} y={0} w={12} h={17} />
            </div>
          )}
          <Text text={`${p + 1}/${pages}`} color={0xffffff} shadow={false} x={73} y={141} align="center" />
          {p < pages - 1 && (
            <div style={{ position: "absolute", left: 93, top: 137, width: 12, height: 17, cursor: "pointer" }} onClick={() => { playClick(); setPage(p + 1); }} onMouseEnter={() => setHover("fwd")} onMouseLeave={() => setHover("")}>
              <Img src={pageUrl(true, hover === "fwd")} x={0} y={0} w={12} h={17} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Vanilla GhostRecipe: red wash, item, white wash; a big result slot gets a 24x24 wash.
export function GhostOverlay({ ghost, placed }: { ghost: GhostSlot[]; placed: { slot: { index: number }; x: number; y: number; big?: boolean }[] }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1500);
    return () => clearInterval(id);
  }, []);
  return (
    <>
      {ghost.map((g) => {
        const p = placed.find((q) => q.slot.index === g.index);
        if (!p || !g.items.length) return null;
        const item = g.items[tick % g.items.length];
        const pad = g.result && p.big ? 4 : 0;
        return (
          <div key={g.index} style={{ position: "absolute", left: p.x, top: p.y, width: 16, height: 16, pointerEvents: "none" }}>
            <div style={{ position: "absolute", left: -pad, top: -pad, width: 16 + pad * 2, height: 16 + pad * 2, background: "rgba(255,0,0,0.188)" }} />
            <ItemIcon stack={{ item, count: g.count }} x={0} y={0} count={g.result} />
            <div style={{ position: "absolute", left: 0, top: 0, width: 16, height: 16, background: "rgba(255,255,255,0.188)" }} />
          </div>
        );
      })}
    </>
  );
}
