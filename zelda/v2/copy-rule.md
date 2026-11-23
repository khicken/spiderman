# Copy rule (from the user, mandatory for v2)

All player-facing text must say exactly what happened and what to do next.
Use the right words, not more words. No poetic lore phrases that the player must decode.

Bad (v1 death screen):
  "The lantern gutters" / "But an ember remembers. Rise again at the last flame you lit."
Good:
  "You fell" / "Respawning at the last beacon you lit."

Rules:
- Name game things by one plain name, used the same everywhere (HUD, journal, toasts, map). Example: if the HUD shows "Flames", the text says "flames", not "ember", "light" or "glow".
- Each line answers one of: what happened, what to do, where to go, what you got.
- Verbs for actions the player does: "Light the beacon", "Press E to open", "Find the shrine north of the village".
- Flavor text is allowed only in optional places (item descriptions, journal lore), never in prompts, objectives, death, or tutorials.
- Short. A toast or objective fits one line on a phone.
- Audit every string in ui-*.tsx, state.ts objectiveText, game.ts toasts, landmark prompts.
