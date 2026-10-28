"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { textWidth, wrapText } from "./font";
import { Text, useGui } from "./gui";
import { Button, TextField } from "./widgets";

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
  suggest?: (line: string) => { start: number; list: string[]; usage: string[] }; // popup and usage text
  textOpacity?: number;
  bgOpacity?: number;
  lineSpacing?: number;
  chatWidth?: number;
  keepOpen?: boolean; // Enter sends and clears instead of closing (in-bed chat)
}

const WIDTH = 320;
const LINE = 9;

const fade = (ageMs: number) => {
  let t = 1 - ageMs / 50 / 200;
  t = Math.max(0, Math.min(1, t * 10));
  return t * t;
};

export function Chat({ messages, open, initial = "", onSend, onClose, complete, suggest, textOpacity = 1, bgOpacity = 0.5, lineSpacing = 0, chatWidth = WIDTH, keepOpen }: ChatProps) {
  const lineH = Math.floor(LINE * (1 + lineSpacing));
  const textY = lineH + Math.round(-8 * (lineSpacing + 1) + 4 * lineSpacing);
  const { width, height } = useGui();
  const [value, setValue] = useState(initial);
  const [scroll, setScroll] = useState(0);
  const [, setNow] = useState(0);
  const history = useRef<string[]>([]);
  const histPos = useRef(-1);
  const draft = useRef("");
  const tab = useRef<{ base: string; start: number; list: string[]; i: number } | null>(null);
  const [sel, setSel] = useState(0);
  const [quiet, setQuiet] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setValue(initial);
      histPos.current = -1;
      setQuiet(false);
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
    for (const m of messages.slice(-100)) wrapText(m.text, chatWidth, true).forEach((t, i) => out.push({ key: `${m.id}:${i}`, text: t, at: m.at, color: m.color ?? 0xffffff }));
    return out;
  }, [messages, chatWidth]);

  const setCaretEnd = () =>
    requestAnimationFrame(() => {
      const el = input.current;
      if (el) el.setSelectionRange(el.value.length, el.value.length);
    });

  const sug = open && suggest && !quiet && value.startsWith("/") ? suggest(value) : null;
  const shown = tab.current ? tab.current.list : sug?.list ?? [];
  const pick = tab.current ? tab.current.i : Math.min(sel, Math.max(0, shown.length - 1));

  const edit = (v: string) => {
    tab.current = null;
    setQuiet(false);
    setSel(0);
    setValue(v);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Tab" && e.key !== "ArrowUp" && e.key !== "ArrowDown") tab.current = null;
    if (e.key === "Enter") {
      const line = value.trim();
      if (line) {
        if (history.current[history.current.length - 1] !== line) history.current.push(line);
        onSend(line);
      }
      if (!keepOpen) onClose();
      else {
        setValue("");
        histPos.current = -1;
        setQuiet(false);
      }
    } else if (e.key === "Escape") onClose();
    else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && shown.length) {
      e.preventDefault();
      const n = shown.length;
      const i = (pick + (e.key === "ArrowUp" ? n - 1 : 1)) % n;
      if (tab.current) {
        tab.current.i = i;
        setValue(value.slice(0, tab.current.start) + shown[i]);
        setCaretEnd();
      }
      setSel(i);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
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
      tab.current = null;
      setQuiet(true);
      setCaretEnd();
    } else if (e.key === "Tab") {
      e.preventDefault();
      const cur = quiet && suggest && value.startsWith("/") ? suggest(value) : sug;
      setQuiet(false);
      if (cur) {
        if (!tab.current) {
          if (!cur.list.length) return;
          tab.current = { base: value, start: cur.start, list: cur.list, i: quiet ? 0 : pick };
        } else tab.current.i = (tab.current.i + (e.shiftKey ? tab.current.list.length - 1 : 1)) % tab.current.list.length;
        const t = tab.current;
        setValue(value.slice(0, t.start) + t.list[t.i]);
        setCaretEnd();
        return;
      }
      if (!complete) return;
      if (!tab.current) tab.current = { base: value, start: 0, list: complete(value), i: -1 };
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

  // Vanilla CommandSuggestions layout: popup rows 12 px tall above the input, at the argument's x.
  const inputW = width - 8;
  const startX = sug ? 4 + textWidth(value.slice(0, tab.current?.start ?? sug.start)) : 4;
  const rows = Math.min(10, shown.length);
  const first = Math.max(0, Math.min(pick - rows + 1, shown.length - rows));
  const tips = shown.slice(first, first + rows);
  const tipW = Math.max(0, ...tips.map((t) => textWidth(t)));
  const tipX = Math.max(0, Math.min(startX, 4 + inputW - tipW));
  const full = shown.length ? value.slice(0, tab.current?.start ?? sug?.start ?? 0) + shown[pick] : "";
  const ghost = !tab.current && full.startsWith(value) ? full.slice(value.length) : "";
  const usage = !shown.length && sug ? sug.usage.slice(0, 8) : [];
  const usageW = Math.max(0, ...usage.map((t) => textWidth(t)));
  const usageX = Math.max(0, Math.min(startX, 4 + inputW - usageW));

  return (
    <>
      <div
        style={{ position: "absolute", left: 0, top: 0, width, height, pointerEvents: open ? "auto" : "none" }}
        onWheel={(e) => open && setScroll((s) => Math.max(0, Math.min(Math.max(0, lines.length - maxLines), s - Math.sign(e.deltaY))))}
        onMouseDown={() => requestAnimationFrame(() => input.current?.focus())}
      >
        {visible.map((l, i) => {
          const y = bottom - (i + 1) * lineH;
          return (
            <div key={l.key} style={{ position: "absolute", left: 0, top: y, width: chatWidth + 12, height: lineH, background: `rgba(0,0,0,${bgOpacity * l.alpha})` }}>
              <Text text={l.text} color={l.color} amp x={4} y={textY} opacity={l.alpha * (textOpacity * 0.9 + 0.1)} />
            </div>
          );
        })}
        {open && (
          <>
            <div style={{ position: "absolute", left: 2, top: height - 14, width: width - 4, height: 12, background: "rgba(0,0,0,0.5)" }} />
            <TextField x={4} y={height - 12} width={width - 8} height={9} value={value} onChange={edit} onKey={onKey} bordered={false} maxLength={256} textColor={0xe0e0e0} inputRef={input} />
            {ghost && <Text text={ghost} color={0x808080} x={4 + textWidth(value)} y={height - 12} />}
            {tips.length > 0 && (
              <div style={{ position: "absolute", left: tipX - 1, top: height - 15 - tips.length * 12, width: tipW + 1, height: tips.length * 12, background: "rgba(0,0,0,0.816)" }}>
                {tips.map((t, i) => (
                  <Text key={t} text={t} color={first + i === pick ? 0xffff00 : 0xaaaaaa} x={1} y={2 + i * 12} />
                ))}
              </div>
            )}
            {usage.map((u, i) => (
              <div key={u} style={{ position: "absolute", left: usageX - 1, top: height - 27 - 12 * i, width: usageW + 2, height: 12, background: "rgba(0,0,0,0.816)" }}>
                <Text text={u} color={0xaaaaaa} x={1} y={2} />
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}

// Vanilla InBedChatScreen button.
export function LeaveBedButton({ onLeave }: { onLeave: () => void }) {
  const { width, height } = useGui();
  return <Button x={Math.floor(width / 2) - 100} y={height - 40} label="Leave Bed" onClick={onLeave} />;
}
