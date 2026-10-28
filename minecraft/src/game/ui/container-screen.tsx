"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ClickKind, ContainerView, Effect, ItemStack, SlotRole } from "../contracts";
import { Text, useGui } from "./gui";
import { tooltipLines } from "./item-icon";
import { LAYOUTS, placeSlots } from "./container-layouts";
import { PointerLayer, SlotBox, clickKindOf, usePointer } from "./slot";
import { arrowUrl, containerBg, flameUrl, panelUrl } from "./sprites";
import { EffectList } from "./hud";
import { useKeyDown } from "./widgets";
import { PlayerDoll, type DollInventory } from "./player-doll";
import { keyFor } from "./settings";
import { canStack } from "../items/stack";
import { maxStack } from "../items/registry";
import type { EmptySlotKind } from "./sprites";
import { ContainerExtras } from "./container-extras";
import { MountPreview, mountEmpty } from "./horse-screen";
import { CreativeScreen, type CreativeProps } from "./creative-screen";
import { GhostOverlay, RecipeBookPanel, recipeButtonUrl } from "./recipe-book";
import { bookTypeOf, type GhostSlot } from "../systems/features/recipe-book";

const BOOK_BUTTON: Partial<Record<string, [number, number]>> = { inventory: [104, 61], crafting_table: [5, 34], furnace: [20, 34], blast_furnace: [20, 34], smoker: [20, 34] };
const bookKey = (kind: string) => {
  const t = bookTypeOf(kind as ContainerView["kind"]);
  return t === "crafting" ? "mc-recipe-book" : `mc-recipe-book:${t}`;
};
function bookStored(kind: string): boolean {
  try {
    return localStorage.getItem(bookKey(kind)) === "1";
  } catch {
    return false;
  }
}

export const OUTSIDE = -999;

export interface ContainerScreenProps {
  view: ContainerView;
  onClick: (index: number, click: ClickKind) => void; // index -999 = click outside the panel (drops the cursor stack)
  onClose: () => void;
  onOption?: (id: string) => void;
  onRename?: (name: string) => void; // anvil; falls back to onOption("rename:<name>")
  creative?: CreativeProps; // required when view.kind is "creative"
  advanced?: boolean; // F3+H tooltips
  inventory?: DollInventory; // the player preview shows its armor and held items
  effects?: Effect[];
}

const EMPTY_ICON: Partial<Record<SlotRole, EmptySlotKind>> = {
  armor_head: "helmet",
  armor_chest: "chestplate",
  armor_legs: "leggings",
  armor_feet: "boots",
  offhand: "shield",
};

type Drag = { mode: "left" | "right"; slots: number[]; start: number };

const Img = ({ src, x, y, w, h }: { src: string; x: number; y: number; w: number; h: number }) => (
  <img alt="" src={src} width={w} height={h} draggable={false} style={{ position: "absolute", left: x, top: y, imageRendering: "pixelated", pointerEvents: "none" }} />
);

// Vanilla EffectRenderingInventoryScreen: only the inventory and creative screens list effects, right of the panel.
export function showsEffects(kind: string, width: number): boolean {
  if (kind === "creative") return width - (Math.floor((width - 195) / 2) + 197) >= 32;
  if (kind !== "inventory") return false;
  const left = bookStored(kind) && width >= 379 ? 177 + Math.trunc((width - 376) / 2) : Math.floor((width - 176) / 2);
  return width - (left + 178) >= 32;
}

export function ContainerScreen(props: ContainerScreenProps) {
  if (props.view.kind === "creative" && props.creative) return <CreativeScreen {...props} creative={props.creative} />;
  return <SurvivalContainer {...props} />;
}

function SurvivalContainer({ view, onClick, onClose, onOption, onRename, advanced, inventory, effects }: ContainerScreenProps) {
  const { width, height } = useGui();
  const L = LAYOUTS[view.kind];
  const placed = useMemo(() => placeSlots(view.kind, view.groups), [view.kind, view.groups]);
  const [hover, setHover] = useState<number | null>(null);
  const [extraTip, setExtraTip] = useState<string[]>([]);
  const last = useRef({ index: -1, t: 0 });
  const typing = useRef(false);
  const hovered = placed.find((p) => p.slot.index === hover)?.slot ?? null;
  const tip = hovered?.stack ? tooltipLines(hovered.stack, advanced) : extraTip;
  const { onMouseMove, setTip, setCursor, mouse } = usePointer(tip);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const cursorRef = useRef(view.cursor);
  cursorRef.current = view.cursor;
  const [book, setBook] = useState(() => bookStored(view.kind));
  const [ghost, setGhost] = useState<GhostSlot[] | null>(null);
  const bookAt = BOOK_BUTTON[view.kind];
  const bookOpen = book && !!bookAt;
  // Vanilla RecipeBookComponent.updateScreenPosition; below 379 px the book covers the screen instead.
  const narrow = width < 379;
  const left = bookOpen && !narrow ? 177 + Math.trunc((width - L.w - 200) / 2) : Math.floor((width - L.w) / 2);
  const top = Math.floor((height - L.h) / 2);
  const toggleBook = () => {
    setBook(!book);
    setGhost(null);
    try {
      localStorage.setItem(bookKey(view.kind), book ? "0" : "1");
    } catch {}
  };

  useKeyDown((e) => {
    if (typing.current) return;
    const k = e.key.toLowerCase();
    if (k === "escape" || e.code === keyFor("inventory")) {
      e.preventDefault();
      onClose();
      return;
    }
    if (hover === null) return;
    for (let i = 1; i <= 9; i++) if (e.code === keyFor(`hotbar.${i}`)) return onClick(hover, { hotbar: i - 1 });
    if (e.code === keyFor("swap_offhand")) onClick(hover, { hotbar: 40 });
    else if (e.code === keyFor("drop")) onClick(hover, e.ctrlKey || e.metaKey ? "drop_all" : "drop");
  });

  useEffect(() => {
    const up = () => {
      const d = dragRef.current;
      if (!d) return;
      setDrag(null);
      dragRef.current = null;
      if (d.slots.length > 1) onClick(d.start, { drag: d.mode, slots: d.slots });
      else click(d.start, d.mode);
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  });

  const preview = useMemo(() => {
    const c = view.cursor;
    if (!drag || drag.slots.length < 2 || !c) return null;
    const max = maxStack(c.item);
    const per = drag.mode === "left" ? Math.floor(c.count / drag.slots.length) : 1;
    const stacks = new Map<number, ItemStack>();
    let left = c.count;
    for (const i of drag.slots) {
      const s = placed.find((p) => p.slot.index === i)?.slot.stack ?? null;
      const have = s ? s.count : 0;
      const n = Math.max(0, Math.min(per, max - have, left));
      left -= n;
      stacks.set(i, { ...c, count: have + n });
    }
    return { stacks, cursor: left > 0 ? { ...c, count: left } : null };
  }, [drag, view.cursor, placed]);

  const accepts = (index: number) => {
    const c = cursorRef.current;
    const s = placed.find((p) => p.slot.index === index)?.slot;
    if (!c || !s || s.disabled || s.role === "craft_output" || s.role === "smelt_output") return false;
    return !s.stack || (canStack(s.stack, c) && s.stack.count < maxStack(s.stack.item));
  };

  const enter = (index: number) => {
    setHover(index);
    const d = dragRef.current;
    const c = cursorRef.current;
    if (!d || !c || d.slots.includes(index) || !accepts(index)) return;
    if (d.mode === "left" && d.slots.length >= c.count) return;
    setDrag({ ...d, slots: [...d.slots, index] });
  };

  const click = (index: number, kind: ClickKind) => {
    const now = performance.now();
    if (kind === "left" && last.current.index === index && now - last.current.t < 250) {
      onClick(index, "double");
      last.current = { index: -1, t: 0 };
      return;
    }
    last.current = { index, t: now };
    onClick(index, kind);
  };

  const down = (index: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (ghost?.some((g) => g.index === index)) setGhost(null);
    const kind = clickKindOf(e);
    if ((kind === "left" || kind === "right") && view.cursor && !dragRef.current) {
      const d: Drag = { mode: kind, slots: [index], start: index };
      dragRef.current = d;
      setDrag(d);
      return;
    }
    click(index, kind);
  };

  const bg = containerBg(view.kind, L.w, L.h);
  const cook = view.progress?.cook ?? 0;
  const burn = view.progress?.burn ?? 0;
  const title = L.title === "center" ? <Text text={view.title} color={0x404040} shadow={false} x={L.w / 2} y={6} align="center" /> : <Text text={view.title} color={0x404040} shadow={false} x={L.title[0]} y={L.title[1]} />;

  return (
    <div
      onMouseMove={onMouseMove}
      onMouseDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const s = r.width / width;
        const mx = (e.clientX - r.left) / s - left;
        const my = (e.clientY - r.top) / s - top;
        const outside = mx < 0 || my < 0 || mx >= L.w || my >= L.h;
        if (outside && view.cursor) onClick(OUTSIDE, e.button === 2 ? "right" : "left");
      }}
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: "absolute", left: 0, top: 0, width, height, background: "linear-gradient(rgba(16,16,16,0.75), rgba(16,16,16,0.82))", pointerEvents: "auto" }}
    >
      <div style={{ position: "absolute", left, top, width: L.w, height: L.h, visibility: bookOpen && narrow ? "hidden" : undefined }}>
        {bg ? (
          <>
            <Img src={bg.url} x={0} y={0} w={L.w} h={bg.split ?? L.h} />
            {bg.bottomUrl && <Img src={bg.bottomUrl} x={0} y={bg.split ?? 0} w={L.w} h={L.h - (bg.split ?? 0)} />}
          </>
        ) : (
          <Img src={panelUrl(L.w, L.h)} x={0} y={0} w={L.w} h={L.h} />
        )}
        {view.kind === "inventory" && !bg && <div style={{ position: "absolute", left: 26, top: 8, width: 49, height: 70, background: "#000", boxShadow: "inset 1px 1px 0 #373737, inset -1px -1px 0 #fff" }} />}
        {view.kind === "inventory" && <PlayerDoll x={26} y={8} w={49} h={70} panel={{ left, top }} mouse={mouse} inventory={inventory} />}
        {view.kind === "inventory" && !bg && <Img src={arrowUrl(0, 16, 13)} x={135} y={29} w={16} h={13} />}
        {view.kind === "horse" && <MountPreview view={view} panel={{ left, top }} mouse={mouse} />}
        {view.kind === "crafting_table" && !bg && <Img src={arrowUrl(0)} x={90} y={35} w={22} h={15} />}
        {(view.kind === "furnace" || view.kind === "blast_furnace" || view.kind === "smoker") && (
          <>
            <Img src={flameUrl(burn)} x={56} y={36} w={14} h={14} />
            <Img src={arrowUrl(cook, 24, bg ? 16 : 17)} x={79} y={34} w={24} h={bg ? 16 : 17} />
          </>
        )}
        {title}
        {L.invLabel && <Text text="Inventory" color={0x404040} shadow={false} x={L.invLabel[0]} y={L.invLabel[1]} />}
        {bookAt && (
          <div style={{ position: "absolute", left: bookAt[0], top: bookAt[1], width: 20, height: 18, cursor: "pointer", visibility: "visible", zIndex: 1 }} onMouseDown={(e) => e.stopPropagation()} onClick={toggleBook}>
            <Img src={recipeButtonUrl()} x={0} y={0} w={20} h={18} />
          </div>
        )}
        <ContainerExtras view={view} placed={placed} onOption={onOption} onRename={onRename} setTip={setExtraTip} setTyping={(t) => (typing.current = t)} />
        {placed.map((p) => (
          <SlotBox
            key={p.slot.index}
            x={p.x}
            y={p.y}
            big={p.big}
            frame={!bg}
            stack={preview?.stacks.get(p.slot.index) ?? p.slot.stack}
            disabled={p.slot.disabled}
            empty={EMPTY_ICON[p.slot.role] ?? mountEmpty(view, p.slot.index)}
            dragged={!!drag && drag.slots.length > 1 && drag.slots.includes(p.slot.index)}
            hovered={hover === p.slot.index}
            onEnter={() => enter(p.slot.index)}
            onLeave={() => setHover((h) => (h === p.slot.index ? null : h))}
            onDown={down(p.slot.index)}
          />
        ))}
        {bookOpen && ghost && <GhostOverlay ghost={ghost} placed={placed} />}
      </div>
      {view.kind === "inventory" && effects && !(bookOpen && narrow) && <EffectList effects={effects} x={left + L.w + 2} top={top} width={width} setTip={setExtraTip} />}
      {bookOpen && <RecipeBookPanel view={view} x={Math.trunc((width - 147) / 2) - (narrow ? 0 : 86)} y={Math.trunc((height - 166) / 2)} setTip={setExtraTip} setGhost={setGhost} />}
      <PointerLayer cursor={preview ? preview.cursor : view.cursor} tip={drag ? [] : tip} setCursor={setCursor} setTip={setTip} />
    </div>
  );
}

