# Spell combat and Moss’s voice

You can build and test game logic before the swords are finished. Keyboard
practice and the future hardware adapter both send button, motion, trigger,
and hit events to the shared rules engine. Online damage, health, healing uses,
and cooldowns are calculated by the server.

Render can be connected later. Local play and testing do not require deploying.

## Play a battle

1. Read Moss’s briefing while she reads it aloud automatically.
2. Accept the quest. Online combat starts when both players accept.
3. Choose **Easy**, **Medium**, or **Hard** on the battle screen. You receive
   one random spell from that group. The assigned spell stays until it is cast
   or fizzles; clicking difficulty again cannot reroll it.
4. Enter the displayed numbers, perform its motion, then press **Space** to fire.
5. Choose a difficulty again for your next cast.

The keyboard mapping is **1 red, 2 blue, 3 green, 4 yellow**. Fire spells currently
use **E** (swing right), water spells **Q** (swing left), and electric spells **R**
(rotate wrist). These motions are keyboard stand-ins, ready to map to the real
motion sensor once its gesture detection is defined.

| Difficulty | Spell | Button sequence | Damage on a hit |
| --- | --- | --- | --- |
| Easy | Flame | 2-2-2 | 5–14 |
| Easy | Waterdrop | 1-2-3 | 5–14 |
| Easy | Spark | 4-2-4 | 5–14 |
| Medium | Fireball | 2-2-4-1-3 | 15–24 |
| Medium | Rainfall | 1-2-3-1-2 | 15–24 |
| Medium | Thunder | 4-4-2-3-1 | 15–24 |
| Hard | Meteor | 2-4-2-2-3-1-3 | 25–30 |
| Hard | Tsunami | 1-2-1-3-1-4-1 | 25–30 |
| Hard | Lightning Bolt | 1-2-4-4-3-2-1 | 25–30 |

All ranges include both endpoints. The server rolls an integer damage value
when the shot is fired. A confirmed hit applies it once; repeated IR reports
for the same shot cannot deal more damage. An unanswered shot expires as a miss.
The spell stays armed for five seconds after the correct motion, then fizzles.

Online keyboard practice still simulates a successful receiver hit. Swamp Bot
practice simulates hits and misses. Real aim and IR reception need the hardware.
Moss’s miss reactions are driven by actual game miss events, rather than randomly
claiming an attack missed.

## Heal

Each player has **two heals per battle**. The separate **Heal** button rolls
**10–20 HP**, capped at the maximum of 100 HP. You must wait **five seconds**
after a successful heal before using the second one. The button displays the
remaining cooldown and uses.

Healing at full health does not spend a use. Healing does not cancel a selected
spell, cannot revive a defeated player, and cannot be used after the battle ends.
A rematch restores 100 HP, two heals, and no heal cooldown for both players.
Swamp Bot chooses difficulties and can heal using these same limits.

## Moss’s voice

Prologue and quest scripts play automatically through ElevenLabs when configured,
with browser speech as the backup. Playback is slightly quicker (1.15× for
ElevenLabs, preserving pitch). **Mute Moss** remembers your choice across pages
and silences the narration while it keeps playing. Unmuting restores sound at
the current point; it never restarts a completed passage. **Replay audio** is an
explicit way to repeat it. Next/Continue stops the current audio immediately.
Voice playback never delays the Accept button or starts combat for you. Changing
a page or leaving the briefing stops its narration. If the browser blocks
autoplay, use the **Play Moss’s voice** recovery button.

Sound is on by default for story pages unless you previously muted Moss. You can use
**Moss’s voice: on/off** in battle. The preference is saved on that device when
browser storage is available. Other players control their own sound.

Moss has short response banks for your successful hits, receiving a hit, missed
shots, fizzled spells, and healing. For example: **“Good hit!”**, **“That one
missed!”**, and **“A little healing magic!”**. Captions continue when sound is off.
Reactions are spaced apart, and ones that arrive while Moss is speaking are
not added to an audio queue.

When the battle ends, Moss automatically celebrates your victory or offers
encouragement after a loss. His line appears on the results card with mute and
replay controls. It replaces any unfinished hit reaction, uses ElevenLabs with
the browser backup (including guest practice), and stops on rematch or leaving.
The existing Moss mute preference applies to the ending too.

The backup uses the browser/device’s available English voices, preferring a
lighter voice and raising its pitch. Sound and available voices vary by device. If
speech is unavailable or blocked, the dialogue remains readable.

ElevenLabs narration uses its own credits, with repeated lines cached to reduce
generation requests. The browser backup has no speech API charge. Gemini still
generates only the short quest text. See [ElevenLabs setup](elevenlabs-setup.md).

## Where to make changes

| File | Purpose |
| --- | --- |
| `packages/protocol/src/spells.ts` | All sequences, difficulty groups, damage ranges, healing settings |
| `packages/protocol/src/rules.ts` | Server/bot combat, damage rolls, hit deduplication, healing limits |
| `apps/web/src/components/SpellPanel.tsx` | Difficulty chooser, combo display, Heal button and cooldown |
| `apps/web/src/story/narration.ts` | Browser speech adapter |
| `apps/web/src/story/reactions.ts` | Moss’s response banks and event-to-response mapping |
| `apps/web/src/components/BattleMoss.tsx` | Reaction captions, sound toggle, and speech spacing |

Run `npm run check`, `npm test`, and `npm run build` in each app folder.
Backend tests cover damage ranges, exact sequences, heal limits and timing,
duplicate hits, and the online flow. Frontend tests use a speech stub to check
read-aloud behavior, cancellation, and reactions; listen on your own device to
check the voice quality and volume.
