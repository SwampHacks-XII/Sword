# Connect ElevenLabs to Moss

ElevenLabs is Moss’s main voice for the prologue, quest briefings, guest mode,
and battle reactions. A higher, lighter browser voice is the automatic backup
when ElevenLabs is disabled, out of credits, too slow, or unable to play audio.
The dialogue and battle never wait for narration to finish.

## 1. Create a key and choose a voice

1. Open [ElevenLabs API Keys](https://elevenlabs.io/app/developers/api-keys).
2. Create a key for Sword. Give it **Text to Speech** access; this integration
   does not need voice cloning, account administration, or agent permissions.
3. Copy the key privately. Do not put it in chat, GitHub, or the frontend.
4. In ElevenLabs Voices, choose a voice you like and copy its **Voice ID** from
   the voice’s menu. Make sure it is available to your account and plan.
   A bright, gentle, whimsical English voice will suit Moss’s fairy character.

This uses the low-latency **Eleven Flash v2.5** model. The voice character comes
from the chosen Voice ID; the browser backup approximates a lighter voice by
preferring a suitable English device voice and raising its pitch.

## 2. Fill in your existing private backend environment

Edit **`apps/server/.env`**, keeping your existing Auth0, Tiger Data, and Gemini
settings. These fields have been added at the bottom:

```dotenv
ELEVENLABS_ENABLED=true
ELEVENLABS_API_KEY=PASTE_YOUR_PRIVATE_KEY_HERE
ELEVENLABS_VOICE_ID=PASTE_YOUR_VOICE_ID_HERE
ELEVENLABS_MODEL=eleven_flash_v2_5
ELEVENLABS_DAILY_CHARACTER_LIMIT=10000
```

Use `true` only after filling in the key and Voice ID. The key stays on the
server; no ElevenLabs value needs to be added to `apps/web/.env`.

## 3. Test and play

From **`apps/server`**:

```powershell
npm run voice:check
```

This makes one short, real ElevenLabs request and consumes some ElevenLabs
credits. Success prints the MP3 size and response time, without exposing the key.
It does not play sound from the terminal.

Restart the backend with `npm run dev`, then refresh the website. Enter the
prologue: Moss speaks automatically on each prologue and quest page, at 1.15×
playback speed with pitch preserved. **Mute Moss** saves a mute preference across
pages and silences audio without pausing it. **Unmute Moss** makes the current
point audible, without restarting the passage. If it finished while muted,
unmuting does not play it again. **Replay audio** explicitly repeats a passage.
The Next/Continue button stops the current narration immediately.
During battle, use **Moss’s voice: on/off** to control reactions.

Browsers may block automatic sound until you interact with the website. The
opening journey starts with the **I’ll draw my destiny** click. If a browser
still blocks playback, the page offers **Play Moss’s voice** while keeping all
story navigation usable. Advancing or leaving also cancels pending playback.

ElevenLabs audio keeps its exact playhead position while muted. The browser
backup tracks word boundaries (or estimates progress if the device omits them),
so it resumes near the current word rather than repeating the whole line.

Refreshing also clears old audio from the browser cache after a Voice ID change.
For a fully offline session or to deliberately test the backup, set
`ELEVENLABS_ENABLED=false` and restart the backend.

## Credits, caching, and fallback

- ElevenLabs uses **its own account’s credits**, separate from Google Cloud and
  Gemini credits. Check the ElevenLabs dashboard for your plan’s allowance.
- Identical lines are shared across players and cached by the running backend
  for one hour. The browser also reuses audio it already downloaded.
- New generations have character, rate, and concurrency limits. The default is
  10,000 new characters per UTC day per backend process. This counter resets on
  restart; it is a usage guard, **not an account billing cap**. Adjust it to suit
  your allowance, and use ElevenLabs key limits for account-level controls.
- A credit/quota error automatically selects browser speech. A slow request
  also falls back after about four seconds. No additional generation retry is
  made by the game. A request already sent to ElevenLabs can still consume
  credits even if the listener stops playback.
- Narration is optional. If both audio playback and browser speech fail, the
  written dialogue and captions remain available.

## Before login and guest mode

The public speech route only accepts the game’s built-in prologue, reaction,
and local quest lines. It uses the same ElevenLabs voice and cache. Generated
Gemini quest text uses the authenticated route. This lets Moss speak before
login without exposing a general-purpose public speech generator.

## Render later

Add the same `ELEVENLABS_*` values in Render’s **Environment** settings and
redeploy. Set the API key privately there. Unlike the Google ADC setup, ElevenLabs
does not need a separate Google identity on Render. Your local settings stay
separate from the hosted environment.

## Troubleshooting

| Result | Next step |
| --- | --- |
| Browser voice still plays | Run `voice:check`; check that ElevenLabs is enabled and the backend was restarted. |
| Key rejected | Verify the key value and Text to Speech permission. |
| Key ID used as API key | Copy the secret API key shown at creation, not the ID displayed in the key list. |
| Voice not found or access denied | Verify the Voice ID and that the voice is available to your account/plan. |
| Quota or rate error | Check ElevenLabs credits and usage; the browser backup continues working. |
| Old ElevenLabs voice | Restart the backend and refresh the page to clear both audio caches. |

The backend implementation is `apps/server/src/story/speech.ts`; browser
playback and backup switching are in `apps/web/src/story/elevenLabsNarration.ts`.
No database migration or additional npm dependency is needed.

References: [API key setup](https://elevenlabs.io/docs/overview/administration/workspaces/api-keys),
[speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert),
[models](https://elevenlabs.io/docs/overview/models).
