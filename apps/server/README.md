# Sword backend

The backend verifies player identity, runs online keyboard battles over authenticated WebSockets, and stores profiles, two-player sessions, winners, sword measurements, and camera tracking in Tiger Data. Physical device connections, real IR input, camera capture, and Gemini still need to be built.

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

`db:check` verifies connectivity. `db:setup` applies numbered SQL migrations and records their checksums without deleting existing rows. Re-running it skips applied files. Add a new migration for future changes; do not edit applied migrations. Restart the server after changing `.env`.

Tiger Cloud hostnames ending in `.tsdb.cloud.timescale.com` automatically use the
public CA pin in `certs/tiger-ca.pem` when the URL does not specify `sslrootcert`.
The default file resolves from the backend module in source and compiled builds.
An explicit `sslrootcert` setting takes precedence. Certificate and hostname
verification remain enabled. See [CA source and fingerprint](certs/README.md)
for the initial trust-on-first-use bootstrap and certificate replacement notes.

If the database rejects the saved password, reset the **database service**
password in Tiger Data, then run `npm run db:set-password` here. The prompt hides
your input and safely URL-encodes it into your local `.env`. Do not paste the
password into chat or a command argument. Then retry `npm run db:check`.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Public process/configuration status; does not check database connectivity |
| GET | `/api/auth/me` | Verify a player access token and return its subject ID; no database needed |
| GET | `/api/me` | Read the signed-in player's profile; 404 if it has not been created |
| PUT | `/api/me` | Create/update that player's profile using only a `displayName` field |
| GET / POST | `/api/swords` | List/register the player's swords |
| GET / POST | `/api/matches` | List/create the player's sessions |
| POST | `/api/matches/join` | Join a session by code |
| POST | `/api/realtime-ticket` | Obtain a short-lived, single-use ticket for the live connection |
| POST | `/api/matches/:matchId/leave` | Leave and close an online session for both players |

See the [game data API guide](../../docs/game-data-api.md) for sword assignment, start/finish, event history, and both players' sword/camera uploads. Import [the Postman collection](../../tools/sword-api.postman_collection.json) to try the flow without a frontend.

For website login, online room codes, Swamp Bot mode, live combat, and a two-account test, follow [the online play guide](../../docs/play-online.md). The backend uses the rules in `packages/protocol`; npm's pre-scripts compile that shared package automatically. Rooms live in one server process, so restarting it requires a new online room.

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
  db/migrate.ts         Apply pending SQL migrations safely
  game/routes.ts        Authenticated session and tracking endpoints
  game/schemas.ts       Validate incoming requests and measurement formats
  game/store.ts         Ownership checks, transactions, and game data queries
  scripts/check-db.ts   Check the database connection
  scripts/setup-db.ts   Apply database migrations
migrations/
  001_players.sql       Initial player schema
  002_game_storage.sql  Matches, slots, swords, events, and samples
  003_time_series.sql   Enable Timescale hypertables when available
test/
  app.test.ts           Token validation and profile-ownership tests
  game.test.ts          Session permissions and both-player data tests
  game-live.test.ts     Run game tests in a disposable real-database schema
```

## Verify and build

```powershell
npm run check
npm test
npm run build
npm start
```

Stop the dev server before `npm start`, or choose a different `PORT`. After the lockfile is present, teammates and CI can use `npm ci` for a repeatable install.

`npm test` uses a local mock identity issuer and an in-memory PostgreSQL emulator. It checks JWT validation, ownership, session permissions, invalid inputs, and sample storage without external accounts.

With your existing `DATABASE_URL`, `npm run test:db` also runs the game API tests against a temporary schema in your real database, including Timescale and concurrent joins. It cleans that schema up afterward and leaves your real player/match records alone. These tests do not exercise a real Auth0 browser login.
