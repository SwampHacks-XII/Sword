# Talk to Moss

On **Choose a game**, click **Talk to Moss**, allow microphone access in your
browser, and say one command. Click **Stop listening** to cancel. Listening ends
after one command or about ten seconds; it does not restart by itself.
The status first says **Opening microphone**, then **Moss is listening** when
the browser confirms recognition has started. **Heard** is always visible:
temporary words are marked **not final yet** and never execute a game action.
If the browser cannot start or finish recognition, its error replaces the
example prompt.

| Say | What happens |
| --- | --- |
| “Hey Moss, create a new game” | Creates an online room using your hero name |
| “Hey Moss, join room code zero one two three” | Joins room `0123` |
| “Hey Moss, play with Swamp Bot” | Opens a bot practice lobby |
| “Hey Moss, sign out” / “Log me out” | Signs out through Auth0 and returns to sign-in |
| “Hey Moss, leave game” | Returns to the welcome page; keeps an existing login |

“Hey Moss” is optional after clicking the microphone. Say room digits one at a
time, including any leading zero. Ordinary four-digit numerals also work.
Conversational requests such as “Hey Moss, can you play with Swampbot?”,
“I want to play with Swamp Bot”, and “start a game with the bot” work too.
Guest practice does not wait for the online login check to finish.
You can see what the browser heard on the game-selection page. If a code is
incomplete or a command is unfamiliar, Moss asks you to try again and does not
create/join a room.

Online room commands require a signed-in account and an entered hero name. Guests
can start Swamp Bot practice. Voice and buttons use the same lobby actions and
checks. Existing room errors remain visible; Moss also reports a failed opening.

Moss acknowledges accepted commands through the existing ElevenLabs voice,
with browser speech as backup. Joining a room reads its digits back. The
microphone stops before Moss replies, and the reply continues into the lobby.
The existing **Mute Moss** preference also applies to these replies; muting
Moss does not enable the microphone.

Moss gives spoken feedback and an on-screen caption for commands, including
sign-out, leaving, and requests that cannot run. Quest start, room exit and
sign-out wait for the short acknowledgement before changing pages, so it is
not cut off. A seven-second limit prevents stalled audio from trapping a player.
Muted voice still advances; unavailable audio leaves the caption as feedback.
Cancelling a pending reply by leaving its page cancels the waiting action.
Guests asking to sign out return to the sign-in page without calling Auth0.

## In the lobby

**Talk to Moss** is also below the **Start my quest** and **leave** buttons,
in both online rooms and guest Swamp Bot rooms.

| Say | What happens |
| --- | --- |
| “Hey Moss, start my quest” | Opens the current room's story briefing |
| “Begin the game” | Also opens the briefing; players still accept the quest before battle |
| “Hey Moss, leave the room” | Uses the same leave action as the button |

Online quests require the host, two connected players, and an open server
connection. Readiness is checked again after Moss finishes speaking. Moss
explains if a rival is missing, the host needs to act, or the
connection is recovering. Bot practice does not require login. Voice cannot
create or join a different room from inside a lobby. The story narration takes
over when the briefing opens. Leaving an online room ends it for both players,
just as the existing leave button does.

## Browser setup

- Start with a supported browser such as current desktop Chrome. The input
  control checks for `SpeechRecognition` / `webkitSpeechRecognition`.
- Use `http://localhost:5173` for local testing, or the game's public **HTTPS**
  website. Browser microphone permissions can prevent recognition on ordinary
  HTTP LAN addresses.
- Allow microphone access yourself when the browser asks. If permission or the
  speech service fails, the game shows a message and the manual buttons work.
- Browser support varies. This version does not integrate ElevenLabs Scribe.

No new API key is required. The browser may send audio to its recognition
provider; browser speech recognition is not guaranteed to work offline. Sword
does not record or upload microphone audio to its own backend, store transcripts,
or send commands to Gemini. Only explicit supported commands produce game
actions. ElevenLabs continues using the existing server key and voice budget
for Moss's spoken acknowledgements.

**Restart the backend once after updating**, so it loads the new built-in Moss
reply lines from the shared protocol package. Then restart/refresh the frontend.
No database migration or new environment variables are needed.

## Quick manual check

1. Sign in, enter a hero name, click the microphone, and ask Moss to create a game.
   Verify exactly one lobby opens and Moss acknowledges it.
2. On another signed-in player, ask to join its four digits. Verify the same lobby.
3. Try a code starting with zero, an incomplete code, an unknown command, and an
   invalid room. An invalid command must not enter a room; server failures should
   appear normally and be acknowledged.
4. Test Stop listening and navigating away while listening. Neither should allow
   a late result to open a room. Check microphone-denied and unsupported-browser
   behavior, and confirm that existing buttons still work.
5. In a guest lobby, ask Moss to start the quest once Swamp Bot has arrived.
   Check that the briefing opens and **Accept my quest** still precedes battle.
   In an online lobby, try as the waiting player and as the host; only the host
   should be able to begin. Try **leave the room** in a fresh lobby too.
6. On game selection, say **leave game** and check that the welcome page opens
   after the acknowledgement. Say **sign out** while signed in and check that
   Auth0 returns to sign-in. Try guest sign-out, muted speech and unavailable
   audio too; each should remain usable.

Automated tests cover command parsing, leading zeros, lobby eligibility,
duplicate/late recognition events, cancellation, timeouts, and input errors.
Actual microphone permissions, recognition accuracy and spoken audio require
the manual checks above.

[Browser speech-recognition reference](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)
