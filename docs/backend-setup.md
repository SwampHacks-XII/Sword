# Connect Auth0 and Tiger Data

This is the first setup milestone: **sign in as a player, then save and retrieve that player's display name.** The physical swords can be connected later.

## What you need

- An Auth0 account and tenant for the project.
- A Tiger Data account and database service.
- Node.js 22.12+ and npm on your laptop.
- Postman if you want to test player login before building the website.

One team tenant/database is enough. Invite teammates through the services' team features rather than sharing your personal account password.

These services do not connect directly to each other:

```text
Player logs in through Auth0
             |
             v
Backend verifies the player's access token
             |
             v
Backend reads/writes their profile in Tiger Data
```

## 1. Create the Auth0 API

1. Open the [Auth0 dashboard](https://manage.auth0.com/) and create an account/tenant.
2. Go to **Applications -> APIs -> Create API**.
3. Name it **Sword API**.
4. Set the **Identifier** to `https://sword-api` and keep **RS256** signing.
5. Save the API. Its identifier is an audience label; it does not need to be a working website.
6. Find your tenant domain, such as `dev-example.us.auth0.com`.

Your backend needs these two settings:

```dotenv
AUTH0_ISSUER_BASE_URL=https://YOUR-TENANT.us.auth0.com/
AUTH0_AUDIENCE=https://sword-api
```

Use your actual domain, including its region. The backend checks the token's signature, issuer, audience, and expiration. It uses the verified `sub` (subject) as the account's identity. See the [Auth0 API guide](https://auth0.com/docs/quickstart/backend/nodejs).

## 2. Register the future website

In Auth0, create an application named **Sword Web** with type **Single Page Application**.

For the planned local website, set these to `http://localhost:5173`:

- Allowed Callback URLs
- Allowed Logout URLs
- Allowed Web Origins

Save its **Domain** and **Client ID** for the future React frontend. A browser application does not keep a client secret. The backend token verifier needs the tenant URL and API audience, not the application's client secret.

The website itself has not been built yet. Later, its Auth0 SDK will request an access token with the `https://sword-api` audience and send it to the backend. See the [React login guide](https://auth0.com/docs/quickstart/spa/react).

## 3. Create the Tiger Data database

1. Sign up at [Tiger Data](https://www.tigerdata.com/) and create a database service.
2. Save the database password securely when it is provided.
3. Copy the service's **PostgreSQL connection string** from its connection details.
4. Put it in the backend's local `.env` as `DATABASE_URL`.

Its general shape is:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=verify-full
```

Use the actual host, port, and database supplied by Tiger Data. If you assemble a URL yourself, URL-encode special characters in the password. Prefer copying the service's generated string.

The backend enforces verified TLS using `sslmode=verify-full`. If your service supplies a required root certificate, use its documented certificate settings; the driver supports `sslrootcert` in the connection URL. Do not disable certificate verification to resolve a connection problem. See [Tiger Data connection details](https://www.tigerdata.com/docs/integrate/find-connection-details) and [PostgreSQL driver TLS settings](https://node-postgres.com/features/ssl).

This project's current service uses the public CA pin in `apps/server/certs/tiger-ca.pem`.
The backend automatically selects it for hostnames ending in
`.tsdb.cloud.timescale.com` when the URL has no explicit `sslrootcert` setting.
An explicit CA path takes precedence; no certificate parameter is needed in the
usual Tiger Cloud connection string. See [the pin's source and fingerprint](../apps/server/certs/README.md)
for its trust-on-first-use bootstrap and replacement instructions. A different
database service may use a different CA.

For a missing or rejected password, reset the database service password through
Tiger Data's service connection panel, then run `npm run db:set-password` from
`apps/server`. Paste the new password into its hidden prompt and press Enter.
It updates `.env` and handles special-character encoding without exposing the
password in terminal output or command history. Then run `npm run db:check`.

## 4. Configure and run the backend

Open PowerShell at your cloned repo, then:

```powershell
cd apps/server
npm install
Copy-Item .env.example .env
```

Copy the example only if you do not already have a `.env`. Open `.env` in your editor and fill in the three service settings:

| Setting | Where to get it |
| --- | --- |
| `AUTH0_ISSUER_BASE_URL` | Auth0 tenant domain with `https://` and a trailing slash |
| `AUTH0_AUDIENCE` | Sword API's Identifier |
| `DATABASE_URL` | Tiger Data's PostgreSQL connection string |

Keep the defaults for `HOST`, `PORT`, and `WEB_ORIGIN` for now. Run:

```powershell
npm run db:check
npm run db:setup
npm run dev
```

The setup command creates the profile, match, sword, event, and tracking tables. It records applied migrations and can be rerun without deleting existing profiles. See [the game data guide](game-data-api.md) for the schema and two-player Postman walkthrough.

Open http://localhost:3001/health. This confirms the server is running and whether settings are present. `db:check`, not `/health`, confirms a real database connection. Restart the backend after changing `.env`.

You can also start the backend before creating accounts: leave both Auth0 values and the database URL blank. Health still works, while protected routes stay unavailable. No development authentication bypass is included.

## 5. Test login before a UI exists

Postman can complete a real Auth0 login for you:

1. Create a request to `GET http://localhost:3001/api/auth/me`.
2. In **Authorization**, select **OAuth 2.0** and **Authorization Code (With PKCE)**.
3. Select **Authorize using browser** and copy the callback URL Postman displays. Add that exact URL to **Allowed Callback URLs** for Sword Web in Auth0. Keep the localhost callback too.
4. Set the Auth URL to `https://YOUR-TENANT/authorize` and the Access Token URL to `https://YOUR-TENANT/oauth/token`.
5. Enter Sword Web's Client ID. Leave the client secret blank; use client authentication in the request body if Postman asks.
6. Select **SHA-256 / S256** for the code challenge and use scope `openid profile`.
7. In Postman's advanced authorization-request parameters, add `audience` with value `https://sword-api`.
8. Get a new token, sign up/log in through Auth0, and select **Use Token**. Do not share or publish the token.

The request should return your verified subject ID. Use the **access token**, not the ID token. Auth0's API dashboard may offer a machine-to-machine test token; that represents an application and is intentionally rejected by these player endpoints.

See [Postman's OAuth setup](https://learning.postman.com/docs/use/send-requests/authorization/oauth-20/) and [Auth0's PKCE flow](https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow-with-pkce/add-login-using-the-authorization-code-flow-with-pkce).

## 6. Save your first player profile

Reuse that token in Postman for:

```text
PUT http://localhost:3001/api/me
```

Choose a raw JSON body:

```json
{"displayName":"Nico"}
```

Then call `GET http://localhost:3001/api/me` with the same token. You should get the saved profile. Repeating PUT updates your existing profile. Only the display name is accepted; ownership always comes from the verified token.

## Quick troubleshooting

| Result | What to check |
| --- | --- |
| 503 `authentication_not_configured` | Fill in both Auth0 settings and restart |
| 401 `unauthorized` | Use a valid, unexpired access token for the exact Sword API audience |
| 403 `player_login_required` | Use interactive player login, not client credentials |
| 503 `database_not_configured` | Set `DATABASE_URL` and restart |
| 503 `service_unavailable` | Run `db:check`; confirm credentials, TLS, network, and `db:setup` |
| 404 `profile_not_found` | Create the profile with PUT first |
| 400 `invalid_profile` | Send only a nonblank `displayName`, no more than 40 characters |
| Callback URL mismatch | Copy the exact Postman callback into Auth0's allowed callbacks |

Keep `.env`, database passwords, and tokens private. The project ignore rules exclude local secret files, dependencies, and build output. Real Auth0/Tiger Data integration still needs to be tested after your accounts are configured; local automated tests use test substitutes.
