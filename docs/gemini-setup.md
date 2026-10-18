# Moss’s Gemini quests

Moss can now tell a new short story for every round. Both online players read
**the same story**. Rematch keeps the room and players, then prepares a different
story. Combat still waits for both players to choose **Accept my quest**.

The opening prologue stays fixed. Gemini writes the round briefing, not combat
rules, damage, player actions, or the winner. Each accepted briefing is fewer
than 50 words. Signed-in Swamp Bot games also use Gemini; guests can still play
offline with local stories.

## Run it on your computer

Your Google Cloud project needs billing/trial access, the Agent Platform API
(`aiplatform.googleapis.com`), and an identity allowed to use its models.
This integration uses **Google Cloud**, rather than an AI Studio API key.

1. Install dependencies in `apps/server` with `npm install` after pulling.
2. Authenticate locally in a terminal:

   ```powershell
   gcloud auth application-default login
   gcloud auth application-default set-quota-project YOUR_PROJECT_ID
   ```

3. Add these to your existing private **`apps/server/.env`**. Keep your Auth0 and
   Tiger Data settings. Replace `YOUR_PROJECT_ID` with the Google Cloud project
   ID, not its display name or project number:

   ```dotenv
   GEMINI_ENABLED=true
   GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID
   GOOGLE_CLOUD_LOCATION=global
   GEMINI_MODEL=gemini-3.5-flash-lite
   GEMINI_DAILY_REQUEST_LIMIT=500
   ```

4. From `apps/server`, run **`npm run gemini:check`**. A successful check prints
   the model, response time, word count, and a real generated story. This makes
   one model request and consumes API usage. It fails clearly instead of silently
   returning a fallback.
5. Restart the backend with `npm run dev`. Run the frontend separately as usual.
   Sign in, create a room or Swamp Bot game, then choose **Start my quest**.
   Finish the battle and choose **rematch** to get the next story.

There is no Google secret to paste into `.env` or the website. ADC uses the
credentials created by `gcloud` on the backend computer. A teammate running
their own backend needs their own authorized identity; a teammate joining your
running backend does not need Google credentials.

## Keeping the game quick

- Generation starts when the online lobby is first opened, and again on rematch.
  Signed-in bot games start their request when their lobby opens.
- Opening the quest waits **at most 800 ms more** for its prefetched story.
  Otherwise it selects a short local story so players can continue immediately.
- The Google request has a four-second total timeout, including credential lookup.
  There are no automatic model retries. Bot API requests have a shorter server
  wait so the browser has time to receive a result during lobby preparation.
- A round’s chosen story is fixed. A late response never changes something a
  player already read. Reconnecting restores the story and acceptance state.
- The server rejects malformed, incomplete, 50-word-or-longer, and repeated
  briefings. The fallback rotates through different problems for the evil twin.

## Usage and storage

One online room makes at most one generation attempt per round. The backend
deduplicates bot requests by signed-in user, session, and round. Bot requests
require authentication and are limited to ten new stories per user per minute.
The backend permits up to three simultaneous model requests and defaults to
500 attempts per UTC day **per process**. Restarting the backend resets that
counter; this is a usage guard, **not a billing cap**.

Only a random variation ID, round number, earlier generated briefings, and the
fixed story instructions go to Google. Player names, email addresses, Auth0
tokens, sword measurements, and camera data are not sent to the model.

Stories live in the running game server, like the existing live battle state.
They are not saved in Tiger Data. A server restart requires a new online room;
this change needs no database migration.

Eligible Google Cloud usage can consume active trial credit. Check your actual
credit coverage and remaining balance in Cloud Billing. This code does not
change your billing plan or create any Enterprise App subscriptions.

## Render is a separate setup

If service-account keys are disabled, follow [the keyless Render + Cloud Run guide](gemini-render.md).
It uses the prepared quest helper, its attached Google identity, and a separate
Render-to-helper password. Your existing local ADC setup stays supported.

Your local `gcloud` login does **not** authenticate Render. Leave `GEMINI_ENABLED`
unset or `false` there until the hosted backend has its own Google identity;
the hosted game continues to work with local stories.

For production, configure an authorized workload identity using Google's
[external ADC guidance](https://docs.cloud.google.com/docs/authentication/set-up-adc-on-premises),
then set the same non-secret Gemini environment settings in Render. The identity
needs model access in your project, such as `roles/aiplatform.user`. Do not upload
your personal local ADC file to GitHub or Render, or disable your organization’s
API-key policy. Set up the hosted identity separately using its supported
identity provider and your organization’s permissions.

## Troubleshooting

| What happens | What to check |
| --- | --- |
| The check says credentials are unavailable | Run the ADC login command on the computer running the backend. |
| Google denies access | Verify the project, enabled API, model-access role, and quota-project permissions for your Google identity. |
| Model unavailable | Verify `GEMINI_MODEL` and `GOOGLE_CLOUD_LOCATION` against the model documentation. |
| Moss uses a local story | Run `gemini:check` to distinguish disabled Gemini, credential errors, quota, timeout, and bad model output. |
| Backend works locally but not Gemini on Render | Configure a hosted identity; local ADC does not travel with the source code. |

## Files and checks

| File | Purpose |
| --- | --- |
| `apps/server/src/story/gemini.ts` | Server-only ADC, prompt, Google request, validation, and usage limits |
| `apps/server/src/story/bot-stories.ts` | Authenticated bot story sessions and request deduplication |
| `apps/server/src/game/realtime.ts` | One briefing per online round and shared acceptance |
| `packages/protocol/src/quests.ts` | Shared story types, local stories, prefetch, and timeout selection |
| `apps/web/src/components/QuestScreen.tsx` | Moss’s story display and acceptance button |

From each app directory, run `npm run check`, `npm test`, and `npm run build`.
Tests use fake model responses and test identities, so they do not consume Google
API usage. `npm run gemini:check` is the explicit live-model test.

Model reference: [Gemini 3.5 Flash-Lite](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash-lite).
