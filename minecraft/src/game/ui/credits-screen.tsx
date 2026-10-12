"use client";

import { useEffect, useRef, useState } from "react";
import { Text, useGui } from "./gui";
import { Button, useKeyDown } from "./widgets";

// Original fan-written text. It is not the vanilla End Poem.
const LINES: [string, number?][] = [
  ["MINECRAFT", 0xffffff],
  [""],
  ["§7A browser tribute to 1.21 Tricky Trials"],
  [""], [""], [""],
  ["§3The dragon falls and the island goes quiet."],
  ["§3Only the wind is left, and the far hum of the void."],
  [""],
  ["§2Remember the first night?"],
  ["§2A hole in a hillside, a door of dirt,"],
  ["§2and the groan of something just outside."],
  [""],
  ["§3You punched a tree because nobody told you not to."],
  ["§3You learned that sand falls and gravel lies."],
  ["§3You learned that creepers do not knock."],
  [""],
  ["§2Then a furnace. Then iron. Then a pickaxe"],
  ["§2that could chew through the bones of the world."],
  ["§2You went down until the lava lit your face,"],
  ["§2and you came back up with a pocket of blue."],
  [""],
  ["§3You stood in a purple frame and stepped through fire."],
  ["§3You read the eyes and followed them under the hills."],
  ["§3You filled twelve sockets with a stranger's gaze"],
  ["§3and jumped into the stars without a map."],
  [""],
  ["§2Now the portal hums behind you."],
  ["§2Your bed is where you left it. The wheat has grown."],
  ["§2The villagers still haggle over emeralds,"],
  ["§2and the sun still comes up square."],
  [""],
  ["§3There is no ending here. Only the next block."],
  ["§3Go home. Build something. Come back stranger."],
  [""], [""], [""],
  ["§eThis tribute was made with"],
  [""],
  ["§fthree.js, React and Next.js"],
  ["§fWeb Audio for every sound"],
  ["§fCanvas pixels for every texture"],
  [""],
  ["§eInspired by"],
  [""],
  ["§fMinecraft by Mojang Studios"],
  ["§7Not affiliated with or endorsed by Mojang or Microsoft"],
  [""], [""],
  ["§eThank you for playing"],
  [""], [""], [""],
];

const LINE_H = 12;

export function CreditsScreen({ onDone }: { onDone: () => void }) {
  const { width, height } = useGui();
  const [scroll, setScroll] = useState(0);
  const fast = useRef(false);
  const done = useRef(false);
  const total = LINES.length * LINE_H + height;
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };
  useKeyDown((e) => {
    if (e.key === "Escape") finish();
  });
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === "Control") fast.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === "Control") fast.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      setScroll((s) => s + dt * (fast.current ? 120 : 20));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
  useEffect(() => {
    if (scroll > total) finish();
  });
  const top = height - scroll;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width, height, background: "#000", pointerEvents: "auto", overflow: "hidden" }}>
      {LINES.map(([t, c], i) => {
        const y = top + i * LINE_H;
        if (y < -40 || y > height + 10 || !t) return null;
        return i === 0 ? <Text key={i} text={t} color={c} x={width / 2} y={y - 16} align="center" scale={3} /> : <Text key={i} text={t} color={c ?? 0xffffff} x={width / 2} y={y} align="center" />;
      })}
      <div style={{ position: "absolute", left: 0, top: 0, width, height: 24, background: "linear-gradient(#000, rgba(0,0,0,0))" }} />
      <Button x={width - 64} y={height - 24} width={58} height={20} label="Skip" onClick={finish} />
    </div>
  );
}
