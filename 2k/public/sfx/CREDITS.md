# HOOPS sound credits

Every ball, court, official and crowd sound in HOOPS is a real recording. None of it is synthesized, and none of it
comes from a game, a TV broadcast, a film or a league. No clip contains music. The files live in `public/sfx/`, in
three folders: `crowd/`, `ball-court/` and `officials/`. The game loads them through `src/app/audio-samples.ts`.

Still synthesized on purpose, and only as UI cues: menu clicks, the shot meter tick, the quiet "green" release tock and
the soft shot-clock tick (`src/app/audio-bank.ts`), plus the menu theme (`src/app/audio-music.ts`), which plays on the
menus only. Nothing is synthesized inside a game: no music, organ, drum beat, PA chime or whoosh plays from tip-off to
the final horn. In development, `window.__hoopsAudio.osc.live` counts oscillator starts during live play and must
stay 0.

## Licenses

- **CC0 1.0** (public domain dedication): no attribution needed. We still credit the authors below.
- **CC BY 3.0 / 4.0**: attribution is required. The lines below must be shown in the game, for example on a credits
  or about screen. `SFX_ATTRIBUTION` in `src/app/audio-samples.ts` holds the same lines for the UI.

## Required attribution (CC BY), for clips the game plays

- "SPRTCourt-Samsung Galaxy Smartphone, CU_Basketball, Swish Into Net_Nicholas Judy_TDC" by designerschoice, https://freesound.org/s/847042/, licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Edited (trimmed, filtered, normalized). Used as `ball-court/swish_06.mp3`.
- "Fox 40 Whistle, Blowing" by designerschoice (Nicholas Judy), https://freesound.org/s/811508/, licensed CC BY 4.0. Edited. Used as `officials/whistle_short_1.m4a`, `whistle_short_2.m4a`, `whistle_long_1.m4a`.
- "referee_whistle_01.wav" by joedeshon, https://freesound.org/s/78508/, licensed CC BY 4.0. Edited. Used as `officials/whistle_long_2.m4a`.
- "Ice hockey, buzzer at the end of the period" by YleArkisto, https://freesound.org/s/361537/, licensed CC BY 4.0. Edited. Used as `officials/horn_period_end.m4a`.

Every other clip is CC0. `SFX_ATTRIBUTION` in `src/app/audio-samples.ts` holds these same four lines.

### Every shipped file plays

The game plays every file in `public/sfx/` except `ball-court/rim_rattle_in_01.mp3` (loaded, kept out of the pools
until a human has listened to it; CC0). Files that are no longer used were removed from the folder: the hockey-arena
crowd cuts, the outdoor clap, `ohh_02` and `boo_02` (see Crowd), the soccer
"ooh" clips (CC BY 3.0, Quistard), the old crowd beds and one-shots, `dribble_soft_*`, `dribble_med_*`,
`dribble_hard_*`, `dribble_hall_*` and `catch_07` (CC BY 3.0, danielchu), `squeak_10`, `fan_horn_honk`,
`fan_horn_rally`, `horn_klaxon`, `arena_horn`, `whistle_short_gym`, `whistle_long_gym` and `ir_hall_stereo`.

## Not checked by ear

The clips were picked and checked with measurements only (loudness, spectra, stereo correlation, a scan for sustained
tones such as PA music, organ or horns). Before shipping, a human should listen to the crowd set (`crowd/`) in a game,
especially the three beds and `roar_05` .. `roar_08`, and confirm that no PA music, horn or team chant is audible.

## Crowd

Every crowd sound is a real recording of people. No clip comes from a hockey game, a protest, a TV broadcast or a game.

- **Beds** are cut from one real college basketball game (S4 and S5, the same author and session). The recordings are
  mono, so each bed puts two different stretches of that crowd on the left and right channels (or the loop rolled by
  half its length), which gives a wide image without phasing. Each bed is one 20-47 s file whose end is crossfaded
  into its start offline. The game decodes the beds at 22.05 kHz, plays each one as a seamless loop and only rides its
  gain. The scan found no steady bass or organ lines in these cuts (the old hockey bed had about 17 per minute).
- **Cheers and roars** come from real basketball games: S4/S5/S6 (college game) and S7 (a high-school game in a small
  gym). `cheer_01`, `cheer_02`, `cheer_04`, `roar_03` and `roar_04` come from one studio crowd-walla session (S2).
- **Oohs, groans, gasps, boos and applause** come from the walla session (S2). In the game each walla reaction is
  layered with a second take of the same kind 30-80 ms later and panned apart, low-passed at 8 kHz and sent to the
  recorded arena reverb (`officials/ir_arena_hall.m4a`), so it sounds like a section of a big room.

All sources are CC0 1.0. The source files are the freesound.org HQ previews (MP3) of each recording.

### Sources

| Key | Title | Author | URL | License |
|---|---|---|---|---|
| S2 | GameSoundCon2024 Walla XY-AKG214-96k (pack 42098): the CRWD* takes listed below | ShangusBurger (Shane Vincent) | https://freesound.org/people/ShangusBurger/packs/42098/ | CC0 1.0 |
| S4 | Fans at Basketball Game (Crowd) ("Fans at a college basketball game") | phillyfan972 | https://freesound.org/s/412160/ | CC0 1.0 |
| S5 | Fans at Basketball Game (Crowd) Sound Clip 2 | phillyfan972 | https://freesound.org/s/412161/ | CC0 1.0 |
| S6 | Scored Basket at a Basketball Game ("Fans reacting to a scored basket at a college basketball game") | phillyfan972 | https://freesound.org/s/412162/ | CC0 1.0 |
| S7 | basketball_crowd_noise_01.wav ("High school basketball game recorded from the stands in a small gym") | joedeshon | https://freesound.org/s/264291/ | CC0 1.0 |

### Retired crowd sources

No shipped clip comes from these any more. They are listed for history only.

| Key | Title | Author | URL | License | Why it was removed |
|---|---|---|---|---|---|
| S1 | Madison Square Garden New York Rangers Atmosphere 2010 | nyseagull | https://freesound.org/s/398258/ | CC0 1.0 | a hockey arena: steady bass and organ lines, goal celebrations |
| S3 | AMB - EXT - Manif BLM - BXL, Place Poolaert - Applaudissements rythmés deux croches noire, foule.wav | Mylkyway | https://freesound.org/s/521439/ | CC0 1.0 | an outdoor street rally, not an arena |

### Clips

Processing (S4-S7): cut, 2-pole high-pass at 120 Hz and 2-pole low-pass at 14 kHz, mono. Beds: a slow level rider
(each 2 s window pulled halfway toward the clip median), loop seam crossfaded over 3 s (equal power), two channels as
described above, 22.05 kHz, -23 LUFS integrated, MP3 112 kbps. Reactions: 250 ms fade-in, cosine-squared fade-out over
the last 30 %, -18 LUFS integrated, peaks limited at -1.5 dBFS, 44.1 kHz, MP3 128 kbps.
S2 takes (unchanged): 2-pole high-pass at 100 Hz, 14 kHz low-pass, stereo, 44.1 kHz, 10 ms fade-in, cosine fade-out
over the last 30 %, -18 LUFS integrated (gasps -20), MP3 160 kbps.

| id | source | cut (s) | what it is |
|---|---|---|---|
| crowd_bed_buzz | S5 (left) and S4 (right) | S5 0-58.5; S4 24-44, 54-66 and 84-102 | live-game buzz of a college basketball crowd (default live bed) |
| crowd_bed_loud | S4 | 0-23 (right channel rolled by half) | the crowd staying loud after a big play |
| crowd_bed_calm | S4 | 66-102 (right channel rolled by half) | quieter crowd chatter (timeouts, breaks, home free throws, menus) |
| cheer_01 | S2 763830 "Short Affirmative Cheer" | 0.0-2.9 | short cheer |
| cheer_02 | S2 763828 "Large Crowd, Unison Surprise, Cheering" | 0.3-7.0 | surprise into a cheer |
| cheer_04 | S2 763827 "Large Crowd, Unison Surprise" | 0.0-3.8 | unison "whoa" |
| cheer_05 | S6 | 2.8-9.2 | college crowd reacting to a basket |
| cheer_06 | S7 | 275.5-284.0 | high-school crowd cheering a basket |
| cheer_07 | S7 | 404.5-414.0 | high-school crowd cheering a basket |
| roar_03 | S2 763829 "Cheering, Whistling, No Clapping" | 0.5-11.5 | big cheer with whistles |
| roar_04 | S2 763815 "Loud Applause, Cheering, Whistling" | 0.5-11.5 | big cheer and applause |
| roar_05 | S6 | 9.0-15.8 | the big part of the same basket reaction (one fan screams near the mic) |
| roar_06 | S4 | 101.8-111.6 | college crowd erupting |
| roar_07 | S7 | 165.5-176.0 | high-school crowd erupting |
| roar_08 | S7 | 292.0-301.5 | high-school crowd erupting |
| ohh_01 | S2 763881 "Excitement Build Up, Let Down" | 1.0-6.6 | rising "ooh" that falls off (near miss) |
| ohh_03 | S2 763883 "Excitement Build Up, Let Down, Recovery 02" | 1.2-5.9 | build-up and let-down only |
| groan_01 | S2 763877 "Crowd Groan In Disagreement" | 0.6-8.8 | groan (fouls, turnovers, and-ones against) |
| groan_02 | S2 763808 "Crowd Groan In Disagreement, Intense" | 1.5-13.5 | strong groan |
| groan_03 | S2 763880 "Crowd Sigh In Disappointment" | 0.6-10.5 | sigh ("aww" on a miss, played short and quiet) |
| gasp_01 | S2 763875 "Crowd Gasping In Surprise, Voiced 01" | 0.0-3.4 | gasp |
| gasp_02 | S2 763876 "Crowd Gasping In Surprise, Voiced 02" | 0.6-3.6 | gasp |
| gasp_03 | S2 763870 "Crowd Gasping In Surprise, Quick 04" | 0.0-2.4 | quick gasp |
| gasp_04 | S2 763871 "Crowd Gasping In Surprise, Quick 05" | 0.0-2.3 | quick gasp |
| boo_01 | S2 763807 "Booing, Angry" | 0.3-12.9 | boos; the game starts it at a random point so repeats do not line up |
| applause_01 | S2 763812 "Loud Applause 01" | 0.1-11.2 | applause |
| applause_02 | S2 763813 "Loud Applause 02" | 0.1-19.5 | applause |
| applause_03 | S2 763814 "Loud Applause That Dwindles" | 0.1-17.5 | applause that dies down |
| applause_04 | S2 763811 "Generic Applause" | 0.4-8.5 | lighter applause |

Removed in this pass: `roar_01`, `roar_02`, `cheer_03` and the old beds (S1, hockey), `crowd_ft_murmur` (S1),
`crowd_clap_rhythm` (S3), `ohh_02` (it had words in it) and `boo_02` (a copy of the end of `boo_01`).

## Ball and court

Every clip in this folder is cut from a real field or studio recording on
freesound.org. None of it is synthesized, and none of it comes from a game,
a TV broadcast, or a film.

### Licenses

- **CC0 1.0** (public domain dedication): no attribution needed. We still
  credit the authors below.
- **CC-BY 3.0 / 4.0**: attribution is required. Show the "Required attribution"
  lines below in the game's credits screen or about page.

Only one source recording used here is CC-BY (S12). All other sources are CC0. S2, S3, S4 and S5 of this section are
retired: no shipped clip comes from them any more (S5 was CC BY 3.0). They stay in the table below, marked retired,
for history only.

#### Required attribution (CC-BY)

- "SPRTCourt-Samsung Galaxy Smartphone, CU_Basketball, Swish Into Net_Nicholas Judy_TDC" by designerschoice, https://freesound.org/s/847042/, licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Edited (trimmed, filtered, normalized).

### Sources

| Key | Title | Author | URL | License |
|---|---|---|---|---|
| S1 | basketball | vhschool2019 | https://freesound.org/people/vhschool2019/sounds/461118/ | CC0 1.0 (every dribble) |
| S2 (retired) | basketball ext dribble bounce hard surface.flac | kyles | https://freesound.org/people/kyles/sounds/453757/ | CC0 1.0 |
| S3 (retired) | Boys shooting hoops on wood floor | SoundsLikeYukon | https://freesound.org/people/SoundsLikeYukon/sounds/720961/ | CC0 1.0 |
| S4 (retired) | Basketball 3 | zmobie | https://freesound.org/people/zmobie/sounds/319785/ | CC0 1.0 |
| S5 (retired) | basketball in hall2.wav | danielchu | https://freesound.org/people/danielchu/sounds/66670/ | CC BY 3.0 |
| S6 | ball tap catch basketball.wav | shakaharu | https://freesound.org/people/shakaharu/sounds/88499/ | CC0 1.0 |
| S7 | basketball grab 2versions.flac | kyles | https://freesound.org/people/kyles/sounds/450725/ | CC0 1.0 |
| S8 | passball.wav | TimDun | https://freesound.org/people/TimDun/sounds/442575/ | CC0 1.0 |
| S9 | SFXBasketball & Shoes squeaking-Ext _Kempton Park Indoor courts_Nolo_OwSfx | Nolosoelite | https://freesound.org/people/Nolosoelite/sounds/708443/ | CC0 1.0 |
| S10 | sneaker squeak rubber.wav | shakaharu | https://freesound.org/people/shakaharu/sounds/88502/ | CC0 1.0 |
| S11 | Basketball Net Swish Sound.wav | Hann90 | https://freesound.org/people/Hann90/sounds/518048/ | CC0 1.0 |
| S12 | SPRTCourt-Samsung Galaxy Smartphone, CU_Basketball, Swish Into Net_Nicholas Judy_TDC | designerschoice | https://freesound.org/people/designerschoice/sounds/847042/ | CC BY 4.0 |
| S13 | basketball.wav (ball hitting a rim) | reedhos | https://freesound.org/people/reedhos/sounds/244348/ | CC0 1.0 |
| S14 | S03-01 Basketball; dribbling and shooting hoops in gym.wav | craigsmith | https://freesound.org/people/craigsmith/sounds/675320/ | CC0 1.0 |
| S15 | S02-28 Basketball hard against backboard.wav | craigsmith | https://freesound.org/people/craigsmith/sounds/675319/ | CC0 1.0 |
| S16 | Basketball backboard.wav | PerMagnusLindborg | https://freesound.org/people/PerMagnusLindborg/sounds/324247/ | CC0 1.0 |
| S17 | ball basketball drop.wav | shakaharu | https://freesound.org/people/shakaharu/sounds/88498/ | CC0 1.0 |

The source audio is the freesound HQ preview (128 kbps MP3) of each sound.
Freesound full-quality downloads need a login.

### Processing applied to every clip

1. Cut the time range shown below and downmix to mono at 44.1 kHz.
2. High-pass filter (2-pole) at the frequency shown (default 50 Hz) to remove rumble and handling noise.
3. Trim leading silence (onset at -36 dB below the clip peak, minus 4 ms) and trailing silence (-55 dB).
4. 2 ms fade-in and a cosine-squared fade-out (default: the last 35 % of the clip).
5. Level:
   - Short transients (dribbles, catches, backboard) are **peak-normalized**: hard -1 dBFS, medium -4 dBFS, soft -8 dBFS, catches -2 dBFS, backboard -1 dBFS, hall dribbles -2 dBFS. A momentary LUFS reading on a 150 ms thump does not mean much, so the soft/medium/hard split is set by peak level.
   - Everything else is normalized to the max EBU R128 momentary loudness (400 ms window) shown in the table: about -16 LUFS for swish and rim, -14 for dunks, -18 for squeaks, -20 for bounce-aways. Peaks are capped at -1 dBFS, with at most 2 dB of soft limiting.
6. Encode to MP3, mono, 44.1 kHz, LAME VBR q3 (about 96 kbps).

### Clips

Times are in seconds into the source recording. "Mmax" is the measured max momentary loudness of the final file.

| ID | File | Source | Cut (start, length) | Extra changes | Peak / Mmax |
|---|---|---|---|---|---|
| dribble_01 .. dribble_09 | dribble_NN.mp3 | S1 | the nine bounces at 0.16, 0.88, 1.53, 2.18, 3.01, 3.68, 4.64, 5.50 and 6.24 s, 0.38 s each | every dribble comes from this one dry indoor take; levelled by the RMS of the first 60 ms so all nine match, peak capped at -1 dBFS. The game sets soft / medium / hard by gain and a low-pass (3.2 kHz, 6.5 kHz, open), never by switching rooms or mics | -1.0 dBFS |
| catch_01 | catch_01.mp3 | S6 | 14.00, 0.35 | | -2.0 / -25.1 |
| catch_02 | catch_02.mp3 | S6 | 18.51, 0.35 | | -2.0 / -26.6 |
| catch_03 | catch_03.mp3 | S6 | 11.88, 0.30 | | -2.0 / -25.5 |
| catch_04 | catch_04.mp3 | S7 | 0.00, 0.50 | | -2.0 / -28.2 |
| catch_05 | catch_05.mp3 | S7 | 0.97, 0.60 | | -2.0 / -22.3 |
| catch_06 | catch_06.mp3 | S8 | 0.00, 0.29 | | -2.0 / -26.5 |
| squeak_01 | squeak_01.mp3 | S9 | 8.22, 0.40 | high-pass 250 Hz | -2.3 / -18.0 |
| squeak_02 | squeak_02.mp3 | S9 | 10.68, 0.32 | high-pass 250 Hz | -1.0 / -21.8 |
| squeak_03 | squeak_03.mp3 | S9 | 20.43, 0.50 | high-pass 250 Hz | -1.1 / -17.9 |
| squeak_04 | squeak_04.mp3 | S9 | 33.80, 0.38 | high-pass 250 Hz | -1.0 / -18.5 |
| squeak_05 | squeak_05.mp3 | S9 | 34.70, 0.65 | high-pass 250 Hz | -4.5 / -18.0 |
| squeak_06 | squeak_06.mp3 | S9 | 40.90, 0.35 | high-pass 250 Hz | -2.6 / -18.0 |
| squeak_07 | squeak_07.mp3 | S9 | 28.00, 0.65 | high-pass 250 Hz; double squeak (two quick cuts) | -1.0 / -18.8 |
| squeak_08 | squeak_08.mp3 | S10 | 4.61, 0.50 | high-pass 250 Hz | -7.9 / -18.1 |
| squeak_09 | squeak_09.mp3 | S10 | 6.95, 0.50 | high-pass 250 Hz | -7.5 / -18.0 |
| swish_01 | swish_01.mp3 | S11 | 0.22, 0.30 | high-pass 150 Hz | -1.0 / -16.4 |
| swish_02 | swish_02.mp3 | S11 | 0.90, 0.30 | high-pass 150 Hz | -1.0 / -17.9 |
| swish_03 | swish_03.mp3 | S11 | 1.62, 0.32 | high-pass 150 Hz | -1.0 / -16.4 |
| swish_04 | swish_04.mp3 | S11 | 2.22, 0.25 | high-pass 150 Hz | -1.0 / -17.3 |
| swish_05 | swish_05.mp3 | S11 | 3.54, 0.30 | high-pass 150 Hz | -1.0 / -19.0 |
| swish_06 | swish_06.mp3 | S12 (CC BY 4.0) | 0.00, 0.30 | high-pass 150 Hz | -1.0 / -17.5 |
| rim_clank_01 | rim_clank_01.mp3 | S13 | 0.13, 1.00 | | -3.0 / -16.0 |
| rim_clank_02 | rim_clank_02.mp3 | S13 | 1.68, 1.00 | | -3.4 / -16.0 |
| rim_clank_03 | rim_clank_03.mp3 | S13 | 3.17, 0.90 | | -1.6 / -16.0 |
| rim_clank_04 | rim_clank_04.mp3 | S13 | 4.53, 0.70 | | -2.4 / -16.0 |
| rim_clank_05 | rim_clank_05.mp3 | S13 | 5.89, 1.00 | | -2.3 / -16.1 |
| rim_rattle_in_01 | rim_rattle_in_01.mp3 | S14 | 4.18, 1.45 | 300 ms fade-out; ball rattling on the rim in a gym, cut before it lands on the floor | -3.9 / -16.0 |
| rim_rattle_in_02 | rim_rattle_in_02.mp3 | S13 + S11 | layered | Built from real recordings: S13 rim hit at 3.17 (0 dB, t=0), S13 hit at 4.53 (-6 dB, t=0.21 s), S13 hit at 1.68 (-12 dB, t=0.36 s), then S11 swish at 1.62 (-3 dB, t=0.50 s). 150 ms fade-out. | -2.8 / -16.0 |
| backboard_01 | backboard_01.mp3 | S15 | 5.53, 0.40 | | -1.0 / -22.7 |
| backboard_02 | backboard_02.mp3 | S15 | 15.86, 0.50 | | -1.0 / -21.8 |
| backboard_03 | backboard_03.mp3 | S15 | 17.46, 0.50 | | -1.0 / -21.9 |
| backboard_04 | backboard_04.mp3 | S16 | 0.00, 0.62 | | -1.0 / -20.0 |
| dunk_rim_01 | dunk_rim_01.mp3 | S13 + S15 + S11 | layered | Built from real recordings: S13 rim hit at 5.89 (0 dB), S15 backboard hit at 17.46 (-3 dB, same instant), S11 swish at 1.62 (-8 dB, t=0.03 s). 400 ms fade-out. | -1.0 / -14.9 |
| dunk_rim_02 | dunk_rim_02.mp3 | S13 + S15 + S11 | layered | Built from real recordings: S13 rim hit at 1.68 (0 dB), S15 backboard hit at 15.86 (-2 dB, t=0.005 s), S11 swish at 3.54 (-8 dB, t=0.04 s). 400 ms fade-out. | -1.0 / -14.8 |
| ball_bounce_away_01 | ball_bounce_away_01.mp3 | S17 | 1.72, 4.20 | high-pass 70 Hz; 1.5 s fade-out; a dropped ball bouncing and settling | -1.0 / -23.2 |
| ball_bounce_away_02 | ball_bounce_away_02.mp3 | S17 | 3.18, 2.80 | high-pass 70 Hz; 1.2 s fade-out; shorter, later part of the same drop | -1.0 / -20.9 |

### Not checked by ear

Nobody listened to these clips. They were checked only with ffprobe and spectrum analysis. Before shipping, listen to
`rim_rattle_in_01` (kept out of the game's pools: it could be the ball rattling on the backboard rather than the rim).

## Officials, horns and room

These are real recordings: referee whistles, buzzers, horns and two room impulse responses. Every clip is CC0 or CC BY 4.0. Both licenses allow use in a public web game. The CC BY clips need the attribution below to be shown somewhere in the game, for example on a credits screen.

### Processing for every clip

All clips went through the same steps with ffmpeg 8.0.1:

- Cut the segment shown in "Changes" from the source file.
- Downmix to mono, unless the clip says stereo.
- Resample to 44.1 kHz.
- Trim leading and trailing silence below -55 dBFS (-70 dBFS for the impulse responses).
- Add a 3 ms fade-in and a fade-out over the natural tail.
- One-shots: normalize to about -16 LUFS integrated. The true peak stays at -1 dBFS or lower.
- Impulse responses: normalize the peak to -1 dBFS. They have no loudness target.
- Encode as AAC in .m4a: 96 kbps mono, or 128 kbps stereo.

Most sources are the Freesound "HQ preview" MP3s, so the clips are lossy-sourced. The SpliceSound whistle came from the original 24-bit WAV on Wikimedia Commons.

### Clips

| id | file | title | author | source URL | license | changes |
|---|---|---|---|---|---|---|
| whistle_short_1 | whistle_short_1.m4a | WHSTMech-Blue Snowball Microphone, CU_Fox 40 Whistle, Blowing_Nicholas Judy_TDC | designerschoice (Nicholas Judy) | https://freesound.org/s/811508/ | CC BY 4.0 | One short pealess-whistle tweet, 1.82 s to 2.40 s. Mono, trimmed, normalized. |
| whistle_short_2 | whistle_short_2.m4a | same as above | designerschoice (Nicholas Judy) | https://freesound.org/s/811508/ | CC BY 4.0 | One short tweet, 3.17 s to 3.75 s. Mono, trimmed, normalized. |
| whistle_short_3 | whistle_short_3.m4a | Referee whistle sound.wav | Rosa-Orenes256 | https://freesound.org/s/538422/ | CC0 1.0 | Whole file. Mono, trimmed, normalized. |
| whistle_long_1 | whistle_long_1.m4a | WHSTMech-Blue Snowball Microphone, CU_Fox 40 Whistle, Blowing_Nicholas Judy_TDC | designerschoice (Nicholas Judy) | https://freesound.org/s/811508/ | CC BY 4.0 | One long blast, 11.93 s to 14.35 s. Mono, trimmed, normalized. |
| whistle_long_2 | whistle_long_2.m4a | referee_whistle_01.wav | joedeshon | https://freesound.org/s/78508/ | CC BY 4.0 | Whole file. Mono, trimmed, normalized. |
| whistle_long_3 | whistle_long_3.m4a | Coach whistle | Chaos-Kid | https://freesound.org/s/817398/ | CC0 1.0 | Whole file. Mono, trimmed, normalized. |
| buzzer_shotclock | buzzer_shotclock.m4a | buzzer sportif.wav ("Buzzer recorded ... during a game") | Naïma | https://freesound.org/s/510026/ | CC0 1.0 | 0.68 s to 3.30 s: about 1.1 s of buzzer (105 Hz harmonic series) plus the hall tail. Mono, trimmed, normalized. |
| horn_period_end | horn_period_end.m4a | Jääkiekko, summeri / Ice hockey, buzzer at the end of the period, audience shouting (WC-tournament 1997, Helsinki) | YleArkisto | https://freesound.org/s/361537/ | CC BY 4.0 | 0.60 s to 4.9 s: about 2 s of arena end-of-period buzzer, then the crowd reaction, faded over 1.2 s. Mono, normalized. |
| horn_period_end_gym | horn_period_end_gym.m4a | Basketball Ambience - Small Gym.wav | fattirewhitey | https://freesound.org/s/381411/ | CC0 1.0 | 424.3 s to 428.6 s: the final buzzer of a high school basketball game (60 Hz harmonic series) under light crowd noise. Mono, faded. A crowd transient limits the peak, so the clip sits at about -16.5 LUFS. |
| ir_arena_hall | ir_arena_hall.m4a | Impulsional Response Tànger Building Hall | Hal9000 | https://freesound.org/s/393915/ | CC0 1.0 | Recorded impulse response of a large concrete underground hall. Cut from the impulse at 10.05 s and trimmed at the noise floor, about 2.1 s. Fade-out 1.0 s, peak normalized to -1 dBFS, mono. |

### Required attribution text (CC BY 4.0)

- "Fox 40 Whistle, Blowing" by designerschoice (Nicholas Judy), https://freesound.org/s/811508/, licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Edited.
- "referee_whistle_01.wav" by joedeshon, https://freesound.org/s/78508/, licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Edited.
- "Ice hockey, buzzer at the end of the period" by YleArkisto, https://freesound.org/s/361537/, licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Edited.

### Considered and rejected

- Freesound 350773 "Electronic scoreboard horn", 455928 "American game-buzzer variants", 692545, 40754, 455491, 345800, 421005 and 841807: CC BY-NC.
- Freesound 545402 "goalhornsforalert": a medley of horns belonging to specific professional teams.
- Freesound 828060: a human voice imitating a buzzer.
- Freesound 266158: synthetic.
- Freesound 419086: its source is undocumented and it may be synthetic.
- Commons "Buzzer.ogg": a voice imitation.
- Pixabay: the site blocked scripted access (HTTP 403), so no licenses were checked there.
- OpenAIR impulse-response library: the site returned HTTP 403 and has an expired TLS certificate.
- AI-generated sound sites such as ElevenLabs: not real recordings.
