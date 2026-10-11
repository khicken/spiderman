"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { wrapText } from "./font";
import { Text, useGui } from "./gui";
import { TextField } from "./widgets";

export interface ChatMessage {
  id: number;
  text: string; // section-sign or "&" color codes
  at: number; // performance.now() when received
  color?: number;
}

export interface ChatProps {
  messages: ChatMessage[];
  open: boolean;
  initial?: string; // "/" when opened with the command key
  onSend: (line: string) => void;
  onClose: () => void;
  complete?: (line: string) => string[]; // full-line candidates for Tab
}

const WIDTH = 320;
const LINE = 9;

const fade = (ageMs: number) => {
  let t = 1 - ageMs / 50 / 200;
  t = Math.max(0, Math.min(1, t * 10));
  return t * t;
};

export function Chat({ messages, open, initial = "", onSend, onClose, complete }: ChatProps) {
  const { width, height } = useGui();
  const [value, setValue] = useState(initial);
  const [scroll, setScroll] = useState(0);
  const [, setNow] = useState(0);
  const history = useRef<string[]>([]);
  const histPos = useRef(-1);
  const draft = useRef("");
  const tab = useRef<{ base: string; list: string[]; i: number } | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setValue(initial);
      histPos.current = -1;
      setScroll(0);
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open, initial]);

  const newest = messages.length ? messages[messages.length - 1].at : 0;
  useEffect(() => {
    if (open) return;
    const id = setInterval(() => {
      const t = performance.now();
      setNow(t);
      if (t - newest > 10500) clearInterval(id);
    }, 100);
    return () => clearInterval(id);
  }, [open, newest]);

  const lines = useMemo(() => {
    const out: { key: string; text: string; at: number; color: number }[] = [];
    for (const m of messages.slice(-100)) wrapText(m.text, WIDTH, true).forEach((t, i) => out.push({ key: `${m.id}:${i}`, text: t, at: m.at, color: m.color ?? 0xffffff }));
    return out;
  }, [messages]);

  const setCaretEnd = () =>
    requestAnimationFrame(() => {
      const el = input.current;
      if (el) el.setSelectionRange(el.value.length, el.value.length);
    });

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Tab") tab.current = null;
    if (e.key === "Enter") {
      const line = value.trim();
      if (line) {
        if (history.current[history.current.length - 1] !== line) history.current.push(line);
        onSend(line);
      }
      onClose();
    } else if (e.key === "Escape") onClose();
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const h = history.current;
      if (!h.length) return;
      if (histPos.current === -1) draft.current = value;
      let p = histPos.current === -1 ? h.length : histPos.current;
      p += e.key === "ArrowUp" ? -1 : 1;
      if (p < 0) p = 0;
      if (p >= h.length) {
        histPos.current = -1;
        setValue(draft.current);
      } else {
        histPos.current = p;
        setValue(h[p]);
      }
      setCaretEnd();
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (!complete) return;
      if (!tab.current) tab.current = { base: value, list: complete(value), i: -1 };
      const t = tab.current;
      if (!t.list.length) return;
      t.i = (t.i + (e.shiftKey ? t.list.length - 1 : 1)) % t.list.length;
      setValue(t.list[t.i]);
      setCaretEnd();
    } else if (e.key === "PageUp") setScroll((s) => s + 10);
    else if (e.key === "PageDown") setScroll((s) => Math.max(0, s - 10));
  };

  const now = performance.now();
  const maxLines = open ? 20 : 10;
  const bottom = height - 40;
  const visible: { key: string; text: string; color: number; alpha: number }[] = [];
  const start = Math.max(0, Math.min(scroll, lines.length - maxLines));
  for (let i = lines.length - 1 - (open ? start : 0); i >= 0 && visible.length < maxLines; i--) {
    const l = lines[i];
    const alpha = open ? 1 : fade(now - l.at);
    if (alpha <= 0.02) break;
    visible.push({ key: l.key, text: l.text, color: l.color, alpha });
  }

  const tips = open && complete && value.startsWith("/") && !value.includes(" ") ? complete(value).slice(0, 10) : [];

  return (
    <>
      <div
        style={{ position: "absolute", left: 0, top: 0, width, height, pointerEvents: open ? "auto" : "none" }}
        onWheel={(e) => open && setScroll((s) => Math.max(0, Math.min(Math.max(0, lines.length - maxLines), s - Math.sign(e.deltaY))))}
        onMouseDown={() => requestAnimationFrame(() => input.current?.focus())}
      >
        {visible.map((l, i) => {
          const y = bottom - (i + 1) * LINE;
          return (
            <div key={l.key} style={{ position: "absolute", left: 0, top: y, width: WIDTH + 8, height: LINE, background: `rgba(0,0,0,${0.5 * l.alpha})` }}>
              <Text text={l.text} color={l.color} amp x={2} y={1} opacity={l.alpha} />
            </div>
          );
        })}
        {open && (
          <>
            <div style={{ position: "absolute", left: 2, top: height - 14, width: width - 4, height: 12, background: "rgba(0,0,0,0.5)" }} />
            <TextField x={4} y={height - 12} width={width - 8} height={9} value={value} onChange={setValue} onKey={onKey} bordered={false} maxLength={256} textColor={0xe0e0e0} inputRef={input} />
            {tips.length > 0 && (
              <div style={{ position: "absolute", left: 3, top: height - 16 - tips.length * 12, width: 150, height: tips.length * 12, background: "rgba(0,0,0,0.82)" }}>
                {tips.map((t, i) => (
                  <Text key={t} text={t} color={i === 0 ? 0xffff00 : 0xa0a0a0} x={2} y={2 + i * 12} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
