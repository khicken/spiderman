"use client";

import { useEffect, useState } from "react";
import type { MerchantView } from "../contracts";
import { Text } from "./gui";
import { ItemIcon, tooltipLines } from "./item-icon";
import { arrowUrl, buttonUrl, pixelUrl } from "./sprites";

const ROWS = 7;
const Img = ({ src, x, y, w, h }: { src: string; x: number; y: number; w: number; h: number }) => (
  <img alt="" src={src} width={w} height={h} draggable={false} style={{ position: "absolute", left: x, top: y, imageRendering: "pixelated", pointerEvents: "none" }} />
);
const Box = ({ x, y, w, h, bg }: { x: number; y: number; w: number; h: number; bg: string }) => <div style={{ position: "absolute", left: x, top: y, width: w, height: h, background: bg, pointerEvents: "none" }} />;

const outUrl = () =>
  pixelUrl("trade_out", 10, 9, (x, y) => (Math.abs(x - y - 0.5) <= 0.6 || Math.abs(x + y - 9) <= 0.6 ? 0xffff3030 : 0));
const xpBarUrl = (fill: number) =>
  pixelUrl(`trade_xp:${fill}`, 102, 5, (x, y) => {
    if (y === 0 || y === 4 || x === 0 || x === 101) return 0xff000000;
    return x <= fill ? (y === 1 ? 0xff9cff70 : 0xff80ff20) : 0xff3b3b3b;
  });

export interface MerchantProps {
  merchant: MerchantView;
  noOutput: boolean;
  choose: (id: string) => void;
  setTip: (lines: string[]) => void;
}

export function MerchantPanel({ merchant: m, noOutput, choose, setTip }: MerchantProps) {
  const [scroll, setScroll] = useState(0);
  const max = Math.max(0, m.trades.length - ROWS);
  useEffect(() => setScroll((s) => Math.min(s, max)), [max]);
  const tip = (lines: string[]) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setTip(lines);
  };
  const thumb = max ? Math.round((scroll / max) * (139 - 27)) : 0;
  const xpFill = m.level >= 5 ? 100 : Math.round(((m.xp - m.xpMin) / Math.max(1, m.xpMax - m.xpMin)) * 100);
  return (
    <>
      <Text text="Trades" color={0x404040} shadow={false} x={53} y={6} align="center" />
      {m.level > 0 && <Img src={xpBarUrl(Math.max(0, Math.min(100, xpFill)))} x={136} y={16} w={102} h={5} />}
      <div onWheel={(e) => setScroll((s) => Math.max(0, Math.min(max, s + Math.sign(e.deltaY))))}>
        {m.trades.slice(scroll, scroll + ROWS).map((t, k) => {
          const i = scroll + k;
          const look = i === m.selected ? "hover" : "normal";
          const discount = t.price !== t.buy.count;
          return (
            <div
              key={i}
              onMouseDown={(e) => {
                e.stopPropagation();
                choose(String(i));
              }}
              onMouseLeave={() => setTip([])}
              style={{ position: "absolute", left: 5, top: 18 + k * 20, width: 88, height: 20, backgroundImage: `url(${buttonUrl(88, 20, look)})`, cursor: "pointer" }}
            >
              <div onMouseEnter={tip(tooltipLines({ ...t.buy, count: t.price }))} style={{ position: "absolute", left: 3, top: 2, width: 18, height: 16 }}>
                <ItemIcon stack={{ ...t.buy, count: t.price }} x={discount ? 1 : 0} y={0} />
              </div>
              {discount && (
                <>
                  <Text text={String(t.buy.count)} color={0xa0a0a0} x={0} y={1} />
                  <Box x={0} y={4} w={8} h={1} bg="#ff3030" />
                </>
              )}
              {t.buyB && (
                <div onMouseEnter={tip(tooltipLines(t.buyB))} style={{ position: "absolute", left: 30, top: 2, width: 16, height: 16 }}>
                  <ItemIcon stack={t.buyB} x={0} y={0} />
                </div>
              )}
              <Img src={t.out ? outUrl() : arrowUrl(0, 10, 9)} x={53} y={6} w={10} h={9} />
              <div onMouseEnter={tip(tooltipLines(t.sell))} style={{ position: "absolute", left: 68, top: 2, width: 16, height: 16 }}>
                <ItemIcon stack={t.sell} x={0} y={0} />
              </div>
              {t.out && <Box x={0} y={0} w={88} h={20} bg="rgba(0,0,0,0.35)" />}
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 94, top: 18, width: 6, height: 139, background: "#8b8b8b", boxShadow: "inset 1px 1px 0 #373737, inset -1px -1px 0 #fff" }}>
        <div style={{ position: "absolute", left: 0, top: thumb, width: 6, height: 27, backgroundImage: `url(${buttonUrl(6, 27, max ? "normal" : "disabled")})` }} />
      </div>
      <Img src={arrowUrl(0)} x={186} y={38} w={22} h={15} />
      {noOutput && m.selected >= 0 && <Img src={outUrl()} x={192} y={41} w={10} h={9} />}
    </>
  );
}
