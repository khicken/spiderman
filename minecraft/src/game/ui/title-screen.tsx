"use client";

import { useEffect, useRef, useState } from "react";
import { textWidth } from "./font";
import { Text, useGui } from "./gui";
import { Button, Screen } from "./widgets";
import { buttonUrl, gridUrl, pixelUrl } from "./sprites";
import { paintBlockTexture } from "../textures";

const LETTERS: Record<string, string[]> = {
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#"],
  E: ["####", "#...", "###.", "#...", "####"],
  C: [".###", "#...", "#...", "#...", ".###"],
  R: ["###.", "#..#", "###.", "#.#.", "#..#"],
  A: [".##.", "#..#", "####", "#..#", "#..#"],
  F: ["####", "#...", "###.", "#...", "#..."],
  T: ["#####", "..#..", "..#..", "..#..", "..#.."],
};
const CW = 5;
const CH = 6;
const DEPTH = 4;

export function minecraftLogo() {
  const word = "MINECRAFT";
  const cells = [...word].reduce((n, ch) => n + LETTERS[ch][0].length + 1, -1);
  const w = cells * CW + DEPTH + 2;
  const h = 5 * CH + DEPTH + 2;
  const front = new Uint8Array(w * h);
  let cx = 0;
  for (const ch of word) {
    const g = LETTERS[ch];
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < g[r].length; c++)
        if (g[r][c] === "#")
          for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) front[(1 + r * CH + y) * w + 1 + (cx + c) * CW + x] = 1;
    cx += g[0].length + 1;
  }
  const side = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let d = 1; d <= DEPTH; d++) if (x - d >= 0 && y - d >= 0 && front[(y - d) * w + x - d]) side[y * w + x] = 1;
  const stone = typeof document === "undefined" ? null : paintBlockTexture("stone");
  const tex = (x: number, y: number, k: number) => {
    if (!stone) return 0xff000000 | (Math.round(128 * k) * 0x010101);
    const o = ((y % 16) * 16 + (x % 16)) * 4;
    const f = (v: number) => Math.min(255, Math.round(v * k));
    return (0xff000000 | (f(stone[o]) << 16) | (f(stone[o + 1]) << 8) | f(stone[o + 2])) >>> 0;
  };
  const url = pixelUrl("logo", w, h, (x, y) => {
    const i = y * w + x;
    if (front[i]) {
      const edgeTop = y > 0 && !front[i - w];
      const edgeLeft = x > 0 && !front[i - 1];
      return tex(x, y, edgeTop || edgeLeft ? 1.45 : 1.15);
    }
    if (side[i]) return tex(x + 7, y + 3, 0.5);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && (front[ny * w + nx] || side[ny * w + nx])) return 0xff000000;
      }
    return 0;
  });
  return { url, w, h };
}

export const SPLASHES = [
  "Now in a browser!",
  "Made of pixels!",
  "100% blocks!",
  "Punch a tree!",
  "Watch out for creepers!",
  "Also try sleeping at night!",
  "Diamonds below!",
  "Don't dig straight down!",
  "Mind the lava!",
  "Breeze approved!",
  "Tricky Trials!",
  "Now with a mace!",
  "Copper bulbs glow!",
  "Built with three.js!",
  "No downloads needed!",
  "Runs on TypeScript!",
  "Sixteen by sixteen!",
  "Infinite-ish!",
  "Also try Tab completion!",
  "Pigs fly, sort of!",
  "Stack it to 64!",
  "Rarely crashes!",
  "Crafted by hand!",
  "Smelt responsibly!",
  "Pixel perfect!",
  "Ender pearls are fun!",
  "Bring a bed!",
  "Squid ink included!",
  "One more block!",
  "Bees!",
  "Redstone inside!",
  "Hello, world!",
  "Look up!",
  "Now with trial chambers!",
  "Gravel falls!",
  "Mooshrooms are real!",
  "Keep calm and mine on!",
  "Dig, build, repeat!",
  "Also try fishing!",
  "Ominous!",
];

export interface TitleScreenProps {
  onSingleplayer: () => void;
  onOptions: () => void;
  version?: string;
  splash?: string;
}

export function TitleScreen({ onSingleplayer, onOptions, version = "Minecraft 1.21", splash }: TitleScreenProps) {
  const { width, height } = useGui();
  const [text] = useState(() => splash ?? SPLASHES[Math.floor(Math.random() * SPLASHES.length)]);
  const splashRef = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<{ url: string; w: number; h: number } | null>(null);
  useEffect(() => setImg(minecraftLogo()), []);
  useEffect(() => {
    let raf = 0;
    const tw = textWidth(text);
    const loop = () => {
      const t = (performance.now() % 1000) / 1000;
      const s = ((1.8 - Math.abs(Math.sin(t * Math.PI * 2)) * 0.1) * 100) / (tw + 32);
      if (splashRef.current) splashRef.current.style.transform = `rotate(-20deg) scale(${s})`;
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [text]);
  const bx = Math.floor(width / 2 - 100);
  const by = Math.floor(height / 4 + 48);
  const logoY = 30;
  return (
    <Screen background="none">
      {img && (
        <img alt="Minecraft" src={img.url} width={img.w} height={img.h} draggable={false} style={{ position: "absolute", left: Math.floor(width / 2 - img.w / 2), top: logoY, imageRendering: "pixelated" }} />
      )}
      <Text text="JAVA EDITION" color={0xd0d0d0} x={Math.floor(width / 2)} y={logoY + 40} align="center" />
      <div ref={splashRef} style={{ position: "absolute", left: Math.floor(width / 2 + 123), top: 69, width: 0, height: 0, transformOrigin: "0 0" }}>
        <Text text={text} color={0xffff00} x={0} y={-8} align="center" />
      </div>
      <Button x={bx} y={by} label="Singleplayer" onClick={onSingleplayer} />
      <Button x={bx} y={by + 24} label="Multiplayer" disabled />
      <Button x={bx} y={by + 48} label="Minecraft Realms" disabled />
      <IconButton x={bx - 24} y={by + 84} icon="language" />
      <Button x={bx} y={by + 84} width={98} label="Options..." onClick={onOptions} />
      <Button x={bx + 102} y={by + 84} width={98} label="Quit Game" disabled />
      <IconButton x={bx + 204} y={by + 84} icon="accessibility" />
      <Text text={version} x={2} y={height - 10} />
      <Text text="Not affiliated with Mojang or Microsoft" x={width - 2} y={height - 10} align="right" />
    </Screen>
  );
}

const ICONS: Record<"language" | "accessibility", string[]> = {
  language: [
    "....#####....",
    "..##.#.#.##..",
    ".#..#...#..#.",
    ".###########.",
    "#...#...#...#",
    "#...#...#...#",
    "#############",
    "#...#...#...#",
    "#...#...#...#",
    ".###########.",
    ".#..#...#..#.",
    "..##.#.#.##..",
    "....#####....",
  ],
  accessibility: [
    "......#......",
    ".....###.....",
    "......#......",
    ".###########.",
    "......#......",
    "......#......",
    "......#......",
    ".....#.#.....",
    "....#...#....",
    "...#.....#...",
    "..#.......#..",
    "",
    "",
  ],
};

function IconButton({ x, y, icon }: { x: number; y: number; icon: "language" | "accessibility" }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: 20, height: 20, backgroundImage: `url(${buttonUrl(20, 20, "normal")})` }}>
      <img alt="" src={gridUrl(`icon:${icon}`, ICONS[icon].map((r) => r.padEnd(13, ".")), { "#": 0xffffffff })} width={13} height={13} draggable={false} style={{ position: "absolute", left: 3, top: 3, imageRendering: "pixelated" }} />
    </div>
  );
}
