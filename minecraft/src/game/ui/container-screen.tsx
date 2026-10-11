"use client";

import { useMemo, useRef, useState } from "react";
import type { ClickKind, ContainerView, ItemStack } from "../contracts";
import { Text, useGui } from "./gui";
import { tooltipLines } from "./item-icon";
import { LAYOUTS, placeSlots } from "./container-layouts";
import { PointerLayer, SlotBox, clickKindOf, usePointer } from "./slot";
import { arrowUrl, flameUrl, panelUrl } from "./sprites";
import { useKeyDown } from "./widgets";
import { ContainerExtras } from "./container-extras";
import { CreativeScreen, type CreativeProps } from "./creative-screen";

export const OUTSIDE = -999;

export interface ContainerScreenProps {
  view: ContainerView;
  onClick: (index: number, click: ClickKind) => void; // index -999 = click outside the panel (drops the cursor stack)
  onClose: () => void;
  onOption?: (id: string) => void;
  onRename?: (name: string) => void; // anvil; falls back to onOption("rename:<name>")
  creative?: CreativeProps; // required when view.kind is "creative"
  advanced?: boolean; // F3+H tooltips
}

const Img = ({ src, x, y, w, h }: { src: string; x: number; y: number; w: number; h: number }) => (
  <img alt="" src={src} width={w} height={h} draggable={false} style={{ position: "absolute", left: x, top: y, imageRendering: "pixelated", pointerEvents: "none" }} />
);

export function ContainerScreen(props: ContainerScreenProps) {
  if (props.view.kind === "creative" && props.creative) return <CreativeScreen {...props} creative={props.creative} />;
  return <SurvivalContainer {...props} />;
}

function SurvivalContainer({ view, onClick, onClose, onOption, onRename, advanced }: ContainerScreenProps) {
  const { width, height } = useGui();
  const L = LAYOUTS[view.kind];
  const placed = useMemo(() => placeSlots(view.kind, view.groups), [view.kind, view.groups]);
  const [hover, setHover] = useState<number | null>(null);
  const [extraTip, setExtraTip] = useState<string[]>([]);
  const last = useRef({ index: -1, t: 0 });
  const typing = useRef(false);
  const hovered = placed.find((p) => p.slot.index === hover)?.slot ?? null;
  const tip = hovered?.stack ? tooltipLines(hovered.stack, advanced) : extraTip;
  const { onMouseMove, setTip, setCursor } = usePointer(tip);
  const left = Math.floor((width - L.w) / 2);
  const top = Math.floor((height - L.h) / 2);

  useKeyDown((e) => {
    if (typing.current) return;
    const k = e.key.toLowerCase();
    if (k === "escape" || k === "e") {
      e.preventDefault();
      onClose();
      return;
    }
    if (hover === null) return;
    if (k >= "1" && k <= "9") onClick(hover, { hotbar: Number(k) - 1 });
    else if (k === "f") onClick(hover, { hotbar: 40 });
    else if (k === "q") onClick(hover, e.ctrlKey || e.metaKey ? "drop_all" : "drop");
  });

  const down = (index: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const kind = clickKindOf(e);
    const now = performance.now();
    if (kind === "left" && last.current.index === index && now - last.current.t < 250) {
      onClick(index, "double");
      last.current = { index: -1, t: 0 };
      return;
    }
    last.current = { index, t: now };
    onClick(index, kind);
  };

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
      <div style={{ position: "absolute", left, top, width: L.w, height: L.h }}>
        <Img src={panelUrl(L.w, L.h)} x={0} y={0} w={L.w} h={L.h} />
        {view.kind === "inventory" && <div style={{ position: "absolute", left: 26, top: 8, width: 49, height: 70, background: "#000" }} />}
        {view.kind === "inventory" && <Img src={arrowUrl(0, 16, 13)} x={135} y={29} w={16} h={13} />}
        {view.kind === "crafting_table" && <Img src={arrowUrl(0)} x={90} y={35} w={22} h={15} />}
        {(view.kind === "furnace" || view.kind === "blast_furnace" || view.kind === "smoker") && (
          <>
            <Img src={flameUrl(burn)} x={56} y={36} w={14} h={14} />
            <Img src={arrowUrl(cook, 24, 17)} x={79} y={34} w={24} h={17} />
          </>
        )}
        {title}
        {L.invLabel && <Text text="Inventory" color={0x404040} shadow={false} x={L.invLabel[0]} y={L.invLabel[1]} />}
        <ContainerExtras view={view} placed={placed} onOption={onOption} onRename={onRename} setTip={setExtraTip} setTyping={(t) => (typing.current = t)} />
        {placed.map((p) => (
          <SlotBox
            key={p.slot.index}
            x={p.x}
            y={p.y}
            big={p.big}
            stack={p.slot.stack}
            disabled={p.slot.disabled}
            hovered={hover === p.slot.index}
            onEnter={() => setHover(p.slot.index)}
            onLeave={() => setHover((h) => (h === p.slot.index ? null : h))}
            onDown={down(p.slot.index)}
          />
        ))}
      </div>
      <PointerLayer cursor={view.cursor} tip={tip} setCursor={setCursor} setTip={setTip} />
    </div>
  );
}

