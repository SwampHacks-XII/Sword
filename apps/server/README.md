# Sword backend

The first backend feature is player identity and a saved display name. Hardware, movement, gameplay, Gemini, and the website login button are not implemented here yet.

Start with the [account and connection guide](../../docs/backend-setup.md). It explains how to create Auth0 and Tiger Data accounts and fill in your local configuration.

## Run locally

From this folder (`apps/server`), with Node.js 22.12+ and npm:

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Copy the example only once; do not overwrite an existing `.env`. Open http://localhost:3001/health to check that the server runs. Blank service settings are allowed during local setup, but protected routes remain unavailable until Auth0 is configured. Setting just one of the two Auth0 settings is an error. Production requires both services.

After setting `DATABASE_URL` in `.env`, run these in another terminal from this same folder:

```powershell
npm run db:check
npm run db:setup
```

`db:check` verifies connectivity. `db:setup` creates the initial `players` table without deleting existing rows; it is not a general-purpose migration framework. Use new migrations for later schema changes. Restart the server after changing `.env`.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Public process/configuration status; does not check database connectivity |
| GET | `/api/auth/me` | Verify a player access token and return its subject ID; no database needed |
| GET | `/api/me` | Read the signed-in player's profile; 404 if it has not been created |
| PUT | `/api/me` | Create/update that player's profile using only a `displayName` field |

Send an Auth0 access token for **Sword API** as `Authorization: Bearer <token>` to all `/api` routes. An ID token is not the API token. Machine-to-machine tokens are rejected for player routes.

Example body for `PUT /api/me`:

```json
{"displayName":"Nico"}
```

The backend gets ownership from the verified token, not a submitted player ID. Only `displayName` is accepted, trimmed to 1-40 characters. Names are plain text; the future UI should render them as text.

Missing/invalid tokens return 401 once Auth0 is configured. Missing service configuration or database failures return 503. A valid token with no existing profile receives 404 from `GET /api/me`; call PUT to create it. Local settings belong in `.env`, which is gitignored. No passwords or access tokens are stored in the database.

## Files

```text
src/
  index.ts              Start/stop the server and load environment settings
  app.ts                HTTP routes and Auth0 token validation
  config.ts             Validate local configuration
  db/pool.ts            Tiger Data/PostgreSQL connection pool with verified TLS
  db/players.ts         Parameterized queries for the current player's profile
  scripts/check-db.ts   Check the database connection
  scripts/setup-db.ts   Create the initial table
migrations/
  001_players.sql       Initial player schema
test/
  app.test.ts           Token validation and profile-ownership tests
```

## Verify and build

```powershell
npm run check
npm test
npm run build
npm start
```

Stop the dev server before `npm start`, or choose a different `PORT`. After the lockfile is present, teammates and CI can use `npm ci` for a repeatable install.

Tests use a local mock identity issuer and an in-memory PostgreSQL emulator. They check real JWT signatures, audience/issuer/expiration rejection, profile ownership, invalid inputs, and missing configuration. They do not connect to Auth0 or Tiger Data. Live login and hosted-database checks require your own accounts and settings.
