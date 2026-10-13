import type { ToastKind } from "../ui-bridge";
import type { AdvTrigger } from "./bus";
import { STORY, NETHER, END } from "./defs-main";
import { ADVENTURE } from "./defs-adventure";
import { HUSBANDRY } from "./defs-husbandry";

export type TabId = "story" | "nether" | "end" | "adventure" | "husbandry";
export type Pred = (t: AdvTrigger) => boolean;

export interface AdvSpec {
  id: string;
  title: string;
  desc: string;
  icon: string;
  kind?: ToastKind;
  parent?: string;
  crit: Record<string, Pred>;
  any?: boolean; // one criterion is enough
  hidden?: boolean;
}

export interface AdvDef extends Required<Pick<AdvSpec, "id" | "title" | "desc" | "icon" | "crit">> {
  tab: TabId;
  kind: ToastKind;
  parent?: string;
  any: boolean;
  hidden: boolean;
  toast: boolean;
  x: number;
  y: number;
}

export const TABS: { id: TabId; title: string; icon: string; bg: string }[] = [
  { id: "story", title: "Minecraft", icon: "grass_block", bg: "stone" },
  { id: "nether", title: "Nether", icon: "red_nether_bricks", bg: "netherrack" },
  { id: "end", title: "The End", icon: "end_stone", bg: "end_stone" },
  { id: "adventure", title: "Adventure", icon: "map", bg: "dirt" },
  { id: "husbandry", title: "Husbandry", icon: "hay_block", bg: "hay_block_side" },
];

const SPECS: [TabId, AdvSpec[]][] = [["story", STORY], ["nether", NETHER], ["end", END], ["adventure", ADVENTURE], ["husbandry", HUSBANDRY]];

// Depth runs right, each leaf takes the next row, a parent sits midway between its first and last child (vanilla TreeNodePosition).
function layout(list: AdvDef[]) {
  const kids = new Map<string, AdvDef[]>();
  for (const a of list) if (a.parent) (kids.get(a.parent) ?? kids.set(a.parent, []).get(a.parent)!).push(a);
  let row = 0;
  const place = (a: AdvDef, depth: number) => {
    a.x = depth;
    const ch = kids.get(a.id);
    if (!ch?.length) {
      a.y = row++;
      return;
    }
    for (const c of ch) place(c, depth + 1);
    a.y = (ch[0].y + ch[ch.length - 1].y) / 2;
  };
  for (const a of list) if (!a.parent) place(a, 0);
}

export const ADVANCEMENTS: AdvDef[] = SPECS.flatMap(([tab, specs]) => {
  const list = specs.map(
    (s): AdvDef => ({ ...s, tab, kind: s.kind ?? "task", any: !!s.any, hidden: !!s.hidden, toast: !!s.parent, x: 0, y: 0 }),
  );
  layout(list);
  return list;
});

export const BY_ID = new Map(ADVANCEMENTS.map((a) => [a.id, a]));
export const BY_TITLE = new Map(ADVANCEMENTS.map((a) => [a.title.toLowerCase(), a]));
