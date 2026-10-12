"use client";

import type { CSSProperties } from "react";
import { Text, useGui } from "./gui";
import { ItemIcon } from "./item-icon";
import { pixelUrl } from "./sprites";
import type { Toast } from "../systems/ui-bridge";

export interface ToastEntry extends Toast {
  id: number;
}

export const TOAST_MS = 6200;

const HEADER: Record<Toast["kind"], [string, number]> = {
  task: ["Advancement Made!", 0xffff00],
  goal: ["Goal Reached!", 0xffff00],
  challenge: ["Challenge Complete!", 0xff88ff],
};

const CSS = `@keyframes mc-toast { 0% { transform: translateX(160px) } 9% { transform: translateX(0) } 91% { transform: translateX(0) } 100% { transform: translateX(160px) } }`;

function frameUrl(): string {
  return pixelUrl("toast_frame", 160, 32, (x, y) => {
    const ex = Math.min(x, 159 - x), ey = Math.min(y, 31 - y);
    if (ex + ey < 2) return 0;
    if (ex === 0 || ey === 0 || ex + ey === 2) return 0xff000000;
    if (ex === 1 || ey === 1) return 0xff555555;
    if (ex === 2 || ey === 2) return 0xff2b2b2b;
    return 0xff202020;
  });
}

const abs = (x: number, y: number, w: number, h: number): CSSProperties => ({ position: "absolute", left: x, top: y, width: w, height: h });

export function Toasts({ toasts }: { toasts: ToastEntry[] }) {
  const { width } = useGui();
  return (
    <>
      <style>{CSS}</style>
      {toasts.slice(0, 5).map((t, i) => {
        const [head, color] = HEADER[t.kind];
        return (
          <div key={t.id} style={{ ...abs(width - 160, i * 32, 160, 32), animation: `mc-toast ${TOAST_MS}ms linear forwards`, backgroundImage: `url(${frameUrl()})` }}>
            <ItemIcon stack={{ item: t.icon, count: 1 }} x={8} y={8} count={false} />
            <Text text={head} color={color} x={30} y={7} />
            <Text text={t.title} color={0xffffff} x={30} y={18} />
          </div>
        );
      })}
    </>
  );
}
