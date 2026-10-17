# Talk to Moss

On **Choose a game**, click **Talk to Moss**, allow microphone access in your
browser, and say one command. Click **Stop listening** to cancel. Listening ends
after one command or about ten seconds; it does not restart by itself.

| Say | What happens |
| --- | --- |
| “Hey Moss, create a new game” | Creates an online room using your hero name |
| “Hey Moss, join room code zero one two three” | Joins room `0123` |
| “Hey Moss, play with Swamp Bot” | Opens a bot practice lobby |

“Hey Moss” is optional after clicking the microphone. Say room digits one at a
time, including any leading zero. Ordinary four-digit numerals also work.
You can see what the browser heard on the game-selection page. If a code is
incomplete or a command is unfamiliar, Moss asks you to try again and does not
create/join a room.

Online commands require a signed-in account and an entered hero name. Guests
can start Swamp Bot practice. Voice and buttons use the same lobby actions and
checks. Existing room errors remain visible; Moss also reports a failed opening.

Moss acknowledges accepted commands through the existing ElevenLabs voice,
with browser speech as backup. Joining a room reads its digits back. The
microphone stops before Moss replies, and the reply continues into the lobby.
The existing **Mute Moss** preference also applies to these replies; muting
Moss does not enable the microphone.

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

Automated tests cover command parsing, leading zeros, lobby eligibility,
duplicate/late recognition events, cancellation, timeouts, and input errors.
Actual microphone permissions, recognition accuracy and spoken audio require
the manual checks above.

[Browser speech-recognition reference](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)
