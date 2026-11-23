# HOLLOWMERE audio audit and v2 plan

Branch `zelda-v2`. Scope: `src/app/audio.ts`, `audio-dsp.ts`, `audio-music.ts`, `audio-sfx.ts`, `audio-ambience.ts`.
The owner's complaint: "OST and SFX are off." This audit measures why and proposes a v2.

## How this was measured

- The five audio modules were transpiled as they are (no edits) and loaded into Chromium (playwright-core) on the
  dev server origin (`next dev -p 3604`). Each scene rendered through an `OfflineAudioContext` at 48 kHz, using the
  module's own `lab` handle and the real bus graph (reverb, compressor, limiter). It ran at the default user volumes
  (master 0.8, music 0.7, sfx 0.9, ambience 1). A suspend/resume tick every 62.5-125 ms copied the live
  scheduler, so the voice budget ran as it does in the game.
- 27 WAVs were rendered. Music: day 160 s, night, combat, boss 1-3, trial, menu, ending, and a transition run
  (day, then combat, then back, then night). Also 4 stings plus one sting over music, a 48-cue SFX catalog,
  6 ambience scenes, and a 42 s gameplay scene (explore, then a fight) as a full mix plus 3 solo stems.
- Python (numpy/scipy) measured each WAV: BS.1770 K-weighted LUFS with gating, 3 s short-term loudness, peak, crest,
  Welch spectrum (6 bands, centroid, 85 % roll-off, flatness), L/R correlation and side/mid ratio, spectral-peak
  tuning error in cents, a per-bar chroma self-similarity matrix (repetition), pitch-class histogram, SFX envelope
  (attack, -30 dB length, low-band share, level spread across repeats), and noise-loop autocorrelation.
- Scripts and WAVs are in the scratchpad (render: `render.cjs` + `lab/lab.js`, analysis: `analyze.py`). They are not
  in the repo.

I cannot listen. Every verdict below comes from these numbers and from the code. Section 6 lists what a person
should check by ear.

## 1. Findings: what is "off"

### 1.1 The whole game is quiet, dark and almost mono

| Render | Integrated LUFS | Peak dBFS | Centroid | 1-4 kHz / 4-8 kHz share | L/R corr |
|---|---|---|---|---|---|
| Day music | -27.4 | -16.7 | 345 Hz | -20.5 / -31.1 dB | 0.980 |
| Night music | -32.8 | -18.2 | 304 Hz | -16.0 / -29.8 dB | 0.981 |
| Combat (day 0.5 + combat) | -28.7 | -8.3 | 730 Hz | -11.4 / -19.0 dB | 0.981 |
| Boss 3 | -26.6 | -9.6 | 407 Hz | -14.8 / -21.1 dB | 0.985 |
| Menu | -23.6 | -14.7 | 475 Hz | | 0.984 |
| Gameplay full mix (explore) | -22.6 | -4.2 | | | |

- 85 % of the day score's energy sits under **580 Hz**, and almost nothing is above 4 kHz. That is the "muffled,
  cardboard" sound. Causes: pads low-passed at 800 Hz (`padChord`), lute plucks with `lpk 0.4` (dark),
  and a flute that is almost a pure sine (next point).
- **Stereo is close to mono.** L/R correlation is 0.98 and side energy is 20 dB under mid in every music layer.
  Pans of ±0.15 and a reverb return at 0.3 × 0.7 send do not build a stage. A top-tier score sits around
  0.3-0.7 correlation.
- **Overall level is about 6 dB too low.** The explore mix is -22.6 LUFS, and music alone is -27.4. Laptop and phone
  listeners turn the browser up, and then a hot SFX (dodge, -3.7 dBFS) jumps out. Target for a browser game:
  **-18 LUFS integrated**, with true peak ≤ -1 dBFS.
- **Loudness jumps between states (no level design):**
  - The menu is 3.8 dB louder than the day score, so starting the game sounds like the music "drops".
  - **Combat is quieter than exploring.** In the transition render, short-term loudness falls from -26.5 to
    -29.3 LUFS when the fight starts: `targets()` halves the day layer and `TRIM.combat` is 0.8. Tension should
    rise, not fall.
  - **Night is 5.4 dB quieter than day** (-34 short-term after the switch). The night ambience is then
    **16 dB louder** than the day ambience (crickets, 1.3), so at night the crickets drown the score.
  - Stings range from -17.8 LUFS (victory, peak -3.9 dBFS) to -30.9 LUFS (rest). The rest sting over day music
    makes **no measurable bump** in the short-term curve: the player cannot hear it.

### 1.2 The timbres are thin, and they sound synthesized

- **Flute** (`flute()` in `audio-music.ts`): a sine plus a triangle octave at 10 %, and a band-passed noise "chiff"
  that dies with a 0.25 s time constant. After the first quarter second each held note is a **pure sine with 5 Hz
  vibrato**. That reads as a test tone or an ocarina toy, not a breath instrument. It lacks the odd-harmonic body,
  breath turbulence that follows the note's loudness, and pitch/amp micro-drift.
- **Pad**: two triangle oscillators per note, 8 cents apart, low-passed at 800 Hz, the same every bar. No movement,
  no filter swell, no ensemble. It is "warm" only in the sense of "dull".
- **Plucks** (`ksBuffer`): plain Karplus-Strong with one random excitation per note (seed = f × 100). **Every
  repeat of a note is the same buffer**: no velocity timbre, no pick position, no body resonance. The tuning is
  good (mean 5 cents error on day music), which is the strongest part of the current engine.
- **Celesta/bells**: three sine partials (1, 4, 9.3). Fine as a sparkle, but every pickup, UI, area and trial cue
  is built from the same `bell()`. The game's whole "magic" vocabulary is one sound.
- **Combat/boss**: raw sawtooth drones, plus `combatLayer` holding a **constant minor second** (`ch[0]-12` and
  `ch[0]-12+1`) under every bar. That is a permanent semitone beat, measured as the worst tuning spread (13.7 cents
  mean, the highest of any layer). It reads as harsh, not tense. Boss pitch content is a smear (G, G#, A nearly
  equal in the chroma). The tonal centre gets lost in sub saws and 118→52 Hz tom sweeps.
- **Sub energy that does nothing.** Boss music puts -10 dB of its energy at 20-60 Hz, and the ending puts -12 dB
  there (the triangle bass at `ch[0]-12` = 37 Hz). Laptop and phone speakers cannot play it, but it still eats
  compressor and limiter headroom.

### 1.3 Harmony and melody

- **The tonal centre is weak.** The day score is "D Dorian", but the pitch-class histogram ranks **C (0.203) above
  D (0.181)**, and B (the Dorian colour note) is only 0.075. Every progression in `PROGS` lands on degree 6 (C
  major) and none on a real cadence. The ear hears C major / A minor drift, not a Dorian home.
- **Theme A** (`THEME_A`) spans only a 5th (G4-D5). Bars 1-2 are the same rhythm sequenced down a step
  (A-D-C-A / G-C-B-G). That pattern is predictable and easy to forget. **Theme B** has a good arch (D4-E5) but the
  same square dotted-quarter rhythm. Neither has a "signature" interval or rhythm a player could hum.
- **Two thirds of the time there is no theme.** The theme plays in 2 of every 6 sections (8 of 24 bars). The rest is
  random cells (`buildMelody`) folded around chord tones. Measured bar similarity is low (only 3.9 % of bar pairs
  > 0.95), so the notes are not too repetitive. The problem is that they have no identity: wandering arpeggio
  fragments.
- **The texture never changes.** Every bar of the day layer is the same pad, bass and 8th-note lute arpeggio at the
  same velocity. Short-term loudness range is only **3.7 dB** over 160 s, and 1.1-1.8 dB for combat, trial and
  boss. Each layer has one density and never builds, thins out or rests. This is the main reason it feels
  repetitive.
- **Boss music loops one bar.** In boss 3, 39 % of bar pairs are near-identical (sim > 0.95), and the mean
  similarity is 0.79.
- **Every layer is 72 BPM in 4/4**, including combat and boss. Combat gets its drive only from shakers, so it lacks
  pulse energy.

### 1.4 Transitions

- Layer gains move with `setTargetAtTime(..., 0.7)` at the next bar line. There is no hard cut, but there is also
  no musical join. Combat drums enter at full pattern on the downbeat with no pickup. The day layer halves at the
  same moment, which gives the level drop above. Leaving combat holds 6 s, then the drums simply stop. Night swaps
  the mode (Dorian to Aeolian) mid-phrase with a 5 dB drop.
- `hold` keeps a layer rendering for 2 bars after its target goes to 0. That is right, but nothing turns the tail
  into a cadence.

### 1.5 SFX

| Cue | Peak dBFS | Centroid | Notes |
|---|---|---|---|
| step: grass | -8.3 | 3.5 kHz | hiss tick, little body (<250 Hz share -15 dB) |
| step: rock | -5.3 | **10.1 kHz** | a pure high-pass **click** |
| step: wood | -4.6 | 166 Hz | a **sine "boop"** (a pitched tone sweep) |
| step: dirt/stone | -5.7/-6.1 | ~300 Hz | sine sweep 115→70 Hz plus noise: "boop" |
| all steps | | | level spread across repeats **0.1-0.4 dB**: every step is a clone |
| dodge | **-3.7** (loudest cue in the game) | **11.7 kHz** | pure hiss, harsh |
| sword swing 1-3 | -13 to -15 | ~2.5 kHz | soft band-pass noise, 55-80 ms attack: no "edge" |
| spin | -21.5 | | quieter than one swing |
| sword hit on enemy | -5.4 | 353 Hz | a sine thud: no blade, no impact texture |
| claw hits player | -13.6 | 2.4 kHz | weak whoosh; the "hurt" thud carries it |
| bow draw | -16.9 | 196 Hz | a **sawtooth drone with 14 Hz vibrato**: buzz, not creak |
| arrow fired | -8.3 | | a tuned E2 lute pluck rings 630 ms: a musical note, not a string snap |
| pickup shard | -5.7 | | louder than combat hits |
| brambling / wisp voices | ~-20 | | 12 dB under the warden, OK by design but thin (two band-pass formants) |

- Footsteps are centred, mono, and have no heel-toe or scuff structure. Each step gets a 0.13 send to the same
  2.4 s hall reverb, so the player walks through a forest inside a concert hall.
- In the explore mix, **footsteps are louder than the music**: SFX stem -24.5 LUFS vs music -26.7 LUFS while
  running on grass. In real games locomotion sits 6-10 dB under the score and ambience.
- `TRIM` (gains of 0.5 to 8× after the fact) shows the level problem: cues were balanced by peak, not by loudness or
  role.

### 1.6 Ambience

| Scene | LUFS | Notes |
|---|---|---|
| Forest day | **-41.5** | near silence: wind floor plus sparse sine birds |
| Night | **-25.7** | crickets are **pure 4.3-5.0 kHz sines** (4-8 kHz band = 100 % of energy) and the loudest bed in the game |
| Rain storm | -20.9 | white noise, flatness 0.75, **L/R corr 0.998 (mono)** |
| River / glide wind | -29 / -28 | flatness 0.5, mono (corr 0.99+) |
| Sea | -34.7 | |

- **Every bed is the same 4-second white-noise loop.** At a 4.0 s lag the autocorrelation of the rendered bed is
  **0.99 (rain), 0.98 (glide wind), 0.97 (river), 0.68 (sea)**. At 3.85 s it is about 0. That is frozen noise: the
  ear learns its grain and hears a 4 s "pulse". The reason is `rig.noise` (4 s) feeding every `noiseSrc`.
- Birds are sine chirps (`birdCall`, 3 types) at random pans. Day forest has no layer of leaves, insects or distance.
- The beds have no stereo width and no reaction to place, apart from water pan and gain.

### 1.7 Mix, space and spatialization

- **One reverb** (`makeIR`, 2.4 s noise with a `(1-p)^2.6` envelope) for music, SFX and ambience. The envelope is
  convex: it holds, then collapses. The -20 dB point is about 1.4 s and the -60 dB point about 2.2 s, so the
  early decay is unnaturally slow. The same space plays in forest, cave, shrine and open sky.
- No buses beyond music, sfx and amb. No dialogue/voice bus. **No ducking** except the stings, which duck the
  music, so combat hits, enemy alerts and pickups never make room for themselves.
- Positional audio is `StereoPannerNode` plus `1/(1+(d/ref)^1.5)`. There is no HRTF, no distance low-pass or air
  absorption, no elevation, and no occlusion (terrain or walls).
- The master chain (compressor at -18 dB threshold with 5:1 ratio, then a limiter) does the mixing that the bus
  gains should do.
- The voice budget is not the problem: the budgeted and unbudgeted day renders start the same number of voices
  (673 oscillators, 341 buffers in 160 s). There was no starvation in music, or in the music plus combat SFX scene.

## 2. Music v2

### 2.1 Decision: a hybrid built on CC0 recorded instrument samples

Recommendation: a **sampled hybrid**. Recorded CC0 single-note samples carry the melody instruments and the
ensemble (harp, flute, string sections, glockenspiel, frame drum, timpani). Synthesis stays only for the
texture layers that samples cannot do cheaply: an evolving pad from filtered noise and shimmer, a sub-bass tuned to
the key, and the spirit "air" layer. Both run through a proper generated reverb.

Why not "better synthesis only":
- The measured problems are timbre problems: a flute with no harmonics, a pad with no motion, a pluck with no body.
  A physical flute model (jet, bore delay, breath noise shaped by amplitude) can work. But tuning one to sound like
  an orchestra player, and then a harp, strings and percussion too, is weeks of DSP work for a result that still
  sits in the uncanny valley.
- AGENTS.md says it outright: synthesis next to real recordings sounds fake at once, and v2 will ship real recorded
  SFX (section 3). A synthesized score would be the only fake element left.
- Two CC0 libraries hold every instrument this score needs, with license verified on the repo (both are CC0-1.0):
  - **VSCO-2 Community Edition** (`github.com/sgossner/VSCO-2-CE`, CC0-1.0): `Strings/Harp`, `Woodwinds/Flute`,
    `Strings/Violin Section` (susVib, pizz, trem, spic), `Viola Section`, `Cello Section`, `Solo Violin`,
    `Solo Contrabass`, `Brass/F Horn` (sus, mute, stac), `Percussion/Glock`, `Percussion/Marimba`,
    `Percussion/Timpani` (+ rolls).
  - **VCSL** (`github.com/sgossner/VCSL`, CC0-1.0): `Concert Harp`, `Folk Harp`, `Ocarina, Typical`,
    `Baroque Alto/Soprano Recorder`, `Kalimba, Kenya`, `Hand Chimes`, `Glockenspiel`, `Vibraphone`,
    `Tubular Bells`, `Hand Bells, Nepalese`, `Psaltery, Bowed and Plucked`, `Frame Drum`, `Timpani 1/2`.
- Size: one sample per minor third over the range each instrument needs, 2-4 s each, mono where possible,
  Opus/m4a at 96 kbps. That is about **6-9 MB** in all, loaded lazily (explore set first, boss set on `bossWake`).
- Playing it is the existing scheduler: one `AudioBufferSourceNode` per note, with `playbackRate` pitch for ±1.5
  semitones and a velocity → gain + low-pass map. This is cheaper in CPU than now (one node chain per note instead
  of 2-3 oscillators plus filters).

Keep from the current code: the bar clock, the seeded `Rng`, the voice budget, `pump()`, and `hold`. They work.

### 2.2 New modules (code layout)

- `src/app/audio-samples.ts`: the one sample loader for **both** music instruments and SFX (as in
  `2k/src/app/audio-samples.ts`). Lazy decode, core set first, never-same-twice pools, failures skipped.
- `src/app/audio-inst.ts`: a sampled instrument: a key map (`root → buffer`), velocity layers, round-robin,
  release tails, legato for the flute (overlap plus a short crossfade), string swells (attack ramp), harp gliss
  helper.
- `src/app/audio-score.ts`: musical material only (themes, motifs, harmony plans per region), as data.
- `src/app/audio-music.ts`: the engine (state machine, layers, transitions). It is rewritten to schedule phrases
  and transitions, not single bars.
- `src/app/audio-space.ts`: the reverb factory (generated IRs, below) and the send buses.
- `scripts/audio/fetch-instruments.mjs` + `scripts/audio/build-instruments.py`: they pull the chosen notes from
  VSCO-2-CE and VCSL by commit SHA, trim, normalize, encode, and write `public/music/inst/*.m4a` plus `manifest.json`.
  Credits go in `public/music/CREDITS.md` (CC0, but credited anyway).

### 2.3 Musical design

**Home key and mode.** D Lydian for the "world" theme, with D Dorian as the shadow mode. Lydian's raised 4th
(G#) is the "wonder" colour. It is the note that makes a phrase feel like it lifts off the ground. Dorian is
for ruins and night. The tonic stays D throughout, so every region can modulate by colour (one changed note), not
by key. That keeps the transitions seamless.

**Main theme, "The Hollow Light" (original).** Described in words, so it can be written fresh and checked for
originality:
- Phrase 1 (2 bars, 3/4 time at 84 BPM, a gentle waltz lilt, unlike the 4/4 of now). It starts on the 5th (A) and
  rises a **major 6th** to F#. That leap is the theme's signature, and the ear remembers it. It then steps down
  through E to D on a long note on beat 1 of bar 2, with a short pickup figure (two 8ths) before the next phrase.
- Phrase 2 answers. It starts higher (B), leaps up a **4th** to E, and touches the Lydian **G#** as a passing
  upper neighbour (A-G#-A). It then falls by step to F# and leaves the phrase open on the 3rd.
- Phrases 3-4: phrase 1 again, a step higher (from B to G#, a major 6th again, as the "hope" moment). The theme
  then comes home through a falling 5th-to-tonic gesture with a held D. Total: 8 bars, range a 10th, one leap of a
  6th, one of a 4th, the rest steps. That is a singable contour with a clear peak in bar 5.
- Rhythm identity: a long-short-short-long cell (dotted quarter, 8th, quarter, dotted half across the bar line).
  Every motif below keeps this rhythm, even when the intervals change.
- Originality guard: before shipping, compare the first 8 notes' interval sequence against a list of famous game
  themes by hand. It must share no 4-note interval run. Write the theme in `audio-score.ts` as data with this
  comment.

**Leitmotifs (each one is a transformation of the theme cell, so the world sounds like one family):**

| Region | Mode / colour | Lead | Motif |
|---|---|---|---|
| Hollow Shrine (start) | D Lydian, bright | harp + flute | theme cell plain; the shrine is "home" |
| Mirebrook Ruin (village) | D Dorian | psaltery pluck + recorder | the 6th leap shrunk to a minor 3rd, a folk-dance rhythm (6/8), a drone on D-A |
| Whisperwood | D Dorian with an added 9th | marimba/kalimba ostinato + solo violin | the theme cell in canon at 1 bar (echoing trees), pizz strings |
| Sunken Lake | D Lydian, slow (60 BPM) | glock + vibraphone + harp gliss | the theme in augmentation (double length), water-like arpeggios in 5ths |
| Ashen Cliffs | D Mixolydian | horn + cello | the 6th leap inverted (a falling 6th), wide open 5ths, wind |
| Mt. Cinder / Gloam Spire | D Phrygian, low | timpani + low strings + bowed psaltery | the cell in the bass, minor 2nd neighbour (Eb-D) as the warden's sign |
| Beacons (trials) | the region's mode | frame drum + pizz ostinato | the cell turned into a 4-note ostinato that climbs one step per trial goal |

**Day and night palettes.**
- Day: harp, flute, violins (susVib), glock sparkles, kalimba. Brighter EQ (no low-pass on the music bus), 30 %
  reverb.
- Night: the same harmony family with the mode flattened (Lydian → Dorian, G# → G). Celesta-like hand chimes,
  ocarina instead of flute, sustained violas, longer and darker reverb (3.5 s, high cut 4 kHz). Density halves and
  the gaps get longer. **Level within 1.5 dB of day**: night is quieter in texture, not in loudness.
- Dawn and dusk: an 8-bar bridge built from the theme's last phrase, in the target palette.

**Silence is a layer.** Exploration music plays as 1-3 minute **cues** with 30-90 s of ambience-only gaps
between them. Re-entry is quantized to a phrase and triggered by an area change, a view or a rest. This is
the main cure for repetition fatigue, and it is the pattern open-world games use.

**Combat intensity (vertical layers on one shared grid):**
- C0 "alert" (enemy notices): string tremolo swell plus a timpani roll on the dominant. It enters on the next beat,
  not the bar.
- C1 "skirmish": ostinato pizz strings + frame drum in the theme rhythm, 84 → 112 BPM via **metric modulation**
  (the quarter becomes the dotted quarter, so the tempo change sounds intended). The explore lead drops out; its
  harmony stays.
- C2 "pressure" (3+ enemies or HP ≤ 25 %): horns state the theme cell in Dorian, timpani on 1 and 3.
- Combat must be **+2 to +4 LU louder** than explore, never quieter.

**Boss (the Warden), 3 phases:**
- Phase 1: D Phrygian, timpani and low strings, the Eb-D neighbour motif, 96 BPM.
- Phase 2: horns take the theme cell in Phrygian, string spiccato 8ths, frame drum.
- Phase 3: full ensemble, 7/8 bars (2+2+3) for unease. The theme's 6th leap appears in full in the horns at the
  climax. The victory sting resolves it into D Lydian.
- Each phase is a 16-bar loop with 4-bar variants (A/B/A'/C), so no bar repeats more than twice in a row (today
  39 % of bars repeat).

**Stings** (all from the theme cell, all in D, all tempo-free so they can play over anything):
- Beacon lit: harp gliss up + the theme's first phrase on flute, full strings swell, 6 s.
- Discovery (first `areaEnter`): the region motif's first 4 notes on its lead instrument, 2-3 s.
- Trial done: the ostinato's last step resolving to D, glock + harp, 2 s.
- Rest: a solo harp playing the theme's last phrase, 4 s. Duck the score to 0.4, and gate the sting to play only
  when the score is silent or quiet.
- Death: low strings, falling 6th (the inverted signature), 3 s. The music stops after it.
- Victory: horns + timpani, the climax phrase resolving to D Lydian, 7 s.
- Normalize every sting to **-18 LUFS ±1** (today: a 13 dB spread).

**Seamless transitions (the engine rules):**
1. The clock runs in beats with a **phrase grid** (4 or 8 bars). Every state change is a request queued to the next
   legal sync point: beat (alert), bar (combat in/out), or phrase (region, day/night).
2. **Pickups and tails.** Each layer has a 1-beat pickup (timpani roll, harp gliss, string swell) that is scheduled
   *before* the sync point, and a 1-2 bar tail (cadence chord + reverb) when it ends. No layer starts cold on a
   downbeat or stops dead.
3. **Shared harmony.** All layers in one state read the same chord plan, so the crossfade between explore and combat
   is always consonant. Mode changes (day/night, region) happen only at a phrase start, through a pivot chord
   (for example Bm, common to Lydian and Dorian on D).
4. Out of combat: the C-layer drops at the next bar, the explore layer comes back with a cadence (IV-I), and after
   8 bars the score falls silent into the gap-and-cue cycle.
5. The menu cue sits at the same loudness as the explore layer (today it is +3.8 dB).

## 3. SFX v2

Rule, from AGENTS.md: real recordings (CC0 or CC BY) for everything physical. Synthesis only for UI and for
magic, where no real-world source exists. One sample loader (`audio-samples.ts`), every clip in
`public/sfx/CREDITS.md`, and CC BY lines also in `SFX_ATTRIBUTION`, shown in the settings screen. Take every
variant of one sound from one source session (an AGENTS lesson).

### 3.1 License check

| Source | License (checked) | Usable here? |
|---|---|---|
| Kenney `impact-sounds`, `rpg-audio` (kenney.nl) | CC0 1.0 (asset pages) | **Yes.** Use for foley fill: cloth, metal clinks, wood impacts, chest/book/door |
| VSCO-2-CE, VCSL (GitHub sgossner) | CC0-1.0 | **Yes.** Instruments, and glock/chimes for pickup sparkles |
| Freesound, license filter "Creative Commons 0" | per clip | **Yes, clip by clip.** Open each clip page and confirm "Creative Commons 0" before download, as in 2k. Avoid CC BY-NC and Sampling+ |
| OpenGameArt | per asset, mixed | Only assets marked CC0 (the site returned 403 to the fetcher; check by hand) |
| Sonniss #GameAudioGDC bundles | **custom license, not CC.** Allows use in games, but **forbids redistributing the files as sound effects**, which a public repo or a public `/sfx` folder does. Also bans AI training | **No.** It breaks the AGENTS.md CC0/CC BY rule |

### 3.2 Replace with recordings

Candidates are from the Freesound CC0-filtered search (sorted by downloads). Each must be re-checked on its page,
listened to, and scanned for traffic, music or voices before use.

| Sound | Plan | Candidate sources (Freesound ID, author) |
|---|---|---|
| Footsteps grass/dirt/moss | 8-10 takes per surface × walk/run, heel and scuff kept, random pick never-repeat, ±1.5 dB, ±3 % rate | 770095 Vrymaa "Footsteps Moss - walk, jog & run"; 413840 felix.blume "Man walking in the forest"; 392007 burbujafilms dry leaves |
| Footsteps gravel/rock/stone | same | 825854 Vrymaa "Footsteps Gravel Stones - Walk"; 494571 / 494567 775noise walking/running on small gravel; 205994 Yuval river gravel |
| Footsteps wood, sand, water/shallows, ash | same | Freesound CC0 search per surface; Kenney impact-sounds for wood fill |
| Sword swings (3 combo weights + spin) | real swishes, pitch-shifted per combo, layered with a short cloth rustle | 737541 Nalgotico "sword swoosh"; 390777 d00121058 sword swing; 733891 velcronator "Whoosh Triple" |
| Sword hits (flesh/plant enemy, stone, block, parry) | layer: impact transient + material + body thump (the current sine thud may stay as the low layer) | 733887 velcronator "Sword Impact"; 734606 Vrymaa "Sword - Metallic hits"; 588278 marchelonia sword vs shield (block); 658736 courter "Sword Clashes" (parry) |
| Bow draw / release / arrow hit | real creak and string snap; keep a synthesized "magic arrow" sparkle only as a layer | 384918 Ali_6868 "Bow Release 3"; 394179 saturdaysoundguy "Longbow Release 2"; 536068 EminYILDIRIM "Bow Release Hit" |
| Water: splash, swim strokes, shallow wade | recorded takes, size from gain + low-pass | Freesound CC0 "splash", "swimming" |
| Ambience: forest day | 2-3 long stereo beds (30-60 s, seam-crossfaded), plus one-shot birds placed in 3D | 850507 GammaGool Slovenian forest birds; 856018 newlocknew quiet forest edge; felix.blume forest sets |
| Ambience: night | real crickets/frogs bed replacing the sine crickets | 436528 KikeVilaplana "Night ambience with crickets"; 746366 RyanKingArt summer evening crickets. **Reject** 616619 (airplanes) and 482687 (traffic) |
| Wind, rain, river, sea | real stereo beds, one per kind and intensity, crossfaded by game state | Freesound CC0 "wind trees", "rain on leaves", "stream", "waves pebble beach" (felix.blume has many CC0 nature recordings) |
| Thunder | 3-4 real takes | Freesound CC0 "thunder" |
| Enemy voices | brambling and mossback from processed animal/foley recordings (twigs, bark creak, pig grunts pitched); warden roar from a slowed, layered animal growl + stone grind | Freesound CC0 per kind |
| Stone block push, barrier down | real stone drag / rumble | Kenney impact-sounds + Freesound CC0 "stone drag" |

### 3.3 Keep synthesized (redesigned)

- **UI** (`ui()`): keep, but tune every cue to the score's key (D Lydian pentatonic: D E F# A B) and use the sampled
  glock/hand chimes in place of sine beeps. Remove the sawtooth "error" buzz and use a muted low marimba pair.
- **Magic**: glimmer streak, shard, heart, chargeReady, heal, respawn, beacon flame, wisp. These are "spirit"
  sounds, so a designed synthetic layer fits. Build them from **sampled chimes and glock plus a granular shimmer**
  (short grains of the hand-chime buffer, pitched up in 5ths, through the shimmer reverb), not raw `bell()`.
  The glimmer streak rising through the pentatonic is a good idea: keep it, on the D Lydian pentatonic.
- **Low "weight" layers** under recorded impacts (the sine thud, at 60-150 Hz) are fine as a sub layer.
- The heartbeat at low HP is fine, but cut its level 6 dB and duck the music 3 dB while it plays.

## 4. Voice

Recommendation: **yes to a mentor voice, but very few lines, plus a wordless spirit language.**

- **Mentor ("the Hollow Keeper", the shrine's spirit).** 8-14 short lines at key beats only: first wake, first
  beacon, each beacon lit, before the spire, the ending. Made once with Chatterbox through the 2k pipeline
  (`2k/scripts/voice/generate.py` pattern: `lines.json`, a cache hash, silence trim, about -16 LUFS, mono 24 kHz).
  Output goes to `public/voice/` with `manifest.json`. The voice is an original reference derived from Chatterbox's
  built-in voice (pitch, formant, re-synthesis). No real person is cloned. Process it: a light chorus, a 3.5 s
  shrine reverb and a high shelf, so it sounds like a spirit, not a narrator. Lines are subtitled. The player
  never has to sit through dialogue.
- **Spirit language (wordless).** Most "speech" in the game (lore stones, the wisp, beacon spirits) is a sung
  murmur: 2-4 syllable phonemes from a fixed made-up inventory (for example "ah, ei, lo, mir, sa, vel"). Make them
  with Chatterbox singing/vowel prompts or record them once, cut them into 30-50 grains, and play them pitched to the
  current chord, so the voice is part of the music. `src/app/audio-voice.ts` owns both systems.
- Do not use `speechSynthesis` (AGENTS.md).

## 5. Mix v2

**Buses** (new `audio-mix.ts`, replacing the three gains in `createRig`):

```
music ─┐
stings ┤→ musicSum ─(duck)─┐
voice ─────────────────────┤
sfx.player (foot, swing) ──┤
sfx.world  (enemies, hits) ┼→ pre ─→ gentle glue comp (2:1, -20 dB) → true-peak limiter (-1 dBFS) → master
sfx.ui ────────────────────┤
amb.beds / amb.oneshots ───┘
sends: reverb.small (0.6 s), reverb.env (per area), reverb.shimmer (magic), reverb.music (2.8 s)
```

**Level targets** (short-term LUFS, at default volumes, measured with the same offline harness as a CI check):

| Element | Target | Today |
|---|---|---|
| Explore music | -24 | -27.4 (night -32.8) |
| Combat music | -21 to -22 | -29 |
| Ambience bed (day / night) | -30 / -31 | -41.5 / -25.7 |
| Footsteps (run) | -30 | ~-24.5 |
| Sword swing / hit | -20 / -17 | |
| Stings | -18 ±1 | -17.8 to -30.9 |
| Mentor voice | -18 | n/a |
| Full mix, explore / combat | -18 / -16 | -22.6 / -25 |

**Ducking (sidechain by envelope, all in `audio-mix.ts`):**
- Voice → music -8 dB and ambience -4 dB (attack 80 ms, release 600 ms).
- Stings → music -6 to -10 dB for the sting length (exists today; keep).
- Heavy impacts (parry, warden slam, boss roar, player hurt) → music -3 dB and ambience -4 dB for 300 ms. The hit
  then has room without a louder peak.
- Combat state → ambience -6 dB (birds stop, wind stays).

**Spatialization:**
- Use `PannerNode` with `panningModel: "HRTF"` for world one-shots within 30 m (enemy voices, hits, arrows,
  splashes, birds). Use equal-power for far sounds and for phones (`lite`).
- Distance model: inverse, ref 3 m. Add an **air-absorption low-pass** (20 kHz at 0 m to 3 kHz at 80 m) and
  a reverb send that rises with distance, so far sounds sit in the space, not just get quieter.
- Player footsteps: left/right alternating ±0.1 pan, tied to the foot that lands.
- Ambience: 2-4 positional emitters per area (river reach, waterfall, tree with birds, shrine hum), placed from
  `world`/`landmarks` data, with a stereo bed under them.

**Occlusion:**
- Every 125 ms (the existing `slow()` tick), cast one ray from the camera to each active emitter against the
  terrain heightfield (`world.heightAt`, which is cheap). If blocked: -6 dB and low-pass to 1.2 kHz, ramped over
  150 ms. Caves and spire interiors get an "inside" flag that swaps the environment reverb and cuts the outdoor
  beds 12 dB.

**Environment reverb (`audio-space.ts`):** generated stereo IRs, built offline at load as Float32 buffers.
Decorrelated L/R noise, **exponential** decay per octave band (so highs die faster), and early reflections. Four
presets: open field (0.8 s, low wet), forest (1.4 s, diffuse, dark), shrine/ruin (2.6 s, stone, bright early
reflections), cave/spire (3.8 s). Crossfade two convolvers when the area changes.

**Other mix fixes:**
- Break up the 4 s noise loop: real beds fix this for ambience. For any synthesized noise left, use a 15-20 s noise
  buffer, a different one per channel (decorrelated stereo), and random start offsets.
- Sub cleanup: high-pass the music bus at 35 Hz and the SFX bus at 30 Hz. Keep the boss low end at 50-90 Hz,
  where laptops can play it.
- A loudness check script (`scripts/audio/level-check.mjs`): the render harness from this audit, failing CI when a
  state misses its target by more than 2 LU, or when a sting or a cue exceeds -1 dBTP.

## 6. Must be checked by ear

- The new theme (originality, singability) and the night palette's mood.
- Every recorded clip: background traffic, airplanes, voices, music, handling noise. Also check that footstep takes
  match one another (same mic and room).
- HRTF on headphones vs laptop speakers. Whether the mentor voice processing reads as "spirit" and not "robot".

## Top 10 actions

1. **Fix the level design first** (`audio.ts` `applyVolumes`, `audio-music.ts` `targets`/`TRIM`, `audio-ambience.ts`
   cricket gain). Explore music to -24 LUFS, combat louder than explore, night within 1.5 dB of day, crickets
   -15 dB, footsteps -6 dB, overall mix to -18 LUFS. Add the offline level-check script so this stays fixed.
2. **Replace the score's instruments with CC0 samples** (VSCO-2-CE harp/flute/strings/horn/timpani/glock, VCSL
   ocarina/recorder/kalimba/hand chimes/frame drum) through a new `audio-samples.ts` + `audio-inst.ts`. Stop using
   the sine flute and triangle pad.
3. **Write a real main theme** (D Lydian, major-6th signature leap, long-short-short-long cell, 3/4 at 84 BPM) and
   derive region leitmotifs from it in `audio-score.ts`. Remove the random-cell melodies as the default.
4. **Rebuild the music engine on a phrase grid** with pickups, tails, shared harmony and pivot-chord mode changes.
   Add silence/gap cycles between exploration cues. Add combat C0/C1/C2 layers with metric modulation, and boss
   phases with A/B/A'/C variants.
5. **Swap footsteps for recorded CC0 takes** (8-10 per surface, walk/run, never-repeat, alternating pan). The
   rock "click" (10 kHz centroid) and the wood/dirt sine "boops" go.
6. **Swap sword swings and hits, bow, splashes and enemy voices for recorded CC0 layers**. Keep the synthesized sub
   thud only as a low layer. Fix the dodge cue (-3.7 dBFS pure hiss).
7. **Replace every ambience bed with real stereo recordings** (forest, night insects, rain, wind, river, sea). This
   kills the 4 s frozen-noise loop (0.97-0.99 autocorrelation) and the mono beds. Add positional emitters per area.
8. **Add the mix layer** (`audio-mix.ts`): buses for music/stings/voice/sfx player/sfx world/ui/amb, ducking
   (voice, impacts, combat → ambience), HRTF for near world sounds, distance low-pass, and heightfield occlusion.
9. **Replace the single 2.4 s hall** with per-area generated IRs (exponential, band-dependent decay, decorrelated
   stereo) in `audio-space.ts`. Footsteps get the small/environment reverb, not the music hall.
10. **Add the mentor voice (8-14 Chatterbox lines) and a wordless spirit language** in `audio-voice.ts` +
    `public/voice/`. Retune UI and magic cues to the D Lydian pentatonic with sampled chimes and a shimmer send.
    Credit every clip in `public/sfx/CREDITS.md` and `public/music/CREDITS.md`. Use no Sonniss material.
