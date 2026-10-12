"use client";

import { useMemo, useRef, useState } from "react";
import type { ClickKind, ContainerView, ItemStack, SlotView } from "../contracts";
import { Text, useGui } from "./gui";
import { ItemIcon, tooltipLines } from "./item-icon";
import { PointerLayer, SlotBox, clickKindOf, usePointer } from "./slot";
import { PlayerDoll } from "./player-doll";
import { keyFor } from "./settings";
import type { EmptySlotKind } from "./sprites";

const EMPTY_ICON: Partial<Record<string, EmptySlotKind>> = { armor_head: "helmet", armor_chest: "chestplate", armor_legs: "leggings", armor_feet: "boots", offhand: "shield" };
import { buttonUrl, panelUrl, pixelUrl } from "./sprites";
import { TextField, playClick, useKeyDown } from "./widgets";

export interface CreativeProps {
  tabs: { id: string; label: string; icon: string }[]; // "search", "inventory" and "hotbar" ids get vanilla spots
  items: (tab: string, search: string) => ItemStack[];
  onTake: (stack: ItemStack, click: ClickKind) => void;
  onDestroy?: (all: boolean) => void; // destroy-item slot; all = shift-click clears the inventory
}

interface Props {
  view: ContainerView;
  onClick: (index: number, click: ClickKind) => void;
  onClose: () => void;
  creative: CreativeProps;
  advanced?: boolean;
}

const W = 195;
const H = 136;
const ARMOR_POS: Record<string, [number, number]> = { armor_head: [54, 6], armor_chest: [54, 33], armor_legs: [108, 6], armor_feet: [108, 33] };

function tabSpots(tabs: CreativeProps["tabs"]) {
  const spots: { tab: CreativeProps["tabs"][number]; top: boolean; col: number }[] = [];
  let t = 0;
  let b = 0;
  for (const tab of tabs) {
    if (tab.id === "search") spots.push({ tab, top: true, col: 6 });
    else if (tab.id === "inventory" || tab.id === "survival") spots.push({ tab, top: false, col: 6 });
    else if (tab.id === "hotbar") spots.push({ tab, top: true, col: 5 });
    else if (t < 5) spots.push({ tab, top: true, col: t++ });
    else if (b < 6) spots.push({ tab, top: false, col: b++ });
  }
  return spots;
}

const tabX = (col: number) => (col === 6 ? W - 26 : col * 27);
const trashUrl = () => pixelUrl("trash", 16, 16, (x, y) => (Math.abs(x - y) <= 1 || Math.abs(x + y - 15) <= 1) && x > 2 && x < 13 ? 0xffd03030 : 0);

export function CreativeScreen({ view, onClick, onClose, creative, advanced }: Props) {
  const { width, height } = useGui();
  const [tab, setTab] = useState(creative.tabs[0]?.id ?? "search");
  const [search, setSearch] = useState("");
  const [scroll, setScroll] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const isInv = tab === "inventory" || tab === "survival";
  const isSearch = tab === "search";
  const items = useMemo(() => (isInv ? [] : creative.items(tab, search)), [creative, tab, search, isInv]);
  const rows = Math.ceil(items.length / 9);
  const maxScroll = Math.max(0, rows - 5);
  const sc = Math.min(scroll, maxScroll);
  const spots = tabSpots(creative.tabs);
  const current = creative.tabs.find((t) => t.id === tab);
  const left = Math.floor((width - W) / 2);
  const top = Math.floor((height - H) / 2);

  const slots: SlotView[] = view.groups.flatMap((g) => g.slots);
  const hoveredStack: ItemStack | null = (() => {
    if (!hover) return null;
    if (hover.startsWith("g")) return items[Number(hover.slice(1))] ?? null;
    if (hover.startsWith("s")) return slots.find((s) => s.index === Number(hover.slice(1)))?.stack ?? null;
    return null;
  })();
  const tabHover = hover?.startsWith("t") ? creative.tabs.find((t) => t.id === hover.slice(1)) : undefined;
  const tip = hoveredStack ? tooltipLines(hoveredStack, advanced) : tabHover ? [tabHover.label] : hover === "trash" ? ["Destroy Item"] : [];
  const { onMouseMove, setTip, setCursor, mouse } = usePointer(tip);
  const hoveredSlot = hover?.startsWith("s") ? Number(hover.slice(1)) : null;

  const switchTab = (id: string) => {
    playClick();
    setTab(id);
    setScroll(0);
    if (id === "search") requestAnimationFrame(() => searchRef.current?.focus());
  };

  useKeyDown((e) => {
    const k = e.key.toLowerCase();
    if (k === "escape" || (!isSearch && e.code === keyFor("inventory"))) {
      e.preventDefault();
      onClose();
      return;
    }
    if (hoveredSlot !== null) {
      for (let i = 1; i <= 9; i++) if (e.code === keyFor(`hotbar.${i}`)) return onClick(hoveredSlot, { hotbar: i - 1 });
      if (e.code === keyFor("swap_offhand")) return onClick(hoveredSlot, { hotbar: 40 });
      if (e.code === keyFor("drop")) return onClick(hoveredSlot, e.ctrlKey || e.metaKey ? "drop_all" : "drop");
    }
    if (k.length === 1 && /[a-z]/.test(k) && k !== "q" && k !== "f" && !isSearch && creative.tabs.some((t) => t.id === "search")) {
      e.preventDefault();
      setSearch(e.key);
      switchTab("search");
    }
  });

  const slotDown = (index: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onClick(index, clickKindOf(e));
  };

  const gridDown = (i: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const s = items[i];
    if (view.cursor) creative.onDestroy?.(false);
    else if (s) creative.onTake(s, clickKindOf(e));
  };

  const setScrollFromY = (clientY: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const f = (clientY - r.top) / r.height;
    setScroll(Math.round(Math.max(0, Math.min(1, f)) * maxScroll));
  };

  const renderTab = (s: ReturnType<typeof tabSpots>[number], selected: boolean) => {
    const x = tabX(s.col);
    const y = s.top ? -28 : selected ? H - 4 : H - 2;
    const h = selected ? 32 : 30;
    return (
      <div
        key={s.tab.id}
        onMouseEnter={() => setHover(`t${s.tab.id}`)}
        onMouseLeave={() => setHover((h) => (h === `t${s.tab.id}` ? null : h))}
        onMouseDown={(e) => {
          e.stopPropagation();
          if (s.tab.id !== "hotbar") switchTab(s.tab.id);
        }}
        style={{ position: "absolute", left: x, top: y, width: 26, height: h, cursor: "pointer", zIndex: selected ? 3 : 0 }}
      >
        <img alt="" src={panelUrl(26, h + 4, selected ? 0xc6c6c6 : 0xa8a8a8)} width={26} height={h + 4} style={{ position: "absolute", left: 0, top: s.top ? 0 : -4, imageRendering: "pixelated" }} />
        {selected && <div style={{ position: "absolute", left: 3, top: s.top ? h - 4 : 0, width: 20, height: 4, background: "#c6c6c6" }} />}
        <ItemIcon stack={{ item: s.tab.icon, count: 1 }} x={5} y={s.top ? 9 : 7} count={false} />
      </div>
    );
  };

  const playerSlot = (s: SlotView, x: number, y: number) => (
    <SlotBox key={s.index} x={x} y={y} stack={s.stack} empty={EMPTY_ICON[s.role]} hovered={hoveredSlot === s.index} onEnter={() => setHover(`s${s.index}`)} onLeave={() => setHover((h) => (h === `s${s.index}` ? null : h))} onDown={slotDown(s.index)} />
  );

  const hotbar = slots.filter((s) => s.role === "hotbar");
  const storage = slots.filter((s) => s.role === "storage");

  return (
    <div
      onMouseMove={onMouseMove}
      onWheel={(e) => !isInv && setScroll(Math.max(0, Math.min(maxScroll, sc + Math.sign(e.deltaY))))}
      onMouseDown={() => view.cursor && onClick(-999, "left")}
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: "absolute", left: 0, top: 0, width, height, background: "linear-gradient(rgba(16,16,16,0.75), rgba(16,16,16,0.82))", pointerEvents: "auto" }}
    >
      <div style={{ position: "absolute", left, top, width: W, height: H }} onMouseDown={(e) => e.stopPropagation()}>
        {spots.filter((s) => s.tab.id !== tab).map((s) => renderTab(s, false))}
        <img alt="" src={panelUrl(W, H)} width={W} height={H} style={{ position: "absolute", left: 0, top: 0, imageRendering: "pixelated", zIndex: 1 }} />
        {spots.filter((s) => s.tab.id === tab).map((s) => renderTab(s, true))}
        <div style={{ position: "absolute", inset: 0, zIndex: 4 }}>
          <Text text={isInv ? "" : current?.label ?? ""} color={0x404040} shadow={false} x={8} y={6} />
          {isSearch && (
            <>
              <div style={{ position: "absolute", left: 80, top: 4, width: 89, height: 12, background: "#fff", boxShadow: "inset 1px 1px 0 #373737" }} />
              <TextField x={82} y={6} width={86} height={9} value={search} onChange={(v) => { setSearch(v); setScroll(0); }} bordered={false} textColor={0x000000} maxLength={50} autoFocus inputRef={searchRef} />
            </>
          )}
          {isInv ? (
            <>
              <div style={{ position: "absolute", left: 73, top: 6, width: 32, height: 43, background: "#000" }} />
              <PlayerDoll x={73} y={6} w={32} h={43} scale={20} panel={{ left, top }} mouse={mouse} />
              {slots.filter((s) => ARMOR_POS[s.role]).map((s) => playerSlot(s, ARMOR_POS[s.role][0], ARMOR_POS[s.role][1]))}
              {slots.filter((s) => s.role === "offhand").map((s) => playerSlot(s, 35, 20))}
              {storage.map((s, i) => playerSlot(s, 9 + (i % 9) * 18, 54 + Math.floor(i / 9) * 18))}
              {hotbar.map((s, i) => playerSlot(s, 9 + i * 18, 112))}
              <SlotBox
                x={173}
                y={112}
                stack={null}
                hovered={hover === "trash"}
                onEnter={() => setHover("trash")}
                onLeave={() => setHover((h) => (h === "trash" ? null : h))}
                onDown={(e) => {
                  e.stopPropagation();
                  creative.onDestroy?.(e.shiftKey);
                }}
              />
              <img alt="" src={trashUrl()} width={16} height={16} style={{ position: "absolute", left: 173, top: 112, imageRendering: "pixelated", pointerEvents: "none", opacity: 0.8 }} />
            </>
          ) : (
            <>
              {Array.from({ length: 45 }, (_, k) => {
                const i = sc * 9 + k;
                const s = items[i] ?? null;
                return (
                  <SlotBox
                    key={k}
                    x={9 + (k % 9) * 18}
                    y={18 + Math.floor(k / 9) * 18}
                    stack={s ? { ...s, count: 1 } : null}
                    hovered={hover === `g${i}`}
                    onEnter={() => setHover(`g${i}`)}
                    onLeave={() => setHover((h) => (h === `g${i}` ? null : h))}
                    onDown={gridDown(i)}
                  />
                );
              })}
              {hotbar.map((s, i) => playerSlot(s, 9 + i * 18, 112))}
              <div
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setScrollFromY(e.clientY, e.currentTarget);
                }}
                onPointerMove={(e) => e.buttons & 1 && setScrollFromY(e.clientY, e.currentTarget)}
                style={{ position: "absolute", left: 174, top: 17, width: 14, height: 112, background: "#8b8b8b", boxShadow: "inset 1px 1px 0 #373737, inset -1px -1px 0 #fff" }}
              >
                <div style={{ position: "absolute", left: 1, top: 1 + (maxScroll ? Math.round((sc / maxScroll) * (110 - 15)) : 0), width: 12, height: 15, backgroundImage: `url(${buttonUrl(12, 15, maxScroll ? "normal" : "disabled")})` }} />
              </div>
            </>
          )}
        </div>
      </div>
      <PointerLayer cursor={view.cursor} tip={tip} setCursor={setCursor} setTip={setTip} />
    </div>
  );
}
