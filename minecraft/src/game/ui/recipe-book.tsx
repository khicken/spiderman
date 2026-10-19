"use client";

import { useState } from "react";
import type { ContainerView } from "../contracts";
import { Text } from "./gui";
import { ItemIcon } from "./item-icon";
import { panelUrl, pixelUrl } from "./sprites";
import { itemDef } from "../items/registry";
import { bookEntries, fillRecipe } from "../systems/features/recipe-book";

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

function cellUrl(ok: boolean, hover: boolean) {
  const fill = ok ? (hover ? 0xa0a0a0 : 0x8b8b8b) : hover ? 0xc05050 : 0xa03c3c;
  return pixelUrl(`recipe_cell:${ok}:${hover}`, 25, 25, (x, y) => {
    if (x === 0 || y === 0 || x === 24 || y === 24) return O(0x000000);
    if (x === 1 || y === 1) return O(ok ? 0xd0d0d0 : 0xd88080);
    if (x === 23 || y === 23) return O(ok ? 0x505050 : 0x601818);
    return O(fill);
  });
}

function toggleUrl(on: boolean) {
  return pixelUrl(`recipe_filter:${on}`, 26, 16, (x, y) => {
    if (x === 0 || y === 0 || x === 25 || y === 15) return O(0x000000);
    if (x === 1 || y === 1) return O(on ? 0x2a5a2a : 0xffffff);
    if (x === 24 || y === 14) return O(on ? 0x9fd89f : 0x555555);
    return O(on ? 0x3f7f3f : 0x8b8b8b);
  });
}

const Img = ({ src, x, y, w, h }: { src: string; x: number; y: number; w: number; h: number }) => (
  <img alt="" src={src} width={w} height={h} draggable={false} style={{ position: "absolute", left: x, top: y, imageRendering: "pixelated", pointerEvents: "none" }} />
);

// Vanilla RecipeBookComponent: 147x166 panel, 5x4 result buttons, red when the inventory lacks ingredients.
export function RecipeBookPanel({ view, x, y, setTip }: { view: ContainerView; x: number; y: number; setTip: (lines: string[]) => void }) {
  const [page, setPage] = useState(0);
  const [craftable, setCraftable] = useState(false);
  const [hover, setHover] = useState(-1);
  const entries = bookEntries(view, craftable);
  const pages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
  const p = Math.min(page, pages - 1);
  const shown = entries.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE);
  return (
    <div style={{ position: "absolute", left: x, top: y, width: 147, height: 166 }} onMouseDown={(e) => e.stopPropagation()} onMouseLeave={() => setTip([])}>
      <Img src={panelUrl(147, 166)} x={0} y={0} w={147} h={166} />
      <div style={{ position: "absolute", left: 25, top: 14, width: 81, height: 12, background: "#000", boxShadow: "inset 0 0 0 1px #a0a0a0" }} />
      <Text text="Search..." color={0x808080} shadow={false} x={28} y={16} />
      <div
        style={{ position: "absolute", left: 110, top: 12, width: 26, height: 16, cursor: "pointer" }}
        onClick={() => setCraftable((c) => !c)}
        onMouseEnter={() => setTip([craftable ? "Showing Craftable" : "Showing All"])}
        onMouseLeave={() => setTip([])}
      >
        <Img src={toggleUrl(craftable)} x={0} y={0} w={26} h={16} />
        <div style={{ position: "absolute", left: 5, top: 0, transform: "scale(1)" }}>
          <ItemIcon stack={{ item: "crafting_table", count: 1 }} x={0} y={0} count={false} />
        </div>
      </div>
      {shown.map((e, i) => {
        const bx = 11 + (i % 5) * 25, by = 31 + Math.floor(i / 5) * 25;
        return (
          <div
            key={e.index}
            style={{ position: "absolute", left: bx, top: by, width: 25, height: 25, cursor: "pointer" }}
            onMouseEnter={() => {
              setHover(e.index);
              setTip([itemDef(e.result.item)?.displayName ?? e.result.item]);
            }}
            onMouseLeave={() => {
              setHover(-1);
              setTip([]);
            }}
            onClick={() => fillRecipe(e.index)}
          >
            <Img src={cellUrl(e.craftable, hover === e.index)} x={0} y={0} w={25} h={25} />
            <ItemIcon stack={e.result} x={4} y={4} />
          </div>
        );
      })}
      {entries.length === 0 && <Text text="No recipes" color={0x404040} shadow={false} x={73} y={70} align="center" />}
      {pages > 1 && (
        <>
          {p > 0 && <div style={{ position: "absolute", left: 38, top: 135, cursor: "pointer" }} onClick={() => setPage(p - 1)}><Text text="<" color={0xffffff} /></div>}
          <Text text={`${p + 1}/${pages}`} color={0xffffff} x={73} y={137} align="center" />
          {p < pages - 1 && <div style={{ position: "absolute", left: 103, top: 135, cursor: "pointer" }} onClick={() => setPage(p + 1)}><Text text=">" color={0xffffff} /></div>}
        </>
      )}
    </div>
  );
}
