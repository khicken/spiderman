"use client";

import { useEffect, useState } from "react";
import type { ContainerView } from "../contracts";
import { hasItem } from "../items/registry";
import { textWidth, wrapText } from "./font";
import { Text } from "./gui";
import { ItemIcon, itemName } from "./item-icon";
import type { PlacedSlot } from "./container-layouts";
import { arrowUrl, buttonUrl, pixelUrl } from "./sprites";
import { TextField, playClick } from "./widgets";
import { MerchantPanel } from "./merchant-screen";
import { BeaconExtras } from "./beacon-screen";
import { BH, BW, bannerPixels, type Layer } from "../systems/features/banner-art";
import { mapPreviewUrl } from "../systems/features/map-render";

const bannerUrl = (base: string, layers: Layer[], scale: number) => {
  const px = bannerPixels(base, layers);
  const w = Math.floor(BW / scale), h = Math.floor(BH / scale);
  return pixelUrl(`banner:${base}:${scale}:${JSON.stringify(layers)}`, w, h, (x, y) => {
    const o = (Math.floor((y + 0.5) * scale) * BW + Math.floor((x + 0.5) * scale)) * 4;
    return (0xff000000 | (px[o] << 16) | (px[o + 1] << 8) | px[o + 2]) >>> 0;
  });
};
const stackLayers = (s: { data?: Record<string, unknown> } | null | undefined): Layer[] => (Array.isArray(s?.data?.patterns) ? (s!.data!.patterns as Layer[]) : []);

export interface ExtrasProps {
  view: ContainerView;
  placed: PlacedSlot[];
  onOption?: (id: string) => void;
  onRename?: (name: string) => void;
  setTip: (lines: string[]) => void;
  setTyping: (t: boolean) => void;
}

const Img = ({ src, x, y, w, h }: { src: string; x: number; y: number; w: number; h: number }) => (
  <img alt="" src={src} width={w} height={h} draggable={false} style={{ position: "absolute", left: x, top: y, imageRendering: "pixelated", pointerEvents: "none" }} />
);

const Box = ({ x, y, w, h, bg }: { x: number; y: number; w: number; h: number; bg: string }) => <div style={{ position: "absolute", left: x, top: y, width: w, height: h, background: bg }} />;

const Cross = ({ x, y }: { x: number; y: number }) => (
  <Img
    src={pixelUrl("red_x", 15, 15, (px, py) => (Math.abs(px - py) <= 1 || Math.abs(px + py - 14) <= 1 ? (px === py || px + py === 14 ? 0xffff4040 : 0xff600000) : 0))}
    x={x}
    y={y}
    w={15}
    h={15}
  />
);

const Plus = ({ x, y }: { x: number; y: number }) => (
  <>
    <Box x={x} y={y + 5} w={13} h={3} bg="#8b8b8b" />
    <Box x={x + 5} y={y} w={3} h={13} bg="#8b8b8b" />
  </>
);

const WORDS = "ahn bek cir dol eru fae gis hol ith jor kel lum mor nex oru pel qua ris sol tem urn vex wyl xan yor zel".split(" ");
const runes = (seed: number) => {
  let s = seed * 9301 + 49297;
  const out: string[] = [];
  for (let i = 0; i < 3 + (seed % 2); i++) {
    s = (s * 9301 + 49297) % 233280;
    out.push(WORDS[s % WORDS.length]);
  }
  return out.join(" ");
};

const optionItem = (id: string) => {
  const name = id.split(/[:*]/)[0];
  return hasItem(name) ? name : null;
};

export function ContainerExtras({ view, placed, onOption, onRename, setTip, setTyping }: ExtrasProps) {
  const opts = view.options ?? [];
  const p = view.progress ?? {};
  const choose = (id: string) => {
    playClick();
    onOption?.(id);
  };
  const outputs = placed.filter((s) => s.slot.role === "craft_output" || s.slot.role === "smelt_output");
  const inputs = placed.filter((s) => s.slot.role !== "storage" && s.slot.role !== "hotbar" && !outputs.includes(s));
  const noOutput = outputs.length > 0 && outputs.every((s) => !s.slot.stack) && inputs.some((s) => s.slot.stack);
  const [sel, setSel] = useState(-1);

  switch (view.kind) {
    case "crafter":
      return <Img src={arrowUrl(p.powered ? 1 : 0, 17, 15, 0xff2020)} x={97} y={36} w={17} h={15} />;
    case "anvil":
      return <Anvil view={view} inputs={inputs} outputs={outputs} noOutput={noOutput} onRename={onRename ?? ((n) => onOption?.(`rename:${n}`))} setTyping={setTyping} />;
    case "grindstone":
      return (
        <>
          <Img src={arrowUrl(0)} x={92} y={35} w={22} h={15} />
          {noOutput && <Cross x={95} y={35} />}
        </>
      );
    case "smithing_table":
      return (
        <>
          <Img src={arrowUrl(0)} x={68} y={49} w={22} h={15} />
          {noOutput && <Cross x={71} y={49} />}
          <Box x={120} y={20} w={48} h={56} bg="rgba(0,0,0,0.25)" />
        </>
      );
    case "cartography_table": {
      const shown = outputs[0]?.slot.stack ?? inputs[0]?.slot.stack;
      const url = mapPreviewUrl(shown);
      const n = shown?.count ?? 0;
      return (
        <>
          <Box x={67} y={13} w={66} h={66} bg="#4a3b2a" />
          {url && n < 2 && <Img src={url} x={68} y={14} w={64} h={64} />}
          {url && n >= 2 && (
            <>
              <Img src={url} x={68} y={14} w={48} h={48} />
              <Img src={url} x={84} y={30} w={48} h={48} />
            </>
          )}
          {url && shown?.data?.locked ? <Img src={pixelUrl("map_lock", 8, 10, (x, y) => (y < 4 ? ((x === 1 || x === 6) && y > 0) || (y === 0 && x > 1 && x < 6) ? 0xff6a6a6a : 0 : y === 6 && (x === 3 || x === 4) ? 0xff2a2a2a : 0xffb8b8b8))} x={120} y={16} w={8} h={10} /> : null}
        </>
      );
    }
    case "brewing_stand": {
      const brew = p.brew ?? 0;
      const fuel = p.fuel ?? 0;
      const bubbles = brew > 0 ? Math.round(((brew * 400) % 28) / 28 * 29) : 0;
      return (
        <>
          <Box x={60} y={44} w={18} h={4} bg="#373737" />
          <Box x={60} y={44} w={Math.round(fuel * 18)} h={4} bg="#e8a020" />
          <Box x={97} y={16} w={9} h={28} bg="#8b8b8b" />
          <Box x={97} y={16} w={9} h={Math.round(brew * 28)} bg="#ffffff" />
          <Box x={63} y={14 + 29 - bubbles} w={12} h={bubbles} bg="rgba(255,255,255,0.7)" />
          <Box x={62} y={33} w={1} h={18} bg="#555" />
          <Box x={113} y={33} w={1} h={18} bg="#555" />
          <Box x={63} y={32} w={51} h={1} bg="#555" />
        </>
      );
    }
    case "enchanting_table":
      return (
        <>
          <ItemIcon stack={{ item: "enchanted_book", count: 1 }} x={28} y={22} count={false} />
          {[0, 1, 2].map((i) => {
            const o = opts[i];
            const y = 14 + i * 19;
            const enabled = !!o?.enabled;
            const cost = o?.cost ?? 0;
            return (
              <div
                key={i}
                onMouseEnter={() => o && setTip([`§f§o${o.label} . . . ?`, "", `${enabled ? "§7" : "§c"}${i + 1} Lapis Lazuli`, `${enabled ? "§7" : "§c"}${i + 1} Enchantment Level${i ? "s" : ""}`])}
                onMouseLeave={() => setTip([])}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  if (o && enabled) choose(o.id);
                }}
                style={{ position: "absolute", left: 60, top: y, width: 108, height: 19, background: !o ? "#3f3a30" : enabled ? "#8f8470" : "#4e463a", boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.18), inset -1px -1px 0 rgba(0,0,0,0.35)", cursor: enabled ? "pointer" : "default" }}
              >
                {o && (
                  <>
                    <div style={{ position: "absolute", left: 1, top: 1, width: 16, height: 16, borderRadius: 8, background: enabled ? "#7fd23a" : "#5a5a5a", boxShadow: "inset -2px -2px 0 rgba(0,0,0,0.3)" }} />
                    <Text text={String(i + 1)} color={enabled ? 0xffffff : 0xa0a0a0} x={9} y={5} align="center" />
                    {wrapText(runes(cost * 7 + i), 86)
                      .slice(0, 2)
                      .map((t, j) => (
                        <Text key={j} text={t} color={enabled ? 0x685e4a : 0x342f25} shadow={false} x={20} y={2 + j * 8} />
                      ))}
                    {cost > 0 && <Text text={String(cost)} color={enabled ? 0x80ff20 : 0x407f10} x={106 - textWidth(String(cost))} y={10} />}
                  </>
                )}
              </div>
            );
          })}
        </>
      );
    case "loom":
    case "stonecutter": {
      const stone = view.kind === "stonecutter";
      const cols = 4;
      const bw = stone ? 16 : 14;
      const bh = stone ? 18 : 14;
      const gx = stone ? 52 : 60;
      const gy = stone ? 15 : 13;
      const rows = stone ? 3 : 4;
      const preview = outputs[0]?.slot.stack ?? null;
      return (
        <>
          <OptionGrid opts={opts} cols={cols} rows={rows} bw={bw} bh={bh} gx={gx} gy={gy} sel={sel} onPick={(i) => { setSel(i); choose(opts[i].id); }} setTip={setTip} />
          {!stone && preview && <Img src={bannerUrl(preview.item.slice(0, -7), stackLayers(preview), 1)} x={141} y={8} w={20} h={40} />}
        </>
      );
    }
    case "beacon":
      return <BeaconExtras view={view} onOption={onOption} setTip={setTip} />;
    case "villager":
      if (view.merchant) return <MerchantPanel merchant={view.merchant} noOutput={noOutput} choose={choose} setTip={setTip} />;
      return (
        <>
          <Text text="Trades" color={0x404040} shadow={false} x={5 + 44} y={6} align="center" />
          {opts.slice(0, 7).map((o, i) => (
            <div
              key={o.id}
              onMouseDown={(e) => {
                e.stopPropagation();
                if (o.enabled) {
                  setSel(i);
                  choose(o.id);
                }
              }}
              style={{ position: "absolute", left: 5, top: 18 + i * 20, width: 88, height: 20, backgroundImage: `url(${buttonUrl(88, 20, !o.enabled ? "disabled" : sel === i ? "hover" : "normal")})`, cursor: "pointer" }}
            >
              <Text text={o.label} color={o.enabled ? 0xffffff : 0xa0a0a0} x={4} y={6} style={{ maxWidth: 80, overflow: "hidden" }} />
            </div>
          ))}
          <Img src={arrowUrl(0, 10, 9)} x={186} y={40} w={10} h={9} />
          {noOutput && <Cross x={183} y={37} />}
        </>
      );
    default:
      return null;
  }
}

function OptionGrid({ opts, cols, rows, bw, bh, gx, gy, sel, onPick, setTip }: { opts: NonNullable<ContainerView["options"]>; cols: number; rows: number; bw: number; bh: number; gx: number; gy: number; sel: number; onPick: (i: number) => void; setTip: (l: string[]) => void }) {
  const [scroll, setScroll] = useState(0);
  const totalRows = Math.ceil(opts.length / cols);
  const maxScroll = Math.max(0, totalRows - rows);
  useEffect(() => setScroll((s) => Math.min(s, maxScroll)), [maxScroll]);
  const trackH = rows * bh;
  const thumbY = maxScroll ? Math.round((scroll / maxScroll) * (trackH - 15)) : 0;
  return (
    <div onWheel={(e) => setScroll((s) => Math.max(0, Math.min(maxScroll, s + Math.sign(e.deltaY))))}>
      {opts.slice(scroll * cols, (scroll + rows) * cols).map((o, k) => {
        const i = scroll * cols + k;
        const x = gx + (k % cols) * bw;
        const y = gy + Math.floor(k / cols) * bh;
        const item = optionItem(o.id);
        return (
          <div
            key={o.id}
            onMouseEnter={() => setTip([o.label])}
            onMouseLeave={() => setTip([])}
            onMouseDown={(e) => {
              e.stopPropagation();
              if (o.enabled) onPick(i);
            }}
            style={{ position: "absolute", left: x, top: y, width: bw, height: bh, backgroundImage: `url(${buttonUrl(bw, bh, !o.enabled ? "disabled" : i === sel ? "hover" : "normal")})`, cursor: "pointer" }}
          >
            {item ? (
              <ItemIcon stack={{ item, count: 1 }} x={(bw - 16) / 2} y={(bh - 16) / 2} count={false} />
            ) : o.id.startsWith("pattern:") ? (
              <Img src={bannerUrl("gray", [{ pattern: o.id.slice(8), color: "white" }], 3)} x={(bw - 6) / 2} y={(bh - 13) / 2} w={6} h={13} />
            ) : (
              <Text text={o.label.slice(0, 2)} x={2} y={3} />
            )}
          </div>
        );
      })}
      <div style={{ position: "absolute", left: gx + cols * bw + 3, top: gy, width: 12, height: trackH, background: "#8b8b8b", boxShadow: "inset 1px 1px 0 #373737, inset -1px -1px 0 #fff" }}>
        <div style={{ position: "absolute", left: 0, top: thumbY, width: 12, height: 15, backgroundImage: `url(${buttonUrl(12, 15, maxScroll ? "normal" : "disabled")})` }} />
      </div>
    </div>
  );
}

function Anvil({ view, inputs, outputs, noOutput, onRename, setTyping }: { view: ContainerView; inputs: PlacedSlot[]; outputs: PlacedSlot[]; noOutput: boolean; onRename: (n: string) => void; setTyping: (t: boolean) => void }) {
  const first = inputs[0]?.slot.stack ?? null;
  const [name, setName] = useState(first ? itemName(first) : "");
  const firstKey = first ? `${first.item}:${first.name ?? ""}` : "";
  useEffect(() => setName(first ? itemName(first) : ""), [firstKey]);
  const cost = view.progress?.xp_cost ?? 0;
  const afford = (view.progress?.affordable ?? 1) > 0;
  const tooExpensive = cost >= 40 && (view.progress?.creative ?? 0) === 0;
  const hasOut = outputs.some((o) => o.slot.stack);
  const label = tooExpensive ? "Too Expensive!" : `Enchantment Cost: ${cost}`;
  const lw = textWidth(label);
  return (
    <>
      <Box x={59} y={20} w={110} h={16} bg={first ? "#000" : "#222"} />
      <Box x={59} y={20} w={110} h={1} bg="#a0a0a0" />
      <div onFocus={() => setTyping(true)} onBlur={() => setTyping(false)}>
        <TextField
          x={62}
          y={24}
          width={103}
          height={9}
          value={name}
          bordered={false}
          maxLength={50}
          textColor={first ? 0xffffff : 0x707070}
          onChange={(v) => {
            setName(v);
            onRename(v);
          }}
        />
      </div>
      <Plus x={55} y={49} />
      <Img src={arrowUrl(0)} x={100} y={48} w={22} h={15} />
      {noOutput && <Cross x={103} y={48} />}
      {(cost > 0 && (hasOut || tooExpensive)) && (
        <>
          <Box x={176 - 8 - lw - 2} y={67} w={lw + 4} h={12} bg="rgba(0,0,0,0.31)" />
          <Text text={label} color={tooExpensive || !afford ? 0xff6060 : 0x80ff20} x={176 - 8 - lw} y={69} />
        </>
      )}
    </>
  );
}
