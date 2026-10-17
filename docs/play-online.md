# Play online or with Swamp Bot

The website follows this flow:

**Welcome → Evil-twin prologue → Log in / Sign up → Choose game → Lobby → Quest briefing → Battle**

Start on the welcome page and choose **I’ll draw my destiny**. Meet Moss, then log in or sign up to reach
the game-selection page. There, set your player name and choose **Create game**,
**Join game**, or **Play with Swamp Bot**. Signing in returns you directly to game
selection. Existing signed-in players can choose **Choose a game** to continue.

For local practice without an account, choose **Continue as guest with Swamp Bot**
on the login page. Guests get the bot option; online rooms require login.

There are two game modes:

| Mode | What you need | Where the game runs |
| --- | --- | --- |
| **Play with Swamp Bot** | Your name | In your browser; no login, backend, or hardware needed |
| **Play online** | Two Auth0 player accounts and a running backend | Both players join the same room; the backend runs the battle |

Both modes currently use keyboard practice controls. The online server simulates
the target's hit when an attack is successfully cast. Physical sword pairing,
real IR reception, and webcam tracking still need to be connected. Practice
animations are not saved as real sensor measurements.

For friends on different networks, follow [the optional Render hosting guide](hosting-render.md).
After a battle, either player can choose **rematch** to return both players to
the same lobby. The host starts the next round; both health bars reset.

## Start both apps

Open two PowerShell terminals. Use `npm ci` once in each folder after pulling
these changes so the Auth0, WebSocket, and shared protocol dependencies are installed.

**Terminal 1 — backend:**

```powershell
cd C:\Users\nicol\Documents\Sword\apps\server
npm ci
npm run db:check
npm run db:setup
npm run dev
```

**Terminal 2 — website:**

```powershell
cd C:\Users\nicol\Documents\Sword\apps\web
npm ci
npm run dev
```

Open http://localhost:5173. Keep both terminals running. Use Ctrl+C to stop them.
The `predev`, `precheck`, `pretest`, and `prebuild` scripts build the shared
`packages/protocol` package automatically where applicable.

## Auth0 settings

In **Applications → Applications → Sword Web → Settings**, confirm that the
application type is **Single Page Application** and add `http://localhost:5173` to:

- Allowed Callback URLs
- Allowed Logout URLs
- Allowed Web Origins

Keep any Postman callback already configured. Save your changes.
These settings follow the [official Auth0 React SDK setup](https://auth0.github.io/auth0-react/).

### Enable the website to access Sword API

If login immediately returns to the game with **Online sign-in needs one more setup step**,
the app is not authorized for the API. This was the observed configuration error
for the current Sword Web application.

1. In Auth0, open **Applications → APIs → Sword API** (Identifier: `https://sword-api`).
2. Under **Settings → Application Access Policy**, set **User-Delegated Access**
   to **Per-app authorization** and save.
3. Open the API's **Application Access** tab and find **Sword Web**. Match its
   Client ID against your `VITE_AUTH0_CLIENT_ID` if names are similar.
4. Choose **Edit → User-Delegated Access → Grant Access**, then save. Some dashboard
   versions shorten this label to **User Access**. The current Sword backend
   does not require custom API scopes; leave unrelated permissions unchecked.
5. Return to the game and start a fresh **Log in** or **Sign up** attempt.

This is a user-delegated grant for the browser app. It does not require enabling
the Client Credentials flow or creating a machine-to-machine token. See
[Auth0's application API access instructions](https://auth0.com/docs/get-started/applications/application-access-to-apis-client-grants#per-application-permissions).

### Email/username and password forms

The game's **Log in** and **Sign up** buttons open Auth0's hosted credential
forms. Passwords are entered there; Sword does not store them. Each button
explicitly requests its matching form, including when an Auth0 session exists.
An unsuccessful callback now stays on the game's login step and provides safe
setup details instead of sending you back through the welcome page.

For email and password access, enable the **Username-Password-Authentication**
database connection for **Sword Web** under **Authentication → Database →
Username-Password-Authentication → Applications**. Sign-ups must be allowed in
that connection's settings. If the team wants usernames in addition to emails,
configure the database connection's username identifier settings in Auth0.
The identifier and password may appear on consecutive screens, depending on
the tenant's Universal Login profile. See [Auth0 Universal Login](https://auth0.com/docs/authenticate/login/auth0-universal-login).

Your private `apps/web/.env` needs these **public browser settings**:

```dotenv
VITE_API_BASE_URL=http://localhost:3001
VITE_AUTH0_DOMAIN=YOUR-TENANT.us.auth0.com
VITE_AUTH0_CLIENT_ID=YOUR_SWORD_WEB_SPA_CLIENT_ID
VITE_AUTH0_AUDIENCE=https://sword-api
```

The domain and audience must match the backend's Auth0 configuration. Use the
SPA's Client ID, never a client secret. This laptop's file has been populated
using the supplied Client ID and the backend's public Auth0 settings. Teammates
copy `apps/web/.env.example` to their own `.env` and fill in these values.

Keep `DATABASE_URL` only in `apps/server/.env`. Restart Vite after changing the
frontend `.env`, and restart the backend after changing its `.env`.

## Test with two players on one laptop

1. Open the website in a normal browser window, choose **I’ll draw my destiny**, and follow Moss’s prologue.
2. Choose **Log in** or **Sign up**. Complete Auth0 login to reach game selection.
3. Enter your player name and choose **Create game**. The name is saved to Tiger Data.
4. Copy the **four-digit room code**, including any leading zeroes. Online rooms wait for a real player; no bot joins.
5. Open the website in a private/incognito window or a different browser.
6. Follow the prologue and sign in with a **different Auth0 account**. Choose **Join game**, enter the code, then choose **Join room**.
7. Check that both windows show both players as connected. Player 1 is the host
   and chooses **Start my quest**; both players see Moss’s quest briefing.
8. Choose **Accept my quest** in both windows. Combat starts only after both accept.
   Use the controls below. Both windows should show the same health and match result.
9. The completed round and winner are stored in Tiger Data. Choose **Rematch** to
   return both players to the same lobby, then start another quest. Choose **leave**
   to close the room and return to game selection.

| Key | Action |
| --- | --- |
| `1`, `2`, `3`, `4` | Red, blue, green, yellow buttons |
| `Q`, `E` | Swing left, swing right |
| `R`, `W` | Rotate wrist, hold upright |
| `Space` | Trigger |

Enter the spell's button sequence, perform its displayed gesture, then press the
trigger before the armed timer expires. The server assigns a browser to its
authenticated player's slot; it rejects submitted opponent-slot overrides.

## Reconnecting and leaving

- A temporary lost connection is shown to both players. The browser tries to reconnect.
- The server allows 30 seconds to return. Input waits for both players to reconnect.
- After refreshing the page, sign in if needed and join the same code promptly
  to return to a match that still exists in the server's memory.
- Choosing **leave** ends that online room for both players. Create a new room to play again.
- Online battle state lives in one backend process. Restarting it ends the live
  battle; create a new room afterward. PostgreSQL keeps the session records,
  but it does not restore an in-progress battle's health or timers.
- Swamp Bot games remain local and are not written to Tiger Data.

## Verify the backend

From `apps/server`:

```powershell
npm run check
npm test
npm run test:db
npm run build
```

The tests exercise HTTP and real WebSocket clients with a local test identity
issuer. Database tests use a temporary schema in Tiger Data and remove it afterward.
They cover access checks, single-use tickets, personalized lobby slots, host-only
starting, synchronized combat, stored winners, reconnecting, and leaving.
They do not log into your real Auth0 accounts.

From `apps/web`, run `npm run check`, `npm test`, and `npm run build`. Frontend
connection tests run offline and verify bot mode, profile saving, room joining,
leaving, and retrying a temporary connection outage without a browser or real account.

## If something does not work

| What you see | What to check |
| --- | --- |
| Online login is not configured | Fill in the three Auth0 settings in `apps/web/.env`, then restart Vite |
| Auth0 callback/origin error | Add the exact website URL to the three Auth0 allowed URL lists |
| Cannot reach the game server | Keep `apps/server` running; check `VITE_API_BASE_URL` |
| Cannot open the live connection | Backend `WEB_ORIGIN` must exactly match the website's origin |
| Account already connected | Player 2 needs a different Auth0 account/browser session |
| Code rejected/not found | Use all four digits from an online room on the same server |
| Room no longer available | Create a new room after an abandoned or restarted session; use rematch after a completed battle |

For two physical laptops, `localhost` refers to each laptop itself. Configure a
reachable shared backend URL, an appropriate backend `HOST`, the frontend origin
in `WEB_ORIGIN`, and Auth0's allowed URLs. Auth0 browser login requires a secure
context outside localhost, so use HTTPS hosting or a suitable HTTPS development
setup instead of opening an arbitrary HTTP LAN address.
See the [Auth0 SPA SDK secure-origin notes](https://github.com/auth0/auth0-spa-js/blob/main/FAQ.md#why-do-i-get-auth0-spa-js-must-run-on-a-secure-origin).

## Files to know

- `apps/web/src/auth/SessionProvider.tsx`: Auth0 login and access tokens.
- `apps/web/src/net/api.ts`: Authenticated REST requests.
- `apps/web/src/net/onlineConnection.ts`: Live connection, joining, reconnecting.
- `apps/web/src/net/connection.ts`: Choose the online or bot adapter.
- `apps/server/src/game/realtime.ts`: Authenticated WebSockets and online rooms.
- `packages/protocol/src`: Shared messages, spells, types, rules, and practice poses.

Access tokens go in HTTPS request headers. The live socket authenticates with a
short-lived, single-use ticket obtained through the protected API; tokens are not
placed in WebSocket URLs. Production hosting must support HTTPS/WSS and a single
backend instance, or add a shared room coordinator before scaling out.
