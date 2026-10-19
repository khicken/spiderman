"use client";

import { useState } from "react";
import { Text, useGui } from "./gui";
import { Button, Screen, useKeyDown } from "./widgets";
import { ScrollList } from "./options-screen";
import { ItemIcon } from "./item-icon";

export interface ItemStatRow {
  item: string;
  name: string;
  mined: number;
  crafted: number;
  used: number;
}

const ITEM_COLS: [keyof ItemStatRow, string][] = [["mined", "iron_pickaxe"], ["crafted", "crafting_table"], ["used", "stick"]];

export function StatisticsScreen({ general, items = [], mobs = [], onDone }: { general: [string, string][]; items?: ItemStatRow[]; mobs?: [string, string][]; onDone: () => void }) {
  const { width, height } = useGui();
  const [tab, setTab] = useState<"general" | "items" | "mobs">("general");
  useKeyDown((e) => e.key === "Escape" && onDone());
  const cx = Math.floor(width / 2);
  const rows = tab === "general" ? general : tab === "mobs" ? mobs : [];
  if (tab === "items") {
    return (
      <Screen background="ingame">
        <Text text="Statistics" x={cx} y={20} align="center" />
        {ITEM_COLS.map(([, icon], i) => (
          <ItemIcon key={icon} stack={{ item: icon, count: 1 }} x={cx - 8 + i * 50} y={32} count={false} />
        ))}
        <ScrollList top={52} bottom={height - 64} content={items.length * 20 + 8}>
          {(scroll) => (
            <>
              {items.map((r, i) => {
                const y = 2 + i * 20 - scroll;
                return (
                  <div key={r.item}>
                    <ItemIcon stack={{ item: r.item, count: 1 }} x={cx - 110} y={y} count={false} />
                    {ITEM_COLS.map(([k], c) => {
                      const v = r[k] as number;
                      return <Text key={k} text={v ? String(v) : "-"} color={i % 2 ? 0x909090 : 0xffffff} x={cx + 8 + c * 50} y={y + 5} align="right" />;
                    })}
                  </div>
                );
              })}
              {items.length === 0 && <Text text="No statistics yet" color={0xa0a0a0} x={cx} y={20} align="center" />}
            </>
          )}
        </ScrollList>
        <Button x={cx - 160} y={height - 52} width={100} label="General" onClick={() => setTab("general")} />
        <Button x={cx - 50} y={height - 52} width={100} label="Items" disabled onClick={() => setTab("items")} />
        <Button x={cx + 60} y={height - 52} width={100} label="Mobs" onClick={() => setTab("mobs")} />
        <Button x={cx - 100} y={height - 28} label="Done" onClick={onDone} />
      </Screen>
    );
  }
  return (
    <Screen background="ingame">
      <Text text="Statistics" x={cx} y={20} align="center" />
      <ScrollList top={32} bottom={height - 64} content={rows.length * 10 + 8}>
        {(scroll) => (
          <>
            {rows.map(([k, v], i) => {
              const y = 4 + i * 10 - scroll;
              return (
                <div key={`${k}-${i}`}>
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
      <Button x={cx - 50} y={height - 52} width={100} label="Items" onClick={() => setTab("items")} />
      <Button x={cx + 60} y={height - 52} width={100} label="Mobs" disabled={tab === "mobs"} onClick={() => setTab("mobs")} />
      <Button x={cx - 100} y={height - 28} label="Done" onClick={onDone} />
    </Screen>
  );
}
