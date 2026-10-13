"use client";

import { useEffect, useState } from "react";
import { textWidth } from "./font";
import { Text, useGui } from "./gui";
import { SUBTITLE_MS, subtitleLines } from "../systems/features/subtitles";

// Vanilla SubtitleOverlay: bottom-right list, newest at the bottom, text fades from white to gray over 3 seconds.
export function Subtitles() {
  const { width, height } = useGui();
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, []);
  const lines = subtitleLines();
  if (!lines.length) return null;
  const now = performance.now();
  const maxW = Math.max(...lines.map((l) => textWidth(l.text)));
  const j = maxW + textWidth("<") + textWidth(" ") * 2 + textWidth(">");
  const cx = width - Math.floor(j / 2) - 2;
  const ordered = [...lines].sort((a, b) => b.at - a.at);
  return (
    <>
      {ordered.map((l, i) => {
        const cy = height - 35 - i * 10;
        const t = Math.max(0, Math.min(1, (now - l.at) / SUBTITLE_MS));
        const g = Math.round(255 - t * (255 - 104));
        const color = (g << 16) | (g << 8) | g;
        return (
          <div key={l.text}>
            <div style={{ position: "absolute", left: cx - Math.floor(j / 2) - 1, top: cy - 5, width: j + 2, height: 10, background: "rgba(0,0,0,0.8)" }} />
            <Text text={l.text} color={color} shadow={false} x={cx} y={cy - 4} align="center" />
            {l.dir < 0 && <Text text="<" color={color} shadow={false} x={cx - Math.floor(j / 2)} y={cy - 4} />}
            {l.dir > 0 && <Text text=">" color={color} shadow={false} x={cx + Math.floor(j / 2)} y={cy - 4} align="right" />}
          </div>
        );
      })}
    </>
  );
}
