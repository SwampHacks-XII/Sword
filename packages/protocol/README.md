# Shared game protocol

The website and backend depend on this package through `file:../../packages/protocol`.
Their npm pre-scripts compile `src` into the ignored `dist` folder automatically.
Run `npm ci` in each app after pulling changes to package dependencies.

- `types.ts`: lobby, fighter, match, gesture, and pose types.
- `messages.ts`: browser commands and server messages.
- `spells.ts`: nine spell sequences, difficulty/damage ranges, healing limits, timing, and labels.
- `rules.ts`: spell/health logic used by the online backend and offline bot.
- `poses.ts`: keyboard practice animations, not real sensor measurements.

Online rules run on the server. The browser submits its own buttons/gestures;
it cannot choose another player's slot or submit damage. Swamp Bot runs the same
rules locally and does not use the backend or database.

Each cast starts with `spell.choose` and a difficulty. The server assigns one
spell, then checks its sequence, motion, and trigger. `player.heal` restores
10–20 HP, capped at 100, at most twice per battle with a five-second cooldown.
Both commands apply only to the authenticated player’s slot. Damage and healing
values are never accepted from the browser. See [combat rules](../../docs/combat-and-voice.md).

Live viewer quaternions are **[w,x,y,z]**. The existing measurement-storage API
uses **[x,y,z,w]**. A future hardware adapter must explicitly reorder these values,
agree on units/coordinate frames, and perform calibration. Do not send practice
poses to the database as if they were physical sword measurements.

Physical device authentication, firmware transport, real IR hit reports, and
camera capture are separate future integrations.
