"use client";

import { Fragment, useState, type ReactNode } from "react";
import type { Device, HudSnapshot, QuestState, Settings, TrackTarget } from "./contracts";
import { BEACON_COLOR, BEACON_LANDMARK, shardProgress, LANDMARKS, WAYSTONES } from "./contracts";
import { Chapter, type BookTab } from "./ui-book";
import { Diamond, Flame, HeartIcon, IlluminatedCapital, Rule } from "./ui-ink";
import { IslandMap, samePick, type MapData, type MapPick } from "./ui-map";
import { Collection, type CollectData } from "./ui-memory";
import { BEACON_NAMES, BEACON_TRIALS, CREDITS, fmtClock, partOfDay, type LoreEntry, type UiPrefs } from "./ui-store";

export interface PageCtx {
  quest: QuestState | null;
  snap: HudSnapshot | null;
  lore: readonly LoreEntry[];
  map: MapData | null;
  settings: Settings;
  onSettings(s: Settings): void;
  prefs: UiPrefs;
  onPrefs(p: UiPrefs): void;
  device: Device;
  touch: boolean;
  onLore?(e: LoreEntry): void;
  collect: CollectData;
  selected: MapPick | null;
  onSelect(p: MapPick | null): void;
  onTrack(t: TrackTarget): void;
  onTravel(id: string): void;
  tracked?: TrackTarget;
  credits: string;
}

export function bookPages(tab: BookTab, c: PageCtx): { left: ReactNode; right: ReactNode } {
  switch (tab) {
    case "journal":
      return { left: <JournalQuest c={c} />, right: <JournalLore c={c} /> };
    case "map":
      return { left: <MapLeft c={c} />, right: <MapRight c={c} /> };
    case "settings":
      return { left: <SettingsSight c={c} />, right: <SettingsSound c={c} /> };
    case "controls":
      return { left: <ControlsKeys />, right: <ControlsOther device={c.device} /> };
    case "credits":
      return { left: <CreditsLeft />, right: <CreditsRight text={c.credits} /> };
  }
}

/* ------------------------------------------------------------------ journal */

function Check({ done }: { done: boolean }) {
  return (
    <svg viewBox="0 0 20 20" style={{ width: "1.1rem", height: "1.1rem", flex: "none", marginTop: "0.35rem" }} aria-hidden>
      <rect x="2" y="2" width="16" height="16" fill="none" stroke="var(--color-ink-soft)" strokeWidth="1.2" />
      {done && <path d="M4.5 10.5L8.5 14.5L17 3.5" stroke="var(--color-rubric)" strokeWidth="2.2" fill="none" strokeLinecap="round" />}
    </svg>
  );
}

function Entry({ done, title, children, icon, dim }: { done: boolean; title: string; children?: ReactNode; icon?: ReactNode; dim?: boolean }) {
  return (
    <li className="flex gap-[0.7rem]" style={{ opacity: dim ? 0.5 : 1, marginBottom: "0.55rem" }}>
      {icon ?? <Check done={done} />}
      <div className="min-w-0">
        <div className="font-display" style={{ fontSize: "1.3rem", fontWeight: 600, lineHeight: 1.2, textDecoration: done ? "line-through" : "none", textDecorationColor: "rgb(184 64 43 / 0.7)", textDecorationThickness: "1.5px" }}>{title}</div>
        {children && <div style={{ fontSize: "0.85rem", lineHeight: 1.45, color: "var(--color-ink-soft)", marginTop: "0.1rem" }}>{children}</div>}
      </div>
    </li>
  );
}

function DoneRow({ title }: { title: string }) {
  return (
    <li className="flex items-center gap-[0.6rem]" style={{ marginBottom: "0.2rem" }}>
      <Check done />
      <span className="font-display" style={{ fontSize: "1.05rem", lineHeight: 1.2, color: "var(--color-ink-soft)", textDecoration: "line-through", textDecorationColor: "rgb(184 64 43 / 0.7)" }}>{title}</span>
    </li>
  );
}

function TrackBtn({ c, t }: { c: PageCtx; t: TrackTarget }) {
  const on = samePick(c.tracked, t);
  return (
    <button data-nav="item" className="hm-link" style={{ fontSize: "0.85rem", marginLeft: "0.6rem", color: on ? "var(--color-rubric)" : "var(--color-ember-lo)" }} onClick={() => c.onTrack(on ? { kind: "none" } : t)} data-testid="track-btn">
      {on ? "Tracking" : "Track"}
    </button>
  );
}

function JournalQuest({ c }: { c: PageCtx }) {
  const q = c.quest;
  const s = c.snap;
  const beacons = q?.beacons ?? [false, false, false, false];
  const lit = beacons.filter(Boolean).length;
  const rule = s?.trialRule && s.trialRule !== s.objectiveSub && s.trialRule !== s.objective ? s.trialRule : null;
  const sub = rule ?? s?.objectiveSub;
  const gladeDone = !!q?.gladeLit, spireDone = !!q?.barrierDown;
  const items: { key: string; done: boolean; title?: string; el: ReactNode }[] = [
    { key: "glade", done: gladeDone, title: "Light the Glade Beacon", el: (
      <Entry done={gladeDone} title="Light the Glade Beacon">
        It stands in the glade north of the shrine.
        {!gladeDone && <TrackBtn c={c} t={{ kind: "glade" }} />}
      </Entry>) },
    { key: "beacons", done: lit === 4, title: "Light the 4 beacons", el: (
      <>
        <Entry done={lit === 4} title={`Light the 4 beacons · ${lit}/4`} />
        <ul style={{ paddingLeft: "1.2rem" }}>
          {BEACON_NAMES.map((n, i) => (
    <Entry key={n} done={beacons[i]} title={n} icon={<Flame color={BEACON_COLOR[i]} lit={beacons[i]} style={{ width: "1.1rem", height: "1.4rem", flex: "none", marginTop: "0.2rem", filter: beacons[i] ? `drop-shadow(0 0 0.3rem ${BEACON_COLOR[i]})` : undefined }} />}>
      {beacons[i] ? "Lit." : BEACON_TRIALS[i]}
      {!beacons[i] && <TrackBtn c={c} t={{ kind: "beacon", id: i as 0 | 1 | 2 | 3 }} />}
    </Entry>
  ))}
        </ul>
      </>) },
    ...(s?.hasBow ? [] : [{ key: "bow", done: false, el: <Entry done={false} title="Find a bow">Windward Beacon needs a bow. It is in the Mirebrook mill (west).</Entry> }]),
    { key: "spire", done: spireDone, title: "Climb to the Gloam Spire", el: (
      <Entry done={spireDone} title="Climb to the Gloam Spire" dim={lit < 4}>
        {lit < 4 ? "A barrier seals the summit of Mt. Cinder. Light the 4 beacons first." : "The barrier is gone. Climb Mt. Cinder."}
        {lit >= 4 && !spireDone && <TrackBtn c={c} t={{ kind: "spire" }} />}
      </Entry>) },
    { key: "warden", done: !!q?.wardenDefeated, title: "Defeat the Gloam Warden", el: <Entry done={!!q?.wardenDefeated} title="Defeat the Gloam Warden" dim={!q?.barrierDown} /> },
  ];
  return (
    <div data-testid="journal">
      <Chapter kicker={s ? `${partOfDay(s.timeOfDay)} · ${fmtClock(s.timeOfDay)} · ${s.weather}` : "Journal"} title="Journal" />
      {s && (
        <blockquote className="font-display" style={{ fontSize: "1.3rem", lineHeight: 1.35, padding: "0.5rem 0 0.7rem 1rem", borderLeft: "3px solid var(--color-ember)", marginBottom: "0.8rem", color: "var(--color-ink)" }}>
          {s.objective}
          {sub && <span style={{ display: "block", fontSize: "0.9rem", color: "var(--color-ink-soft)" }}>{sub}</span>}
        </blockquote>
      )}
      {[false, true].map((showDone) => {
        const list = items.filter((it) => it.done === showDone);
        if (!list.length) return null;
        return (
          <div key={String(showDone)}>
            {showDone && <div className="hm-label" style={{ margin: "0.7rem 0 0.3rem", color: "var(--color-ink-soft)" }}>Done</div>}
            {showDone ? (
              // finished goals: one short line each, so the open ones keep the room
              <ul>{list.map((it) => <DoneRow key={it.key} title={it.title ?? it.key} />)}</ul>
            ) : (
              <ul>{list.map((it) => <Fragment key={it.key}>{it.el}</Fragment>)}</ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: ReactNode; icon: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-[0.15rem] text-center">
      {icon}
      <span className="font-display tabular-nums" style={{ fontSize: "1.8rem", fontWeight: 700, lineHeight: 1 }}>{value}</span>
      <span className="hm-label" style={{ fontSize: "0.6rem", color: "var(--color-ink-soft)" }}>{label}</span>
    </div>
  );
}

function JournalLore({ c }: { c: PageCtx }) {
  const s = c.snap;
  const [open, setOpen] = useState<number>(-1);
  return (
    <div>
      <Chapter kicker="Collection" title="Items and lore" />
      {s && (
        <div className="grid grid-cols-3 gap-[0.5rem]" style={{ padding: "0.6rem 0 0.9rem", marginBottom: "0.8rem", borderBottom: "1px solid var(--color-ink-faint)" }}>
          <Stat label="Glimmers" value={s.glimmers} icon={<Diamond style={{ width: "1.1rem", height: "1.4rem" }} />} />
          <Stat label="Hearts" value={Math.floor(s.maxHp / 4)} icon={<span style={{ fontSize: "1rem", height: "1.4rem", display: "flex", alignItems: "center" }}><HeartIcon id="journal" q={4} size={1.3} /></span>} />
          <Stat label="Heart shards found" value={`${shardProgress(s.maxHp, s.shards).found}/${shardProgress(s.maxHp, s.shards).total}`} icon={<svg viewBox="0 0 20 20" style={{ width: "1.1rem", height: "1.4rem" }}><path d="M10 1L19 10L10 19L1 10Z" fill="var(--color-ember)" stroke="var(--color-ink)" /></svg>} />
        </div>
      )}
      <Collection d={c.collect} />
      <div className="hm-label" style={{ color: "var(--color-ember-lo)", margin: "0.9rem 0 0.5rem" }}>Lore stones · {c.lore.length}</div>
      {c.lore.length === 0 ? (
        <p className="font-display" style={{ fontSize: "1.05rem", color: "var(--color-ink-soft)" }}>
          No lore stones read yet. Lore stones glow blue. Press E next to one to read it.
        </p>
      ) : (
        <ul className="flex flex-col gap-[0.35rem]">
          {c.lore.map((e, i) => (
            <li key={e.title}>
              <button data-nav="item" onClick={() => setOpen(open === i ? -1 : i)} className="font-display w-full text-left" style={{ fontSize: "1.2rem", fontWeight: 600, background: "none", border: 0, cursor: "pointer", padding: "0.25rem 0", color: open === i ? "var(--color-rubric)" : "var(--color-ink)", display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
                <span style={{ color: "var(--color-gold-lo)" }}>{open === i ? "▾" : "▸"}</span>
                {e.title}
              </button>
              {open === i && (
                <p className="font-display" style={{ fontSize: "1.1rem", lineHeight: 1.45, padding: "0.2rem 0 0.5rem 1.2rem", color: "var(--color-ink-soft)" }}>
                  {e.text}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- map */

function MapLeft({ c }: { c: PageCtx }) {
  if (!c.map) return <p className="font-display">The map is loading.</p>;
  return (
    <div className="flex h-full w-full items-center justify-center" style={{ containerType: "size" }}>
      <div style={{ width: "min(100cqw, 100cqh)", height: "min(100cqw, 100cqh)" }}>
        <IslandMap data={{ ...c.map, tracked: c.tracked }} selected={c.selected} onPick={(p) => c.onSelect(p)} />
      </div>
    </div>
  );
}

function pickInfo(p: MapPick, m: MapData): { name: string; x: number; z: number; lit: boolean } {
  if (p.kind === "beacon") {
    const l = LANDMARKS.find((x) => x.id === BEACON_LANDMARK[p.id])!;
    return { name: l.name, x: l.x, z: l.z, lit: !!m.beacons[p.id] };
  }
  if (p.kind === "glade") {
    const l = LANDMARKS.find((x) => x.id === "beacon-glade")!;
    return { name: l.name, x: l.x, z: l.z, lit: !!m.gladeLit };
  }
  if (p.kind === "spire") {
    const l = LANDMARKS.find((x) => x.id === "spire")!;
    return { name: "Gloam Spire", x: l.x, z: l.z, lit: false };
  }
  const w = WAYSTONES.find((x) => x.id === p.id)!;
  return { name: w.name, x: w.x, z: w.z, lit: true };
}

function MapRight({ c }: { c: PageCtx }) {
  const m = c.map;
  const visited = m?.visited ?? [];
  const regions = LANDMARKS.filter((l) => !l.id.startsWith("beacon") && l.id !== "spire");
  const sel = c.selected && m ? pickInfo(c.selected, m) : null;
  const tracking = samePick(c.tracked, c.selected);
  return (
    <div data-testid="map-legend">
      <Chapter kicker={c.snap?.area ? `You are in ${c.snap.area}` : "Hollowmere"} title="The Island" />
      <div style={{ minHeight: "5.6rem", padding: "0.5rem 0.7rem", marginBottom: "1rem", border: "1px solid var(--color-ink-faint)", borderRadius: "0.25rem", background: "rgb(248 240 221 / 0.35)" }} data-testid="map-select">
        {sel && c.selected ? (
          <>
            <div className="flex items-baseline justify-between">
              <span className="font-display" style={{ fontSize: "1.3rem", fontWeight: 700 }}>{sel.name}</span>
              <span className="tabular-nums" style={{ fontSize: "0.85rem", color: "var(--color-ink-soft)" }}>{m ? `${Math.round(Math.hypot(sel.x - m.player.x, sel.z - m.player.z))} m` : ""}</span>
            </div>
            <div className="flex flex-wrap gap-[0.6rem]" style={{ marginTop: "0.4rem" }}>
              {c.selected.kind !== "waystone" && (
                <button className="hm-btn primary" data-nav="item" style={{ width: "auto", minHeight: "2.2rem", fontSize: "1rem" }} onClick={() => c.onTrack(tracking ? { kind: "none" } : c.selected!)} data-testid="map-track">{tracking ? "Stop tracking" : "Track"}</button>
              )}
              {c.selected.kind === "waystone" && (
                <button className="hm-btn primary" data-nav="item" style={{ width: "auto", minHeight: "2.2rem", fontSize: "1rem" }} onClick={() => c.onTravel((c.selected as { id: string }).id)} data-testid="map-travel">Travel here</button>
              )}
              {c.selected.kind === "waystone" && (
                <button className="hm-btn" data-nav="item" style={{ width: "auto", minHeight: "2.2rem", fontSize: "1rem" }} onClick={() => c.onTrack(tracking ? { kind: "none" } : c.selected!)}>{tracking ? "Stop tracking" : "Track"}</button>
              )}
            </div>
          </>
        ) : (
          <p style={{ fontSize: "0.9rem", color: "var(--color-ink-soft)" }}>Pick a beacon, the Spire or a waystone on the map to track it{c.map?.waystones?.length ? " or travel to it" : ""}.</p>
        )}
      </div>
      <div className="hm-label" style={{ color: "var(--color-ember-lo)", marginBottom: "0.4rem" }}>Beacons</div>
      <ul className="flex flex-col gap-[0.4rem]" style={{ marginBottom: "1rem" }}>
        {BEACON_LANDMARK.map((id, i) => {
          const l = LANDMARKS.find((x) => x.id === id)!;
          const d = m ? Math.hypot(l.x - m.player.x, l.z - m.player.z) : 0;
          const lit = !!m?.beacons[i];
          return (
            <li key={id} className="flex items-center gap-[0.6rem]">
              <Flame color={BEACON_COLOR[i]} lit={lit} style={{ width: "1rem", height: "1.3rem", flex: "none" }} />
              <span className="font-display" style={{ fontSize: "1.2rem", fontWeight: 600 }}>{l.name}</span>
              <span className="ml-auto tabular-nums" style={{ fontSize: "0.8rem", color: "var(--color-ink-soft)" }}>{lit ? "lit" : m ? `${Math.round(d)} m` : ""}</span>
            </li>
          );
        })}
      </ul>
      <div className="hm-label" style={{ color: "var(--color-ember-lo)", marginBottom: "0.4rem" }}>
        Regions · {regions.filter((r) => visited.includes(r.id)).length}/{regions.length}
      </div>
      <ul className="grid grid-cols-2 gap-x-[1rem] gap-y-[0.25rem]" style={{ marginBottom: "1rem" }}>
        {regions.map((r) => (
          <li key={r.id} className="font-display" style={{ fontSize: "1.1rem", color: visited.includes(r.id) ? "var(--color-ink)" : "rgb(43 33 24 / 0.42)" }}>
            {visited.includes(r.id) ? r.name : "Not visited"}
          </li>
        ))}
      </ul>
      <Rule color="var(--color-gold-lo)" />
      <div className="flex flex-wrap gap-x-[1.2rem] gap-y-[0.4rem]" style={{ fontSize: "0.8rem", color: "var(--color-ink-soft)", marginTop: "0.6rem" }}>
        <span className="flex items-center gap-[0.35rem]"><svg viewBox="0 0 24 24" style={{ width: "1rem", height: "1rem" }}><path d="M12 2L19 21L12 16.5L5 21Z" fill="var(--color-ember)" stroke="#2b2118" strokeWidth="1.6" /></svg>You (north is up)</span>
        <span className="flex items-center gap-[0.35rem]"><Flame lit={false} style={{ width: "0.8rem", height: "1rem" }} />Dark beacon</span>
        <span className="flex items-center gap-[0.35rem]"><svg viewBox="0 0 12 12" style={{ width: "0.9rem", height: "0.9rem" }}><path d="M6 0.8L11.2 6L6 11.2L0.8 6Z" fill="#3b8fb0" stroke="#2b2118" /></svg>Waystone</span>
        <span className="flex items-center gap-[0.35rem]"><svg viewBox="0 0 30 30" style={{ width: "1rem", height: "1rem" }}><path d="M15 2L19 26H11Z" fill="#5b3a6e" stroke="#2b2118" /></svg>Gloam Spire</span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- settings */

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ padding: "0.55rem 0", borderBottom: "1px dashed var(--color-ink-faint)" }}>
      <div className="flex items-center justify-between gap-[1rem]">
        <div className="min-w-0">
          <div className="font-display" style={{ fontSize: "1.25rem", fontWeight: 600, lineHeight: 1.15 }}>{label}</div>
          {hint && <div style={{ fontSize: "0.75rem", color: "var(--color-ink-soft)", lineHeight: 1.3 }}>{hint}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

function Toggle({ on, set, label }: { on: boolean; set(v: boolean): void; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} data-nav="toggle" className="hm-toggle" onClick={() => set(!on)} />;
}

function Slider({ value, min, max, step, set, label, fmt }: { value: number; min: number; max: number; step: number; set(v: number): void; label: string; fmt(v: number): string }) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ padding: "0.45rem 0 0.2rem", borderBottom: "1px dashed var(--color-ink-faint)" }}>
      <div className="flex items-baseline justify-between">
        <span className="font-display" style={{ fontSize: "1.25rem", fontWeight: 600 }}>{label}</span>
        <span className="tabular-nums" style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--color-ember-lo)" }}>{fmt(value)}</span>
      </div>
      <input type="range" className="hm-range" min={min} max={max} step={step} value={value} aria-label={label} data-nav="range" style={{ ["--p" as string]: `${p}%` }} onChange={(e) => set(Number(e.target.value))} />
    </div>
  );
}

function SettingsSight({ c }: { c: PageCtx }) {
  const s = c.settings;
  const set = (p: Partial<Settings>) => c.onSettings({ ...s, ...p });
  return (
    <div data-testid="settings">
      <Chapter kicker="Settings" title="Graphics" />
      <div style={{ padding: "0.4rem 0 0.7rem", borderBottom: "1px dashed var(--color-ink-faint)" }}>
        <div className="font-display" style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.4rem" }}>Quality</div>
        <div className="hm-seg" role="radiogroup" aria-label="Quality">
          {(["auto", "low", "medium", "high", "ultra"] as const).map((q) => (
            <button key={q} aria-pressed={s.quality === q} data-nav="seg" onClick={() => set({ quality: q })}>{q}</button>
          ))}
        </div>
        {c.snap && <div style={{ fontSize: "0.75rem", color: "var(--color-ink-soft)", marginTop: "0.35rem" }}>Now drawing at {c.snap.quality}, {Math.round(c.snap.scale * 100)}% resolution</div>}
      </div>
      <Row label="Dynamic resolution" hint="Lowers the resolution to keep the frame rate steady">
        <Toggle on={s.dynamicRes} set={(v) => set({ dynamicRes: v })} label="Dynamic resolution" />
      </Row>
      <Slider label="Render scale" value={s.renderScale} min={0.5} max={1} step={0.05} set={(v) => set({ renderScale: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
      <div style={{ padding: "0.4rem 0 0.7rem", borderBottom: "1px dashed var(--color-ink-faint)" }}>
        <div className="font-display" style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.4rem" }}>Frame rate cap</div>
        <div className="hm-seg" role="radiogroup" aria-label="Frame rate cap">
          {([0, 30, 60] as const).map((f) => (
            <button key={f} aria-pressed={s.fpsCap === f} data-nav="seg" onClick={() => set({ fpsCap: f })}>{f === 0 ? "None" : f}</button>
          ))}
        </div>
      </div>
      <Row label="Show frame rate">
        <Toggle on={s.showFps} set={(v) => set({ showFps: v })} label="Show frame rate" />
      </Row>
      <Row label="Reduce motion" hint="Turns off shimmer, drift and flicker in menus and the HUD">
        <Toggle on={s.reduceMotion} set={(v) => set({ reduceMotion: v })} label="Reduce motion" />
      </Row>
    </div>
  );
}

function SettingsSound({ c }: { c: PageCtx }) {
  const s = c.settings;
  const set = (p: Partial<Settings>) => c.onSettings({ ...s, ...p });
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div>
      <Chapter kicker="Settings" title="Sound & controls" />
      <Slider label="Master" value={s.master} min={0} max={1} step={0.05} set={(v) => set({ master: v })} fmt={pct} />
      <Slider label="Music" value={s.music} min={0} max={1} step={0.05} set={(v) => set({ music: v })} fmt={pct} />
      <Slider label="Effects" value={s.sfx} min={0} max={1} step={0.05} set={(v) => set({ sfx: v })} fmt={pct} />
      <Slider label="Voice" value={s.voice} min={0} max={1} step={0.05} set={(v) => set({ voice: v })} fmt={pct} />
      <Slider label="Ambience" value={s.ambience} min={0} max={1} step={0.05} set={(v) => set({ ambience: v })} fmt={pct} />
      <Slider label="Camera sensitivity" value={s.lookSens} min={0.25} max={3} step={0.05} set={(v) => set({ lookSens: v })} fmt={(v) => `${v.toFixed(2)}×`} />
      <Row label="Invert camera Y">
        <Toggle on={s.invertY} set={(v) => set({ invertY: v })} label="Invert camera Y" />
      </Row>
      <Row label="Camera follow" hint="The camera turns behind Wren while moving">
        <Toggle on={s.cameraFollow} set={(v) => set({ cameraFollow: v })} label="Camera follow" />
      </Row>
      <Row label="Control hints" hint="Shows a button hint the first time you need it">
        <Toggle on={s.hints} set={(v) => set({ hints: v })} label="Control hints" />
      </Row>
      <Row label="Subtitles" hint="Shows Tallow's lines as text. Always on when voice is 0">
        <Toggle on={s.subtitles} set={(v) => set({ subtitles: v })} label="Subtitles" />
      </Row>
      {c.touch && <Slider label="Touch button size" value={s.touchScale} min={0.75} max={1.4} step={0.05} set={(v) => set({ touchScale: v })} fmt={pct} />}
      <div style={{ fontSize: "0.75rem", color: "var(--color-ink-soft)", marginTop: "0.7rem" }} data-testid="sound-credit">
        Recorded sounds are public domain (CC0) clips from freesound.org. The Credits page lists each one.
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- controls */

const ROWS: { act: string; keys: string[]; pad: string; touch: string }[] = [
  { act: "Move", keys: ["W", "A", "S", "D"], pad: "L", touch: "Left thumb, anywhere on the left" },
  { act: "Camera", keys: ["Mouse"], pad: "R", touch: "Drag on the right half" },
  { act: "Sprint", keys: ["Shift"], pad: "B", touch: "Push the stick to its edge" },
  { act: "Jump · climb-jump", keys: ["Space"], pad: "A", touch: "Jump button" },
  { act: "Glide", keys: ["G"], pad: "A", touch: "Glide button, in the air" },
  { act: "Attack · hold to charge", keys: ["LMB", "J"], pad: "X", touch: "Attack button" },
  { act: "Shield · parry", keys: ["RMB", "K"], pad: "LT", touch: "Shield button" },
  { act: "Dodge", keys: ["L"], pad: "B", touch: "Dodge button" },
  { act: "Bow · hold, release", keys: ["F", "MMB"], pad: "RT", touch: "Bow button, drag to aim" },
  { act: "Lock on", keys: ["Q"], pad: "RB", touch: "Lock button" },
  { act: "Use · read · rest", keys: ["E"], pad: "Y", touch: "Hand button" },
  { act: "Map", keys: ["M"], pad: "View", touch: "Map, top right" },
  { act: "Pause", keys: ["Esc", "P"], pad: "Menu", touch: "Pause, top right" },
];

function ControlsKeys() {
  return (
    <div data-testid="controls">
      <Chapter kicker="Controls" title="Keyboard & mouse" />
      <table className="w-full" style={{ borderCollapse: "collapse" }}>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.act} style={{ borderBottom: "1px dashed var(--color-ink-faint)" }}>
              <td className="font-display" style={{ fontSize: "1.12rem", fontWeight: 600, padding: "0.28rem 0" }}>{r.act}</td>
              <td className="text-right" style={{ padding: "0.28rem 0" }}>
                <span className="inline-flex flex-wrap justify-end gap-[0.25rem]">
                  {r.keys.map((k) => (
                    <span key={k} className="hm-key">{k}</span>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ControlsOther({ device }: { device: Device }) {
  const [mode, setMode] = useState<"pad" | "touch">(device === "touch" ? "touch" : "pad");
  return (
    <div>
      <Chapter kicker="Controls" title={mode === "pad" ? "Gamepad" : "Touch"} />
      <div className="hm-seg" style={{ marginBottom: "0.6rem" }}>
        <button aria-pressed={mode === "pad"} data-nav="seg" onClick={() => setMode("pad")}>Gamepad</button>
        <button aria-pressed={mode === "touch"} data-nav="seg" onClick={() => setMode("touch")}>Touch</button>
      </div>
      <table className="w-full" style={{ borderCollapse: "collapse" }}>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.act} style={{ borderBottom: "1px dashed var(--color-ink-faint)" }}>
              <td className="font-display" style={{ fontSize: "1.12rem", fontWeight: 600, padding: "0.28rem 0" }}>{r.act}</td>
              <td className="text-right" style={{ padding: "0.28rem 0", fontSize: "0.8rem", color: "var(--color-ink-soft)" }}>
                {mode === "pad" ? <span className={`hm-key ${r.pad.length <= 2 ? "pad" : ""}`}>{r.pad}</span> : r.touch}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="font-display" style={{ fontSize: "1.05rem", color: "var(--color-ink-soft)", marginTop: "0.8rem" }}>
        Raise the shield just before a hit lands to parry. The enemy staggers, so attack next.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ credits */

function CreditsLeft() {
  return (
    <div data-testid="credits">
      <Chapter kicker="About" title="Credits" />
      {CREDITS.map((c) => (
        <div key={c.role} style={{ marginBottom: "0.9rem" }}>
          <div className="hm-label" style={{ color: "var(--color-ember-lo)" }}>{c.role}</div>
          {c.names.map((n) => (
            <div key={n} className="font-display" style={{ fontSize: "1.35rem", fontWeight: 600, lineHeight: 1.25 }}>{n}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CreditsRight({ text }: { text: string }) {
  return (
    <div data-testid="credits-assets">
      <Chapter kicker="Assets" title="Sound and music" />
      <pre className="font-display" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.95rem", lineHeight: 1.45, color: "var(--color-ink-soft)" }}>{text}</pre>
    </div>
  );
}
