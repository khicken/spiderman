"use client";

import type { ContainerView } from "../contracts";
import { EFFECTS } from "./data";
import { Text } from "./gui";
import { effectIcon } from "./hud";
import { ItemIcon } from "./item-icon";
import { buttonUrl, pixelUrl } from "./sprites";
import { playClick } from "./widgets";

type Opt = NonNullable<ContainerView["options"]>[number];

const ROWS = [22, 47, 72];
const PAY_ICONS = ["netherite_ingot", "emerald", "diamond", "gold_ingot", "iron_ingot"];
const check = pixelUrl("beacon_check", 14, 14, (x, y) => ((y === 9 - Math.abs(x - 5) || y === 10 - Math.abs(x - 5)) && x >= 1 && x <= 12 && (x <= 5 ? y >= 7 : true) ? 0xff40ff40 : 0));
const cross = pixelUrl("beacon_cross", 14, 14, (x, y) => (x >= 2 && x <= 11 && (Math.abs(x - y) <= 0.5 || Math.abs(x + y - 13) <= 0.5) ? 0xffff4040 : 0));

function Btn({ o, x, y, onPick, setTip, children }: { o: Opt; x: number; y: number; onPick: (id: string) => void; setTip: (l: string[]) => void; children: React.ReactNode }) {
  const look = !o.enabled ? "disabled" : o.cost ? "hover" : "normal";
  return (
    <div
      onMouseDown={(e) => {
        e.stopPropagation();
        if (!o.enabled) return;
        playClick();
        onPick(o.id);
      }}
      onMouseEnter={() => EFFECTS[o.label] && setTip([`§f${EFFECTS[o.label].name}${o.id.startsWith("secondary:") && o.label !== "regeneration" ? " II" : ""}`])}
      onMouseLeave={() => setTip([])}
      style={{ position: "absolute", left: x, top: y, width: 22, height: 22, cursor: o.enabled ? "pointer" : "default", backgroundImage: `url(${buttonUrl(22, 22, look)})`, outline: o.cost ? "1px solid #ffff80" : undefined }}
    >
      <div style={{ position: "absolute", left: 2, top: 2, opacity: o.enabled ? 1 : 0.5 }}>{children}</div>
    </div>
  );
}

export function BeaconExtras({ view, onOption, setTip }: { view: ContainerView; onOption?: (id: string) => void; setTip: (l: string[]) => void }) {
  const opts = view.options ?? [];
  const pick = (id: string) => onOption?.(id);
  const icon = (id: string) => <img alt="" src={effectIcon(id)} width={18} height={18} style={{ imageRendering: "pixelated", display: "block" }} />;
  const prim = opts.filter((o) => o.id.startsWith("primary:"));
  const sec = opts.filter((o) => o.id.startsWith("secondary:"));
  const confirm = opts.find((o) => o.id === "confirm");
  const cancel = opts.find((o) => o.id === "cancel");
  const tiers = [prim.slice(0, 2), prim.slice(2, 4), prim.slice(4, 5)];
  return (
    <>
      <Text text="Primary Power" color={0xe0e0e0} x={62} y={10} align="center" />
      <Text text="Secondary Power" color={0xe0e0e0} x={169} y={10} align="center" />
      {tiers.map((row, t) =>
        row.map((o, i) => (
          <Btn key={o.id} o={o} x={76 + i * 24 - (row.length * 22 + (row.length - 1) * 2) / 2} y={ROWS[t]} onPick={pick} setTip={setTip}>
            {icon(o.label)}
          </Btn>
        )),
      )}
      {sec.map((o, i) =>
        o.label ? (
          <Btn key={o.id + i} o={o} x={133 + i * 24} y={47} onPick={pick} setTip={setTip}>
            {icon(o.label)}
            {i === 1 && <Text text="II" x={14} y={10} />}
          </Btn>
        ) : null,
      )}
      {PAY_ICONS.map((it, i) => (
        <ItemIcon key={it} stack={{ item: it, count: 1 }} x={20 + i * 22} y={109} count={false} />
      ))}
      {confirm && (
        <Btn o={confirm} x={164} y={107} onPick={pick} setTip={setTip}>
          <img alt="" src={check} width={14} height={14} style={{ imageRendering: "pixelated", margin: 2 }} />
        </Btn>
      )}
      {cancel && (
        <Btn o={cancel} x={190} y={107} onPick={pick} setTip={setTip}>
          <img alt="" src={cross} width={14} height={14} style={{ imageRendering: "pixelated", margin: 2 }} />
        </Btn>
      )}
    </>
  );
}
