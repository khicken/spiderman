# Voice pack integration

`src/app/audio-voice.ts` plays the pre-recorded Chatterbox clips in `public/voice/` (see `manifest.json`).
It replaces the `speechSynthesis` announcer in `audio-pa.ts`. Do not use `speechSynthesis` anywhere.

The AudioContext lives inside `audio.ts`, so hook the voice there (owner: audio-fx). Five edits:

```ts
// audio.ts, imports
import { createVoice, createVoiceDirector } from "./audio-voice";

// audio.ts, build(), after the mixer nodes (mix) exist
const voice = createVoice(ctx, mix);          // basePath defaults to "/2k"
void voice.load();
const voiceDir = createVoiceDirector(voice);

// audio.ts, handle(events, v): first line
voiceDir.handle(events, v);

// audio.ts, update(dt, ...)
voice.update(dt);

// audio.ts, setVolume(...) and setMuted(...): reuse the PA level that pa.setVolume gets now
voice.setVolume(muted ? 0 : vol.master * Math.max(vol.crowd, vol.sfx) * 0.85);

// audio.ts, dispose()
voice.dispose();
```

Then delete the `pa.say(...)` calls in `audio.ts` (and `audio-pa.ts` itself), so the browser voice never speaks.

## Optional calls (from audio.ts or game.ts through an `AudioPlus` method)

```ts
voice.preloadTeams([home.abbr, away.abbr]);                              // when the matchup is chosen
voice.say("pa_welcome", { priority: 4 });                                // pregame
voice.say("intro", { priority: 3 });                                     // pregame, after the PA
voice.sayLineup(away.abbr, starters(away).map((p) => p.id));             // "And now... the starting lineup..."
voice.sayLineup(home.abbr, starters(home).map((p) => p.id));             // queued after the away five
voice.say("fastbreak", { priority: 1 });                                 // no sim event for it; call on a 2-on-1
voice.say("name", { playerId });                                         // just the last name
voice.say("team", { teamAbbr: "BOS" });                                  // "The Boston Celtics!"
voice.stop();                                                            // skip the intros, pause menu, etc.
```

## Categories

Commentator (`pbp`): intro, tipoff, made3, deep3, dunk, poster, alleyoop, andone, block, steal, fastbreak, ankles,
miss, airball, shotclock, turnover, foul, freethrows, timeout, endq1, endq2, endq3, halftime, buzzer, closelate,
blowout, overtime, finalwin, finalloss, onfire, run, name (per player), team (per team).

PA (`pa`): pa_welcome, pa_starting, pa_team (per team), pa_player (per player).

`createVoiceDirector` maps sim events to these with priorities and random skips (misses, fouls and turnovers are
only called sometimes). Each category has a cooldown, and variants never repeat back to back.

## Regenerating

```sh
cd 2k
node scripts/voice/dump-rosters.mjs > scripts/voice/rosters.json     # after roster edits
/Users/kaleb/Documents/GitHub/khatterbox/.venv/bin/python scripts/voice/generate.py   # only new/changed lines
/Users/kaleb/Documents/GitHub/khatterbox/.venv/bin/python scripts/voice/verify.py     # whisper spot-check
```

Edit line text in `scripts/voice/lines.json` (generic lines) or the name rules in `generate.py`. A changed text is
regenerated automatically on the next run.
