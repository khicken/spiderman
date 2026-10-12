"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { paintBlockTexture } from "../textures/index";
import { signEdit, type SignEditRequest } from "../systems/decor/sign-edit";
import { textWidth } from "./font";
import { Text, useGui } from "./gui";
import { Button, Screen, useKeyDown } from "./widgets";

interface InputGate {
  setInputBlocked(b: boolean): void;
  lock(): void;
}

const texUrls = new Map<string, string>();
function texUrl(key: string): string {
  let u = texUrls.get(key);
  if (u) return u;
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 16;
  c.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(paintBlockTexture(key)), 16, 16), 0, 0);
  u = c.toDataURL();
  texUrls.set(key, u);
  return u;
}

export function HideWhileSigning({ children }: { children: ReactNode }) {
  const req = useSyncExternalStore(signEdit.subscribe, signEdit.get, () => null);
  return req ? null : <>{children}</>;
}

export function SignEditScreen({ game }: { game: InputGate | null }) {
  const req = useSyncExternalStore(signEdit.subscribe, signEdit.get, () => null);
  const gate = useRef(game);
  gate.current = game;
  useEffect(() => {
    if (!req) return;
    gate.current?.setInputBlocked(true);
    if (document.pointerLockElement) document.exitPointerLock();
    return () => {
      gate.current?.setInputBlocked(false);
      gate.current?.lock();
    };
  }, [req]);
  if (!req) return null;
  return <Editor req={req} />;
}

function Editor({ req }: { req: SignEditRequest }) {
  const { width, height } = useGui();
  const [lines, setLines] = useState(() => req.lines.slice(0, 4));
  const [row, setRow] = useState(0);
  const [caret, setCaret] = useState(() => (req.lines[0] ?? "").length);
  const [blink, setBlink] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setBlink((b) => b + 1), 300);
    return () => clearInterval(t);
  }, []);

  const edit = (next: string[], nextCaret: number) => {
    setLines(next);
    setCaret(nextCaret);
    req.update(next);
  };
  const move = (r: number) => {
    const nr = (r + 4) & 3;
    setRow(nr);
    setCaret(lines[nr].length);
  };
  const done = () => signEdit.close(lines);

  useKeyDown((e) => {
    const line = lines[row];
    let handled = true;
    if (e.key === "Escape") done();
    else if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "Tab") move(row + 1);
    else if (e.key === "ArrowUp") move(row - 1);
    else if (e.key === "ArrowLeft") setCaret(Math.max(0, caret - 1));
    else if (e.key === "ArrowRight") setCaret(Math.min(line.length, caret + 1));
    else if (e.key === "Home") setCaret(0);
    else if (e.key === "End") setCaret(line.length);
    else if (e.key === "Backspace") {
      if (caret > 0) edit(lines.map((l, i) => (i === row ? l.slice(0, caret - 1) + l.slice(caret) : l)), caret - 1);
    } else if (e.key === "Delete") {
      if (caret < line.length) edit(lines.map((l, i) => (i === row ? l.slice(0, caret) + l.slice(caret + 1) : l)), caret);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && e.key !== "§") {
      const next = line.slice(0, caret) + e.key + line.slice(caret);
      if (textWidth(next) <= req.maxWidth) edit(lines.map((l, i) => (i === row ? next : l)), caret + 1);
    } else handled = false;
    if (handled) e.preventDefault();
  });

  const cx = Math.floor(width / 2);
  const bw = req.hanging ? 72 : 96;
  const bh = req.hanging ? 44 : 48;
  const top = req.hanging ? 78 : 64;
  const lh = req.hanging ? 9 : 10;
  const bx = cx - bw / 2;
  const textTop = top + Math.floor((bh - lh * 4) / 2) + 1;
  const wood = { backgroundImage: `url(${texUrl(req.texture)})`, backgroundSize: "48px 48px", imageRendering: "pixelated" as const };
  const caretOn = blink % 2 === 0;
  const lineText = lines[row];
  const caretX = cx - textWidth(lineText) / 2 + textWidth(lineText.slice(0, caret));

  return (
    <Screen background="ingame">
      <Text text="Edit Sign Message" x={cx} y={40} align="center" />
      {req.standing && <div style={{ position: "absolute", left: cx - 4, top: top + bh, width: 8, height: 56, ...wood, filter: "brightness(0.7)", boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.5)" }} />}
      {req.hanging && [-26, 22].map((dx) => (
        <div key={dx} style={{ position: "absolute", left: cx + dx, top: top - 24, width: 4, height: 24, background: "repeating-linear-gradient(#3b3f4a 0 3px, #6b7180 3px 6px)" }} />
      ))}
      {req.hanging && <div style={{ position: "absolute", left: bx - 4, top: top - 6, width: bw + 8, height: 6, ...wood, filter: "brightness(0.75)", boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.5)" }} />}
      <div style={{ position: "absolute", left: bx, top, width: bw, height: bh, ...wood, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.45), inset 0 0 0 2px rgba(255,255,255,0.08)" }} />
      {lines.map((l, i) => (
        <Text key={i} text={l} color={req.color} shadow={false} x={cx} y={textTop + i * lh} align="center" />
      ))}
      {caretOn && (
        caret >= lineText.length
          ? <Text text="_" color={req.color} shadow={false} x={caretX} y={textTop + row * lh} />
          : <div style={{ position: "absolute", left: caretX, top: textTop + row * lh - 1, width: 1, height: 9, background: `#${req.color.toString(16).padStart(6, "0")}` }} />
      )}
      <Button x={cx - 100} y={Math.floor(height / 4 + 144)} label="Done" onClick={done} />
    </Screen>
  );
}
