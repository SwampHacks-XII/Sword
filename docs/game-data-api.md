# Multiplayer and tracking data

**You can use this backend before the website or swords are ready.** It stores
two-player matches, sword readings, and camera tracking results in Tiger Data.
It does not animate anything or simulate physical gameplay on its own.

## What is ready

- Create a match, share a join code, and join as player 2.
- Register each player's sword and assign it to their match slot.
- Have the host start and finish a session, optionally recording a winner.
- Save and read timestamped sword data for both players.
- Save and read camera tracking for both players, including a shared camera.
- Keep a history of session changes and reported button/gesture/IR inputs.

This guide covers session management and data storage. The website also has
Auth0 login and live online keyboard battles: see [online play](play-online.md).
That separate WebSocket channel runs the shared spell/damage rules and simulates
attack reception for keyboard practice. Physical device pairing/authentication,
real sensor gesture recognition, IR input, camera capture, and video uploads remain
future work. Reports sent to the REST event endpoint remain unverified inputs;
posting an IR hit there does not award damage.

## Start here

From `apps/server`, with your existing private `.env`:

```powershell
npm run db:check
npm run db:setup
npm run dev
```

The setup command applies new SQL migrations in order. Existing player records
are preserved. Re-running it skips migrations already applied. Do not edit a
migration after it has been applied; add a new numbered file for future changes.

You can inspect these tables in Tiger Data's SQL editor:

| Table | Contents |
| --- | --- |
| `players` | Existing Auth0-linked profiles |
| `matches` | Join code, host, status, timestamps, optional winner |
| `match_rounds` | Completed round number, winner, and timestamps retained across rematches |
| `match_players` | Two player slots and their assigned swords |
| `swords` | Device IDs and their registered owners |
| `match_events` | Session history and unverified device input reports |
| `sword_samples` | Timestamped sword measurements |
| `camera_samples` | Timestamped tracking results and who uploaded them |
| `schema_migrations` | Applied migrations and their checksums |

The two sample tables become Timescale hypertables when the TimescaleDB extension
is installed. The remaining tables are ordinary PostgreSQL tables.

## Try it without a frontend

Import `tools/sword-api.postman_collection.json` into Postman. It contains requests
in order, with sample bodies and scripts that save returned match/sword IDs.

Set its collection variables:

| Variable | Value |
| --- | --- |
| `baseUrl` | `http://localhost:3001` |
| `tokenA` | Player 1's Auth0 access token for Sword API |
| `tokenB` | A different player's Auth0 access token for Sword API |

Use two real player accounts to test two-player behavior. The [login setup guide](backend-setup.md)
explains how to obtain an access token. Keep tokens in your private Postman
configuration; never commit filled-in tokens to the collection JSON.

Send the collection's requests in this order:

1. Create/update profiles for players A and B.
2. Register swords A and B. The collection generates fresh sample device IDs each time; use `GET /swords` to reuse a device you already registered.
3. Create a match as A; its response supplies the match ID and join code.
4. Join the match as B using that code.
5. Assign each player's own sword, then start the match as A.
6. Upload sword and camera batches. Read them back from either player's account.
7. Finish as A, then read the stored event history.

Already joined? Joining again returns the existing membership. A third account
cannot take another slot. Only the host can start/finish. Completed matches stay
readable but reject new readings and device events. The host-managed winner field
is for manual session recording; authoritative combat results come later.

If you do not want to set up Postman login yet, run:

```powershell
npm run test:db
```

That runs the API tests against a new temporary schema in your database, using a
local test identity issuer. It removes that schema afterward and never changes
your real player or match records. This does not bypass Auth0 in the normal server.

## Endpoint reference

All paths below start with `/api`. All require a valid **player access token**:

```text
Authorization: Bearer YOUR_ACCESS_TOKEN
```

Create a profile with `PUT /api/me` before using game endpoints. Your identity
comes from the verified token, not a player ID submitted in a body.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/swords` | Register your own device ID and label |
| GET | `/swords` | List your own registered swords |
| POST | `/matches` | Create a match; host becomes slot 1 |
| POST | `/matches/join` | Join using a code |
| GET | `/matches` | List matches you belong to |
| GET | `/matches/:matchId` | Match details, slots, and sword assignments |
| PUT | `/matches/:matchId/sword` | Assign your own sword while waiting |
| POST | `/matches/:matchId/start` | Host starts once two players have joined |
| POST | `/matches/:matchId/finish` | Host finishes an active match |
| POST | `/matches/:matchId/leave` | A participant closes a session for both players |
| POST | `/realtime-ticket` | Obtain a ticket for the website's live connection |
| POST / GET | `/matches/:matchId/sword-samples` | Upload/read sword recordings |
| POST / GET | `/matches/:matchId/camera-samples` | Upload/read tracking results |
| POST / GET | `/matches/:matchId/events` | Report inputs/read session history |

POST `/matches` and `/start` accept an empty JSON object. Other bodies are shown
below. GET lists use `limit` (1-100, default 50) and `offset` (0-10000, default 0).
Readings/events also support an optional `playerId` filter. These are history
queries with offset pagination, not the future live movement channel.

## Request examples

### Register, join, assign, and finish

```json
{"deviceId":"sword-a","label":"My first sword"}
```

```json
{"joinCode":"0017"}
```

```json
{"swordId":"REPLACE_WITH_YOUR_RETURNED_SWORD_UUID"}
```

```json
{"winnerPlayerId":"REPLACE_WITH_A_PARTICIPANT_UUID"}
```

The finish body can be `{}` for no recorded winner. New join codes contain exactly
four digits and are strings, so keep leading zeroes. Codes are unique among open
rooms and may be reused after a room closes. Existing stored sessions are preserved.
Completed rounds are kept in `match_rounds`; the match's `roundNumber` advances
when a player sends `match.rematch` over the authenticated game socket. Both
players must be connected, and the host starts the next battle from the lobby.
A device ID can be registered
only once; `GET /swords` lets you reuse an existing sword instead of registering it again.

### Sword measurements

POST to `/matches/:matchId/sword-samples`:

```json
{
  "swordId": "REPLACE_WITH_YOUR_ASSIGNED_SWORD_UUID",
  "samples": [
    {
      "orientation": [0, 0, 0, 1],
      "acceleration": [0, 9.81, 0],
      "angularVelocity": [0, 0, 0],
      "deviceTimeMs": 1200,
      "sequenceNumber": 1,
      "coordinateFrame": "sword-y-up"
    }
  ]
}
```

- `orientation`: required quaternion `[x,y,z,w]`; identity is `[0,0,0,1]`.
  Norm must be within 0.05 of 1; accepted values are normalized before storage.
- `acceleration`: optional sensor-local `[x,y,z]` in m/s^2, including gravity.
- `angularVelocity`: optional sensor-local `[x,y,z]` in rad/s.
- `deviceTimeMs`: optional device uptime; it is not a synchronized timestamp.
- `sequenceNumber`: optional nonnegative integer for sensor diagnostics.
- `coordinateFrame`: required agreed frame name for the orientation. Calibration
  and sensor-to-model mapping must be implemented before using it in a viewer.

Only the player assigned to that sword's match slot can upload its measurements.
Either match participant can read both players' recordings. The device ID is
currently a registration label, not proof that hardware is physically paired.

### Camera tracking

POST to `/matches/:matchId/camera-samples`:

```json
{
  "cameraId": "laptop-webcam",
  "samples": [
    {
      "confidence": 0.95,
      "imagePoint": [0.4, 0.6],
      "frameNumber": 42,
      "coordinateFrame": "image-normalized"
    }
  ]
}
```

- `confidence`: required number from 0 to 1.
- Include at least one of `imagePoint`, `positionMeters`, or `orientation`.
- `imagePoint`: normalized `[x,y]`, each from 0 to 1. Use an agreed image origin
  (for example top-left); record that convention with the camera implementation.
- `positionMeters`: optional measured/estimated `[x,y,z]` in meters. Do not put
  pixel coordinates or raw accelerometer values here.
- `orientation`: optional normalized `[x,y,z,w]` quaternion.
- `frameNumber`: optional nonnegative integer.
- `coordinateFrame`: required name describing the result's frame, such as
  `image-normalized`, `camera-local`, or a calibrated world frame.

By default the result belongs to the uploading player. For one camera tracking
both players, the **host** may add `trackedPlayerId` for either match participant.
The backend also records the uploader ID. A guest cannot upload as the host.

This stores tracking results, not webcam frames, video, or camera calibration.
The actual vision algorithm and hardware data collection still need to be built.

### Timestamps, batches, and retries

Both sample endpoints accept 1-100 samples per request and a 128 KB body limit.
Batch recordings instead of tying every live display frame to a database write.

Each sample can include `sampleId` (UUID) and `capturedAt` (ISO-8601 timestamp with
timezone). If omitted, the server generates an ID and uses its receive time.
Provided times must be within the past seven days and at most five minutes ahead.
Keep the device uptime separately until clocks are synchronized.

For safe retries, supply the **same sample ID and captured timestamp** on every
retry. Their pair is unique; repeated pairs are ignored rather than overwritten.
If either is regenerated, it is a new sample. The response includes `accepted`,
`duplicates`, and IDs/timestamps for the newly inserted samples.

### Input reports

POST one of these to `/matches/:matchId/events`:

```json
{"type":"button","button":"red"}
```

```json
{"type":"gesture","gesture":"circle-clockwise"}
```

```json
{"type":"ir-hit","shotId":"shot-42","attackerSlot":2}
```

Buttons are `red`, `blue`, `green`, `yellow`, or `trigger`. Gesture names and shot IDs are
strings up to 64 characters. These reports are stored as **unverified** and do not
alter health or score. Clients cannot submit server lifecycle events.

## Check the work

```powershell
npm run check
npm test
npm run test:db
npm run build
```

The offline tests use an in-memory PostgreSQL emulator and a local JWT issuer.
The opt-in database tests check real migrations, Timescale partitioning,
concurrent joins, and the API against a disposable schema. A real Auth0 browser
login, physical sword/camera input, and frontend integration are separate tests.
