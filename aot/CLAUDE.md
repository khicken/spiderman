# aot design rules

Read `../AGENTS.md` first for code and performance rules. This file covers how the game should feel and read.

## Text

- Show no text for what the world, a sound, or the HUD already shows. A missed hook, a full meter, a cooldown, a weak hit, and a refusal need no words. A refusal plays a fail sound.
- Say each fact once. Do not repeat it in a toast, a radio line, and a banner.
- Tutorial text shows once: in bootcamp or on first use. Store "seen" in localStorage.
- Strings are short: 10 words or fewer, active voice, common words.
- Keep the center of the screen clear during combat. Put persistent info at the edges.

## Flow

- Never pause play or open a modal during combat. Choices, such as upgrades, are made with one key or tap while the player keeps moving.
- Never hide how to do something important. If an action is available, the HUD shows the key for it.
- The break between waves is short. The player can always see why a wave has not ended, or the wave ends by itself.
- Death and respawn are fast. The player is back in the air within a few seconds.

## Controls

- Gas is spent only when the player asks for it: boost (Space), dash (Shift), and wall flips. Hooking and reeling never cost gas.
- Every input has one meaning. Do not overload a key by context unless the context is obvious on screen.

## Difficulty

- Hard means the player must learn a pattern, not that the numbers are unfair. Every boss attack has a visible or audible tell before it lands.
- A boss shows its weak point and its current phase on its body (glow, steam, crystal cracks), not in text.
- A player who knows the pattern beats a boss on the first try with a few mistakes. A player who ignores it dies.
- Tune with numbers in one place (`titan-waves.ts` for wave scaling, the boss block in `titans.ts`).

## Upgrades

- Each upgrade changes something the player feels in the next fight. Cut upgrades that only tweak a hidden number by a few percent.
- A pending upgrade is visible at the HUD edge with the keys to pick it.

## Process

- Typecheck with `npx tsc --noEmit` and build with `npm run build` before you call work done.
- Test in a headless browser. Never open a visible browser window.
- Remove debug hooks and lab pages before you commit.
