# Connect Render to Gemini without a Google service-account key

Your game stays at https://sword-game-wttp.onrender.com. A small **moss-quests**
service on Cloud Run generates stories using its attached Google service account.

```
Players → Render game → authenticated Cloud Run helper → Gemini
```

This supports your existing `iam.disableServiceAccountKeyCreation` policy.
No personal Google login file or service-account JSON key goes into Render.
The helper accepts only a round number and previous briefings; its fixed Moss
prompt, model, Google identity, and usage guard stay on Cloud Run.

The helper code is prepared locally. These steps deploy it; it is not live yet.
Cloud Run, Cloud Build, Artifact Registry, Secret Manager, and Gemini are Google
Cloud services with their own usage charges. Check which usage your trial covers.

## 1. Commit and push the prepared code

Commit the helper changes and push them to GitHub first. The commands below use
the `finished-changes` branch. If you merge them into `main`, use `main` instead.
The deployed Render branch must also contain these changes.

## 2. Open Google Cloud Shell

Open https://console.cloud.google.com/?project=swamphacksxii-511914 and click the
**Activate Cloud Shell** terminal icon at the top. Run these commands in that
Google browser terminal (Bash), not PowerShell:

```bash
gcloud config set project swamphacksxii-511914
git clone --branch finished-changes https://github.com/SwampHacks-XII/Sword.git sword-gemini
cd sword-gemini

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com aiplatform.googleapis.com
```

Use a new checkout name if `sword-gemini` already exists. For later updates, pull
the new commits in that checkout instead of cloning it again.

## 3. Give the service account model access

Your service account is:

`sword-render@swamphacksxii-511914.iam.gserviceaccount.com`

```bash
gcloud projects add-iam-policy-binding swamphacksxii-511914 \
  --member="serviceAccount:sword-render@swamphacksxii-511914.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

If deployment later says you cannot act as this service account, an administrator
must grant your Google login **Service Account User** (`roles/iam.serviceAccountUser`)
on this service account. No organization-policy change is required.

## 4. Create the Render-to-helper password

This is a new application password, not a Google API key or service-account key.
Generate one private random value in Cloud Shell:

```bash
openssl rand -hex 32
```

Save that value privately; you will enter the same value into Google Secret Manager
and Render. Do not paste it into chat, GitHub, or a committed file.

In Google Cloud, open **Security → Secret Manager → Create secret**:

- **Name:** `moss-quest-token`
- **Secret value:** your newly generated value
- Keep the normal automatic replication setting and create the secret.

Allow only the helper's service account to read this secret:

```bash
gcloud secrets add-iam-policy-binding moss-quest-token \
  --member="serviceAccount:sword-render@swamphacksxii-511914.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## 5. Build the helper container

Create this Artifact Registry repository once. Skip creation if it already exists:

```bash
gcloud artifacts repositories create sword-quests \
  --repository-format=docker --location=us-central1
```

Build from a fresh staging directory. The staging script copies only the
helper's build inputs, excluding local `.env` and credential files:

```bash
SWORD_BUILD_CONTEXT="$(node deploy/gemini-relay/stage-context.mjs)"
gcloud builds submit "$SWORD_BUILD_CONTEXT" \
  --config=deploy/gemini-relay/cloudbuild.yaml \
  --substitutions=_IMAGE=us-central1-docker.pkg.dev/swamphacksxii-511914/sword-quests/moss-quests
```

If Cloud Build reports a permission error, use its named build-service identity
and grant the narrow role needed for its build logs/source bucket or Artifact
Registry repository. Do not give the runtime service account Owner or Editor.

## 6. Deploy and attach the service account

This command attaches the account through `--service-account`. The helper needs
no Auth0 settings, database connection string, ElevenLabs key, or local ADC file.
Use the same Gemini model that works locally if you changed the example below:

```bash
gcloud run deploy moss-quests \
  --image=us-central1-docker.pkg.dev/swamphacksxii-511914/sword-quests/moss-quests \
  --region=us-central1 \
  --service-account=sword-render@swamphacksxii-511914.iam.gserviceaccount.com \
  --set-env-vars=GOOGLE_CLOUD_PROJECT=swamphacksxii-511914,GOOGLE_CLOUD_LOCATION=global,GEMINI_MODEL=gemini-3.5-flash-lite,GEMINI_DAILY_REQUEST_LIMIT=500 \
  --set-secrets=QUEST_RELAY_TOKEN=moss-quest-token:1 \
  --allow-unauthenticated \
  --min-instances=0 --max-instances=1 --concurrency=3 \
  --memory=256Mi --cpu=1 --timeout=10s
```

**Why allow unauthenticated at Cloud Run's gateway?** Render is authenticated by
the helper's separate shared-token check. `/generate` still rejects requests
without the password before calling Gemini. Only `/health` is publicly readable.
If your organization also blocks public Cloud Run invocation, stop at that error;
this route needs an approved invocation method, not an organization-policy override.

To confirm the attachment in the website: **Cloud Run → moss-quests → Edit & deploy
new revision → Security → Service account**. It should show the `sword-render`
address above. Google may label the edit action **View diff & redeploy**.

After deployment, copy its HTTPS **Service URL**, ending in `.run.app`.

## 7. Connect the existing Render backend

Open **Render → sword-game → Environment**. Set:

| Key | Value |
| --- | --- |
| `GEMINI_ENABLED` | `true` |
| `GOOGLE_CLOUD_PROJECT` | `swamphacksxii-511914` |
| `GOOGLE_CLOUD_LOCATION` | `global` |
| `GEMINI_MODEL` | Same model configured on Cloud Run |
| `GEMINI_DAILY_REQUEST_LIMIT` | `500` |
| `GEMINI_RELAY_URL` | The helper's HTTPS Service URL, with no path |
| `GEMINI_RELAY_TOKEN` | The same password saved in `moss-quest-token` |

Keep your existing Auth0, database, and ElevenLabs settings. In relay mode, Render
does not use `GOOGLE_APPLICATION_CREDENTIALS`. Nothing here uses a `VITE_` secret.

Choose **Save, rebuild, and deploy**, using the branch/commit with the helper changes.
Render's startup log should say **using the Cloud Run quest helper**. That log
confirms the selected configuration; the next check confirms live Google access.

## 8. Verify a real Gemini story

This check makes one Gemini request and consumes API usage. In Cloud Shell:

```bash
SWORD_RELAY_URL="$(gcloud run services describe moss-quests --region=us-central1 --format='value(status.url)')"
read -r -s -p "Paste your saved helper password: " SWORD_RELAY_TOKEN
printf '\n'
curl --fail-with-body --silent --show-error "$SWORD_RELAY_URL/generate" \
  -H 'Content-Type: application/json' \
  -H "X-Sword-Quest-Token: $SWORD_RELAY_TOKEN" \
  --data '{"roundNumber":1,"previousBriefings":[]}'
unset SWORD_RELAY_TOKEN
```

Success returns a short title, briefing, and `"source":"gemini"`. A 401 means the
passwords do not match. `gemini_permission` means check the attached account's
model access and enabled API; `gemini_credentials` means check its service identity.
Do not post passwords or full credential/header dumps when sharing an error.

Open the hosted game, sign in, and create a fresh quest. Both players still share
one story per round; rematch prepares another. In browser Network → WebSocket
messages, a generated `quest.state` story has `source: "gemini"`.

## Speed and limits

Render bounds the entire helper call to four seconds. Cloud Run bounds the model
call to 3.5 seconds. Existing lobby prefetch and the short foreground fallback
remain in place. A cold Cloud Run start may cause that round to use a fallback;
later quests can use the warm helper. No retries add a long wait to the game.

The 500-attempt guard is per process/UTC day and resets on restart. The configured
single maximum instance reduces concurrency; neither setting is a billing cap.

## Checks performed before deployment

The automated helper tests use fake stories and local HTTP servers. They cover
missing/wrong passwords, invalid/oversized requests, shared stories, rematch
fallback, cancellation, deadlines, and safe errors. They do not consume Google
usage. Container building and real Cloud Run/Render authentication must still be
checked after deployment.

References: [Cloud Run service identity](https://docs.cloud.google.com/run/docs/configuring/services/service-identity),
[Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets),
[Render environment settings](https://render.com/docs/configure-environment-variables).
