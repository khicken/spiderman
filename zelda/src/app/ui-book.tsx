"use client";

import type { ReactNode } from "react";
import { Corner, Lozenge } from "./ui-ink";

export type BookTab = "journal" | "map" | "settings" | "controls" | "credits";

const TAB_LABEL: Record<BookTab, string> = { journal: "Journal", map: "Map", settings: "Settings", controls: "Controls", credits: "Credits" };
const TAB_COLOR: Record<BookTab, string> = {
  journal: "linear-gradient(90deg, #8a3a22, #b8402b)",
  map: "linear-gradient(90deg, #17474a, #1f5a5e)",
  settings: "linear-gradient(90deg, #6f5418, #a8842c)",
  controls: "linear-gradient(90deg, #3f2850, #5b3a6e)",
  credits: "linear-gradient(90deg, #4f6332, #6f8a4a)",
};

export interface BookProps {
  tabs: readonly BookTab[];
  tab: BookTab;
  onTab(t: BookTab): void;
  left: ReactNode;
  right: ReactNode;
  closeLabel: string;
  onClose(): void;
  quitLabel?: string;
  onQuit?(): void;
}

/** The pause / options menu: an open book on a leather cover with thumb-index ribbons on the right edge. */
export function Book({ tabs, tab, onTab, left, right, closeLabel, onClose, quitLabel, onQuit }: BookProps) {
  return (
    <div className="safe absolute inset-0 flex items-center justify-center" style={{ background: "radial-gradient(ellipse at 50% 50%, rgb(8 25 28 / 0.55), rgb(8 25 28 / 0.88))", backdropFilter: "blur(3px)" }} data-testid="book">
      <div className="hm-book-in relative flex" style={{ width: "min(94vw, 78rem)", height: "min(calc(100dvh - 1.2rem - env(safe-area-inset-top) - env(safe-area-inset-bottom)), 50rem)" }}>
        <div className="relative flex min-w-0 flex-1" style={{ padding: "0.7rem", borderRadius: "0.6rem", background: "radial-gradient(ellipse at 30% 20%, #24585b, #12353a 60%, #0a2226)", boxShadow: "0 2rem 4rem rgb(0 0 0 / 0.6), inset 0 0 0 1px rgb(232 199 102 / 0.35), inset 0 0 0 0.35rem #0f2e33, inset 0 0 0 calc(0.35rem + 1px) rgb(232 199 102 / 0.55)" }}>
          <div className="relative flex min-w-0 flex-1 overflow-hidden" style={{ borderRadius: "0.25rem", boxShadow: "0 0 0 1px #2b2118, 0 0.3rem 0.6rem rgb(0 0 0 / 0.4)" }}>
            <Page side="l" key={`l-${tab}`}>{left}</Page>
            <Page side="r" key={`r-${tab}`}>{right}</Page>
            <div className="hm-gutter-shade pointer-events-none absolute inset-y-0 left-1/2 w-[7%] -translate-x-1/2" />
            <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2" style={{ background: "rgb(43 33 24 / 0.5)" }} />
          </div>
        </div>
        <nav className="flex flex-col justify-between" style={{ width: "clamp(6.5rem, 11vw, 9.5rem)", marginLeft: "-0.35rem", paddingTop: "1.6rem", paddingBottom: "1.2rem" }} aria-label="Book">
          <div className="flex flex-col gap-[0.4rem]" role="tablist">
            {tabs.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={t === tab}
                data-nav="tab"
                data-tab={t}
                onClick={() => onTab(t)}
                className="hm-ribbon flex items-center text-left"
                style={{
                  minHeight: "2.75rem",
                  padding: "0 0.8rem 0 1rem",
                  fontSize: "1.2rem",
                  color: "var(--color-parchment-hi)",
                  background: TAB_COLOR[t],
                  borderRadius: "0 0.3rem 0.3rem 0",
                  boxShadow: t === tab ? "0.25rem 0.25rem 0.6rem rgb(0 0 0 / 0.45), inset 0 0 0 1px rgb(232 199 102 / 0.6)" : "0.15rem 0.15rem 0.4rem rgb(0 0 0 / 0.35), inset 0 0 0 1px rgb(0 0 0 / 0.25)",
                  transform: t === tab ? "translateX(0.5rem)" : "none",
                  clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%)",
                }}
                data-testid={`tab-${t}`}
              >
                {t === tab && <span style={{ width: "0.4rem", height: "0.4rem", background: "var(--color-gold-hi)", transform: "rotate(45deg)", marginRight: "0.55rem", flex: "none" }} />}
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-[0.45rem]" style={{ paddingLeft: "0.75rem" }}>
            <button data-nav="close" className="hm-btn primary" style={{ fontSize: "1.15rem", minHeight: "2.6rem", padding: "0.3rem 1rem 0.3rem 0.7rem", gap: "0.5rem" }} onClick={onClose} data-testid="book-close">
              <Lozenge />
              {closeLabel}
            </button>
            {onQuit && (
              <button data-nav="quit" className="hm-link text-left" style={{ color: "var(--color-mist)", paddingLeft: "0.4rem" }} onClick={onQuit} data-testid="book-quit">
                {quitLabel ?? "Quit to title"}
              </button>
            )}
          </div>
        </nav>
      </div>
    </div>
  );
}

function Page({ side, children }: { side: "l" | "r"; children: ReactNode }) {
  return (
    <section className="hm-parchment relative flex min-w-0 flex-1 flex-col" style={{ backgroundPosition: side === "l" ? "0 0, 0 0, 0 0, 0 0" : "110px 60px, 0 0, 0 0, 0 0" }}>
      <Corner pos={side === "l" ? "tl" : "tr"} size="2.6rem" />
      <Corner pos={side === "l" ? "bl" : "br"} size="2.6rem" delay={100} />
      {/* bottom pad clears the corner ornament; the fade shows that a long page scrolls */}
      <div className="hm-page-in hm-scroll relative min-h-0 flex-1" style={{ padding: side === "l" ? "clamp(1rem, 3.2vh, 2.2rem) clamp(1.6rem, 3vw, 2.8rem) 2.4rem clamp(1.8rem, 3.2vw, 3rem)" : "clamp(1rem, 3.2vh, 2.2rem) clamp(1.8rem, 3.2vw, 3rem) 2.4rem clamp(1.6rem, 3vw, 2.8rem)", maskImage: "linear-gradient(to bottom, #000 calc(100% - 2rem), transparent)", WebkitMaskImage: "linear-gradient(to bottom, #000 calc(100% - 2rem), transparent)" }}>
        {children}
      </div>
    </section>
  );
}

export function Chapter({ kicker, title }: { kicker?: string; title: string }) {
  return (
    <header style={{ marginBottom: "1rem" }}>
      {kicker && <div className="hm-label" style={{ color: "var(--color-ember-lo)", marginBottom: "0.15rem" }}>{kicker}</div>}
      <h2 className="font-display" style={{ fontSize: "2.3rem", fontWeight: 600, lineHeight: 1.05, color: "var(--color-ink)" }}>
        <span style={{ color: "var(--color-rubric)", fontSize: "1.25em", fontWeight: 700 }}>{title[0]}</span>
        {title.slice(1)}
      </h2>
      <svg viewBox="0 0 200 10" preserveAspectRatio="none" style={{ width: "100%", height: "0.6rem", marginTop: "0.3rem" }} aria-hidden>
        <path d="M0 5H200" stroke="var(--color-gold)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path d="M0 8H120" stroke="var(--color-ink-faint)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path d="M0 1.5L4 5L0 8.5Z" fill="var(--color-rubric)" />
      </svg>
    </header>
  );
}
