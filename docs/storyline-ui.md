# Storyline UI wireframes

The reference image guides the whole in-app theme: pastel pixel sky and meadow,
warm grid-textured parchment, muted purple swords, and a little green forest NPC
at the lower-left edge of the scroll. The guide is currently named **Moss**.

## Player journey

1. **Welcome:** animated meadow, drifting clouds, floating light, and two sword-bearing figures.
   The opening button is **I’ll draw my destiny**.
2. **Prologue:** two animated dialogue pages introduce Moss and the evil twin.
   The last button leads to login/sign-up. **Show all dialogue** skips the typing
   effect; it never skips the page itself.
3. **Login/sign-up:** a themed hero ledger leads to the existing Auth0 credential
   pages. Successful authentication still returns to game selection.
4. **Choose a game:** name your hero, create/join an online room, or train with Swamp Bot.
5. **Lobby:** see both players and the four-digit code. The host chooses **Start my quest**.
6. **Quest briefing:** Moss explains that the evil twin stole the Dawn Rune.
   **Accept my quest** begins combat after both online players have accepted.
   Swamp Bot is ready automatically and waits for the human player.
7. **Battle:** existing 3D sword combat with parchment health/spell panels, Moss's
   encouragement, and a looking-glass camera placeholder. Victory/defeat leads
   to rematch or leave. Rematch keeps the room, returns both players to its lobby,
   and lets them open a fresh briefing for the next round.

## Edit the story

All prologue and quest copy lives in **`apps/web/src/story/chapters.ts`**.
It is fixed placeholder text. There are no Gemini requests, SDK dependencies,
model settings, or AI credentials in this change.

| File | Purpose |
| --- | --- |
| `apps/web/src/components/StoryScene.tsx` | Reusable dialogue layout and text reveal |
| `apps/web/src/components/PrologueScreen.tsx` | Opening story pages and login transition |
| `apps/web/src/components/QuestScreen.tsx` | Quest copy, acceptance, and waiting state |
| `apps/web/src/components/NpcGuide.tsx` | Moss artwork and short captions |
| `apps/web/src/components/WorldBackdrop.tsx` | Landscape, decorative fighters, and ambient animation |
| `apps/web/src/styles.css` | Shared theme, responsive layouts, reduced-motion styling |
| `apps/web/public/art/` | Original SVG meadow, Moss, and decorative knight illustrations |

When Gemini is added later, generate and validate the quest dialogue on the
backend, then send the same quest content to both players. Keep the existing
acceptance gate so combat waits while they read. Do not put an API key in Vite
environment variables or the browser bundle.

Auth0 hosts the actual email/password form outside this repository. This update
themes the app's login/sign-up entry page and keeps the working Auth0 flow.
Auth0's own form branding is managed separately in its dashboard.

## Multiplayer behavior

`quest.begin` is host-only. It broadcasts `quest.state` to the room while the
database match remains waiting. Each player sends `quest.accept`; only when both
are connected and accepted does the server start the battle. Reconnecting during
the briefing restores its acceptance state. Leaving closes the room as before.
No database migration is needed for these UI/story states.

Both frontend and backend need this version of the shared protocol. Restart a
non-watching backend after updating it; Vite and `tsx watch` normally pick up
local source changes. No environment setting changes are required.

## Check the flow

Open the local website, follow the prologue, and use guest Swamp Bot to try the
whole sequence without login. To verify online play, use two different accounts
in the same room: confirm that one acceptance does not start combat, then accept
on the second client. Check rematch, reconnect, and leaving as well.

From each app directory run `npm run check`, `npm test`, and `npm run build`.
The connection tests cover the bot's quest gate; backend tests exercise a real
HTTP/WebSocket quest flow with test identities, including reconnect and rematch.
Motion-sensitive players can use their system's reduced-motion preference to
disable decorative animation and display dialogue immediately.
