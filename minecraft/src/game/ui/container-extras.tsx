"use client";

import { useEffect, useState } from "react";
import type { ContainerView } from "../contracts";
import { hasItem } from "../items/registry";
import { textWidth, wrapText } from "./font";
import { Text } from "./gui";
import { ItemIcon, itemName } from "./item-icon";
import type { PlacedSlot } from "./container-layouts";
import { CONTAINER_ART, arrowUrl, buttonUrl, containerProgress, containerSprite, hasContainerBg, pixelUrl } from "./sprites";
import { TextField, playClick } from "./widgets";
import { MerchantPanel } from "./merchant-screen";
import { BeaconExtras } from "./beacon-screen";
import { EnchantBook } from "./enchant-book";
import { BH, BW, bannerPixels, type Layer } from "../systems/features/banner-art";
import { mapPaperUrl, mapPreviewUrl } from "../systems/features/map-render";

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

// Vanilla's red X sprite (28x21) when the pack has it, else ours.
const NoOutput = ({ path, x, y, cx, cy }: { path: string; x: number; y: number; cx: number; cy: number }) => {
  const url = containerSprite(`${path}/error`, 28, 21);
  return url ? <Img src={url} x={x} y={y} w={28} h={21} /> : <Cross x={cx} y={cy} />;
};

const css = (c: number) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${((c >>> 24) / 255).toFixed(3)})`;

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

export function ContainerExtras(props: ExtrasProps) {
  const art = hasContainerBg(props.view.kind) ? [] : (CONTAINER_ART[props.view.kind] ?? []);
  return (
    <>
      {art.map((a, i) => (a.url ? <Img key={i} src={a.url()} x={a.x} y={a.y} w={a.w} h={a.h} /> : <Box key={i} x={a.x} y={a.y} w={a.w} h={a.h} bg={css(a.c ?? 0)} />))}
      <Widgets {...props} />
    </>
  );
}

function Widgets({ view, placed, onOption, onRename, setTip, setTyping }: ExtrasProps) {
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
  const [hov, setHov] = useState(-1);

  switch (view.kind) {
    case "crafter": {
      const url = containerSprite(`crafter/${p.powered ? "powered" : "unpowered"}_redstone`, 16, 16);
      return url ? <Img src={url} x={97} y={35} w={16} h={16} /> : <Img src={arrowUrl(p.powered ? 1 : 0, 17, 15, 0xff2020)} x={97} y={36} w={17} h={15} />;
    }
    case "anvil":
      return <Anvil view={view} inputs={inputs} outputs={outputs} noOutput={noOutput} onRename={onRename ?? ((n) => onOption?.(`rename:${n}`))} setTyping={setTyping} />;
    case "grindstone":
      return noOutput ? <NoOutput path="grindstone" x={92} y={31} cx={95} cy={35} /> : null;
    case "smithing_table":
      return noOutput ? <NoOutput path="smithing" x={65} y={46} cx={71} cy={49} /> : null;
    case "cartography_table": {
      // Vanilla CartographyTableScreen draws the input map: shrunk on blank paper to preview a zoom out, twice for a copy.
      const map = inputs[0]?.slot.stack;
      const extra = inputs[1]?.slot.stack?.item;
      const url = mapPreviewUrl(map);
      const out = outputs[0]?.slot.stack;
      const scaling = !!out && extra === "paper";
      const copying = !!out && extra === "map";
      const locked = !!map?.data?.locked || (!!out && extra === "glass_pane");
      return (
        <>
          {url && scaling && (
            <>
              <Img src={mapPaperUrl() ?? url} x={67} y={13} w={66} h={66} />
              <Img src={url} x={84} y={30} w={32} h={32} />
            </>
          )}
          {url && copying && (
            <>
              <Img src={url} x={84} y={14} w={48} h={48} />
              <Img src={url} x={68} y={30} w={48} h={48} />
            </>
          )}
          {url && !scaling && !copying && <Img src={url} x={68} y={14} w={64} h={64} />}
          {url && locked && !scaling && !copying ? <Img src={pixelUrl("map_lock", 8, 10, (x, y) => (y < 4 ? ((x === 1 || x === 6) && y > 0) || (y === 0 && x > 1 && x < 6) ? 0xff6a6a6a : 0 : y === 6 && (x === 3 || x === 4) ? 0xff2a2a2a : 0xffb8b8b8))} x={120} y={16} w={8} h={10} /> : null}
        </>
      );
    }
    case "brewing_stand": {
      const brew = p.brew ?? 0;
      const fuel = p.fuel ?? 0;
      const bubbles = brew > 0 ? Math.round(((brew * 400) % 28) / 28 * 29) : 0;
      const fw = Math.ceil(fuel * 18), bh = Math.round(brew * 28);
      const fuelUrl = containerProgress("brewing_stand/fuel_length", 18, 4, fw, 4);
      const brewUrl = containerProgress("brewing_stand/brew_progress", 9, 28, 9, bh);
      const bubbleUrl = containerProgress("brewing_stand/bubbles", 12, 29, 12, bubbles, true);
      return (
        <>
          {fuelUrl ? <Img src={fuelUrl} x={60} y={44} w={18} h={4} /> : <Box x={60} y={44} w={fw} h={4} bg="#e8a020" />}
          {brewUrl ? <Img src={brewUrl} x={97} y={16} w={9} h={28} /> : <Box x={97} y={16} w={9} h={bh} bg="#ffffff" />}
          {bubbleUrl ? <Img src={bubbleUrl} x={63} y={14} w={12} h={29} /> : <Box x={63} y={14 + 29 - bubbles} w={12} h={bubbles} bg="rgba(255,255,255,0.7)" />}
        </>
      );
    }
    case "enchanting_table":
      return (
        <>
          <EnchantBook item={view.groups.find((g) => g.name === "item")?.slots[0]?.stack ?? null} open={opts.length > 0} />
          {[0, 1, 2].map((i) => {
            const o = opts[i];
            const y = 14 + i * 19;
            const enabled = !!o?.enabled;
            const cost = o?.cost ?? 0;
            const slot = o ? containerSprite(`enchanting_table/enchantment_slot${!enabled ? "_disabled" : hov === i ? "_highlighted" : ""}`, 108, 19) : "";
            const level = o ? containerSprite(`enchanting_table/level_${i + 1}${enabled ? "" : "_disabled"}`, 16, 16) : "";
            const look = slot ? { backgroundImage: `url(${slot})` } : o ? { background: enabled ? "#8f8470" : "#4e463a", boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.18), inset -1px -1px 0 rgba(0,0,0,0.35)" } : {};
            return (
              <div
                key={i}
                onMouseEnter={() => {
                  setHov(i);
                  if (o) setTip([`§f§o${o.label} . . . ?`, "", `${enabled ? "§7" : "§c"}${i + 1} Lapis Lazuli`, `${enabled ? "§7" : "§c"}${i + 1} Enchantment Level${i ? "s" : ""}`]);
                }}
                onMouseLeave={() => {
                  setHov(-1);
                  setTip([]);
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  if (o && enabled) choose(o.id);
                }}
                style={{ position: "absolute", left: 60, top: y, width: 108, height: 19, ...look, cursor: enabled ? "pointer" : "default" }}
              >
                {o && (
                  <>
                    {level ? (
                      <Img src={level} x={1} y={1} w={16} h={16} />
                    ) : (
                      <>
                        <div style={{ position: "absolute", left: 1, top: 1, width: 16, height: 16, borderRadius: 8, background: enabled ? "#7fd23a" : "#5a5a5a", boxShadow: "inset -2px -2px 0 rgba(0,0,0,0.3)" }} />
                        <Text text={String(i + 1)} color={enabled ? 0xffffff : 0xa0a0a0} x={9} y={5} align="center" />
                      </>
                    )}
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
          <OptionGrid kind={stone ? "stonecutter" : "loom"} opts={opts} cols={cols} rows={rows} bw={bw} bh={bh} gx={gx} gy={gy} sel={sel} onPick={(i) => { setSel(i); choose(opts[i].id); }} setTip={setTip} />
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

function OptionGrid({ kind, opts, cols, rows, bw, bh, gx, gy, sel, onPick, setTip }: { kind: string; opts: NonNullable<ContainerView["options"]>; cols: number; rows: number; bw: number; bh: number; gx: number; gy: number; sel: number; onPick: (i: number) => void; setTip: (l: string[]) => void }) {
  const [scroll, setScroll] = useState(0);
  const [hov, setHov] = useState(-1);
  const look = (i: number, enabled: boolean) => {
    const base = kind === "stonecutter" ? "recipe" : "pattern";
    const url = enabled ? containerSprite(`${kind}/${base}${i === sel ? "_selected" : i === hov ? "_highlighted" : ""}`, bw, bh) : "";
    return url || buttonUrl(bw, bh, !enabled ? "disabled" : i === sel ? "hover" : "normal");
  };
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
            onMouseEnter={() => {
              setHov(i);
              setTip([o.label]);
            }}
            onMouseLeave={() => {
              setHov(-1);
              setTip([]);
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              if (o.enabled) onPick(i);
            }}
            style={{ position: "absolute", left: x, top: y, width: bw, height: bh, backgroundImage: `url(${look(i, o.enabled)})`, cursor: "pointer" }}
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
      <div style={{ position: "absolute", left: gx + cols * bw + 3, top: gy + thumbY, width: 12, height: 15, backgroundImage: `url(${containerSprite(`${kind}/scroller${maxScroll ? "" : "_disabled"}`, 12, 15) || buttonUrl(12, 15, maxScroll ? "normal" : "disabled")})` }} />
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
  const field = containerSprite(`anvil/text_field${first ? "" : "_disabled"}`, 110, 16);
  return (
    <>
      {field ? (
        <Img src={field} x={59} y={20} w={110} h={16} />
      ) : (
        <>
          <Box x={59} y={20} w={110} h={16} bg={first ? "#000" : "#222"} />
          <Box x={59} y={20} w={110} h={1} bg="#a0a0a0" />
        </>
      )}
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
      {noOutput && <NoOutput path="anvil" x={99} y={45} cx={103} cy={48} />}
      {(cost > 0 && (hasOut || tooExpensive)) && (
        <>
          <Box x={176 - 8 - lw - 2} y={67} w={lw + 4} h={12} bg="rgba(0,0,0,0.31)" />
          <Text text={label} color={tooExpensive || !afford ? 0xff6060 : 0x80ff20} x={176 - 8 - lw} y={69} />
        </>
      )}
    </>
  );
}
