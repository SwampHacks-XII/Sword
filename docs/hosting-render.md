# Host Sword on Render

This is an **optional second way to run Sword**. Keep using the existing two
local dev terminals whenever you want. Hosting does not replace your local
`.env` files or remove game data.

Both players open one public HTTPS website, sign into separate accounts, and
join the same four-digit room code. They can use different Wi-Fi networks or
mobile internet. They do not need to install the project or run a backend.

**Gemini stories:** local Google login credentials do not transfer to Render.
The hosted game uses local stories until you separately configure its Google
identity and Gemini settings. See [the Gemini guide](gemini-setup.md#render-is-a-separate-setup).

## 1. Push the tested changes

Review and commit the changes, including `render.yaml`, the hosted helper
scripts, and migration `004_rematches_and_room_codes.sql`, then push to GitHub.
Render reads the files from GitHub, so they must be on the branch you select.
Private `.env` files, `node_modules`, and build output are ignored by Git.

## 2. Create the hosted service

1. Sign into [Render](https://dashboard.render.com/).
2. Choose **New → Blueprint** and connect your GitHub account if prompted.
3. Select **SwampHacks-XII/Sword** and the branch containing these changes.
4. Keep the Blueprint path as `render.yaml`. Give the Blueprint a name, such as `sword`.
5. Enter your existing Tiger Data connection string for **DATABASE_URL**.
   Enter this privately in Render. It never belongs in a `VITE_` setting.
6. Review the service: **Node**, **Free**, **one instance**. Create/apply the Blueprint.

The Blueprint configures the build command, start command, health check, and
public Auth0 settings. Render provides `PORT` and `RENDER_EXTERNAL_URL`.
Automatic deploys are disabled: publish future changes with a manual deploy.
See [Render Blueprints](https://render.com/docs/infrastructure-as-code).

**Certificate paths:** a Windows `sslrootcert=C:\...` path in your copied database
URL will not exist on Render. For your Tiger Cloud hostname ending in
`.tsdb.cloud.timescale.com`, remove only that `sslrootcert` query parameter from
the **Render copy** of the URL. Keep the remaining connection details intact.
The backend then uses its included `apps/server/certs/tiger-ca.pem` with full
certificate and hostname verification. Keep any other custom provider's
required CA configuration. Do not change the local connection string.

The start command applies pending migrations before accepting connections.
It keeps existing profiles, matches, sword readings, and camera recordings.

## 3. Allow the website in Auth0

Once Render shows a URL such as `https://sword-game-xxxx.onrender.com`:

1. Open Auth0 → **Applications → Applications → Sword Web → Settings**.
2. Add your **actual Render origin**, without a path, to all three fields:
   - **Allowed Callback URLs**
   - **Allowed Logout URLs**
   - **Allowed Web Origins**
3. Keep the existing `http://localhost:5173` entries. Separate multiple entries with commas.
4. Save changes.

For example, each field can include:

```text
http://localhost:5173, https://YOUR-ACTUAL-SERVICE.onrender.com
```

Keep the audience exactly `https://sword-api` on the frontend and backend,
**without a trailing slash**. This is the Identifier of your **SwampHacks API**
in Auth0. The application remains **Sword Web**.

## 4. Test the public version with a friend

1. Wait until Render says the service is live, then open its HTTPS URL.
2. Check `/health` on that URL. It should show `status: ok`.
   This checks the process; creating a room also checks the database.
3. Sign in and create a game. Note all four digits of the room code.
4. Have your friend open the **same hosted URL**, sign into a different account,
   and join that code. Test with one player on mobile internet if you want to
   verify different networks explicitly.
5. Confirm both names appear, then have the host start the battle.
6. Complete a battle. Either player presses **rematch**: both should return to
   the same lobby with the same players and code. The host starts the next round
   with fresh health. Leaving closes the room for both players.

Both players must choose the same server. A local room code and a hosted room
code do not connect two different backend processes.

## What the free service means

Render's free web service can sleep after 15 minutes without incoming traffic;
the next visit may take about a minute to wake it. A deploy or restart ends live
rooms because combat runs in memory. Saved profiles, completed round results,
and recorded measurements remain in Tiger Data. Create a new room after a restart.
See [Render's free service limits](https://render.com/docs/free).

Keep **one instance**: rooms currently belong to a single Node process. The
service uses HTTPS and WSS for browser and multiplayer traffic. See
[Render WebSockets](https://render.com/docs/websocket).

Hardware, real IR hits, and camera capture still need their own integration.
Hosting currently supports the existing keyboard practice game.

## Optional: preview the hosting build locally

From the repository root:

```powershell
npm ci --prefix apps/server
npm ci --prefix apps/web
Copy-Item .env.hosted.example .env.hosted
```

Copy the example **only if `.env.hosted` does not exist**. Add your private
database URL and verify the public Auth0 settings in that new file. Your local
app `.env` files stay separate. For this preview, add `http://localhost:3002`
to the same three Auth0 allowed URL fields while keeping the other entries.

```powershell
npm run build:hosted
npm run start:hosted
```

Open `http://localhost:3002`. Ctrl+C stops that preview. The website is built to
`apps/web/dist-hosted`, separately from the regular frontend `dist` folder.
The API address and public `VITE_AUTH0_` settings enter the browser bundle;
the database connection string stays on the backend.

## Automated verification

After building the hosted version, run these from the repository root:

```powershell
npm run test:hosted
npm run test:hosted:db
```

The first uses an in-memory database. The second reads `apps/server/.env`, uses
a new isolated schema in the real database, and removes only that schema when
finished. Both use temporary trusted test certificates for HTTPS/WSS and a test
identity issuer. OpenSSL must be installed (Git for Windows includes it); set
`OPENSSL_PATH` if needed.

These tests cover served HTML/assets, protected API routes, WebSockets, two-player
combat, room codes, rematch, and stored round history. They do not verify your
real Auth0 dashboard settings or a public Render deployment; use the two-account
check above after publishing.
