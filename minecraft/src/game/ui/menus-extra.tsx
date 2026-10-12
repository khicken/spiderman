"use client";

import { useState } from "react";
import { Text, useGui } from "./gui";
import { Button, Screen, useKeyDown } from "./widgets";
import { ScrollList } from "./options-screen";

export function StatisticsScreen({ general, onDone }: { general: [string, string][]; onDone: () => void }) {
  const { width, height } = useGui();
  const [tab, setTab] = useState<"general" | "items" | "mobs">("general");
  useKeyDown((e) => e.key === "Escape" && onDone());
  const cx = Math.floor(width / 2);
  const rows = tab === "general" ? general : [];
  return (
    <Screen background="ingame">
      <Text text="Statistics" x={cx} y={20} align="center" />
      <ScrollList top={32} bottom={height - 64} content={rows.length * 10 + 8}>
        {(scroll) => (
          <>
            {rows.map(([k, v], i) => {
              const y = 4 + i * 10 - scroll;
              return (
                <div key={k}>
                  <Text text={k} color={i % 2 ? 0x909090 : 0xffffff} x={cx - 108} y={y} />
                  <Text text={v} color={i % 2 ? 0x909090 : 0xffffff} x={cx + 108} y={y} align="right" />
                </div>
              );
            })}
            {rows.length === 0 && <Text text="No statistics yet" color={0xa0a0a0} x={cx} y={20} align="center" />}
          </>
        )}
      </ScrollList>
      <Button x={cx - 160} y={height - 52} width={100} label="General" disabled={tab === "general"} onClick={() => setTab("general")} />
      <Button x={cx - 50} y={height - 52} width={100} label="Items" disabled={tab === "items"} onClick={() => setTab("items")} />
      <Button x={cx + 60} y={height - 52} width={100} label="Mobs" disabled={tab === "mobs"} onClick={() => setTab("mobs")} />
      <Button x={cx - 100} y={height - 28} label="Done" onClick={onDone} />
    </Screen>
  );
}
