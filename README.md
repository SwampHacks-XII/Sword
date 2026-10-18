# HexDuel ⚔️

**A two-player magic-sword dueling game, built at SwampHacks XII.**

Each player holds a 3D-printed sword with an ESP32 inside. You cast spells by pressing a button sequence on the sword and then moving it, and you fire the spell at your opponent with infrared. The web app turns this into a storybook adventure: a 3D digital twin of your sword follows the real one, a forest spirit named Moss narrates, and both players share the same live match.

If you don't have a sword, the keyboard stands in for one, and you can practice against **Swamp Bot** without an account or a server.

All art in the project are hand-drawn!

## How a game works

1. **Open the storybook.** Choose **I'll draw my destiny** to meet Moss and discover your evil twin.
2. **Sign in** with Auth0 and save your hero name (guests can skip straight to Swamp Bot).
3. **Pick a game:** **Create game**, **Join game** with a four-digit room code, or **Play with Swamp Bot**. You can also click **Talk to Moss** and say it out loud.
4. **Ready your sword.** On the *Wait! You need your sword!* page, connect over **Bluetooth** or **USB**, or choose **Keyboard**. Hold the sword upright and still until it says **Sword ready**.
5. **Accept the quest.** The host starts the quest, and Moss reads a short briefing (written by Gemini, with local stories as a fallback). The battle begins once both players accept.
6. **Duel.** Each cast goes like this:
   - Choose **Easy**, **Medium**, or **Hard** to get a random spell from that group, or choose **Heal**.
   - Press the spell's colored buttons in order. A wrong button restarts the sequence.
   - Make the spell's motions (for example, Up then Down).
   - The sword beeps and fires IR for up to 10 seconds. Aim at your opponent's sword.
7. **Win, then rematch.** The first player to reach 0 HP loses. Either player can choose **rematch** to return to the same room. Every round's result is saved.

### Rules

| | |
| --- | --- |
| Health | 100 HP each |
| Easy / Medium / Hard damage | 5–14 / 15–24 / 25–30 |
| Heals | 2 per battle, 10–20 HP each, 5-second cooldown |
| Spells | Nine in total (Flame, Waterdrop, Spark, Fireball, Rainfall, Thunder, Meteor, Tsunami, Lightning Bolt) |

**How hits are decided:**
- **Both players have swords:** a hit counts only when the defender's sword actually receives the IR shot.
- **Keyboard player, online:** hits are simulated.
- **Swamp Bot:** hits are simulated with a random hit chance.

The server rolls the damage and makes sure a shot can only count once. See [combat and voice](docs/combat-and-voice.md) for every spell's sequence.

### Keyboard controls

| Key | Sword equivalent |
| --- | --- |
| `1` `2` `3` `4` | Red, yellow, green, blue buttons |
| `Q` / `E` / `R` / `W` | Swing left / swing right / rotate wrist / hold upright |
| `Space` | Fire |

On a real sword: red = Easy, yellow = Medium, green = Hard, blue = Heal.

## How it fits together

```text
Sword 1 (ESP32) ──BLE/USB── Browser 1 ──┐
                                        ├── WebSocket ── Server ── Tiger Data (Postgres)
Sword 2 (ESP32) ──BLE/USB── Browser 2 ──┘                  │
         └────────── IR shots ──────────┘             Gemini, ElevenLabs
```

- **The sword** ([firmware/sword/sword.ino](firmware/sword/sword.ino)) reads its four buttons and its MPU6500 motion sensor, checks the button sequence and motions, fires and receives IR, and streams its orientation about 20 times a second.
- **The browser** connects to its own player's sword using Web Bluetooth or Web Serial (Chrome or Edge). It shows the 3D sword and arena with React Three Fiber and passes sword events on to the game.
- **The server** owns the match: spells, damage, health, heals, and cooldowns. It syncs both players over an authenticated WebSocket and stores profiles, matches, results, and sword data in Tiger Data.
- **Swamp Bot** runs entirely in the browser and uses the same rules, which are shared in [packages/protocol](packages/protocol).
- **Moss's voice** uses ElevenLabs when it's configured and falls back to the browser's built-in speech. Moss reads story pages aloud and reacts during battle ("Good hit!").

## Run it locally

You need Node.js 22.12 or newer.

**Swamp Bot only.** No accounts or server needed:

```sh
cd apps/web
npm ci
npm run dev        # http://localhost:5173
```

**Online play.** You also need an Auth0 tenant and a Tiger Data database. Follow the [backend setup guide](docs/backend-setup.md), then:

```sh
cd apps/server
npm ci
cp .env.example .env   # fill in Auth0 + DATABASE_URL
npm run db:check
npm run db:setup       # applies migrations; existing data is kept
npm run dev            # http://localhost:3001/health
```

Copy `apps/web/.env.example` to `apps/web/.env` and fill in the Auth0 values. Then start the web app as shown above. See [online play](docs/play-online.md) for a two-account test.

**Optional extras:**
- [Gemini quest stories](docs/gemini-setup.md) (`npm run gemini:check`)
- [ElevenLabs voice](docs/elevenlabs-setup.md) (`npm run voice:check`)

**Play from different networks.** [Render hosting](docs/hosting-render.md) serves the site, API, and WebSocket from one HTTPS address. On Render, Gemini runs through a [Cloud Run helper](docs/gemini-render.md).

**Real swords.** Flash `sword.ino` to each ESP32, giving one `SWORD_ID 1` and the other `SWORD_ID 2`. [The physical sword guide](docs/physical-sword.md) covers wiring, flashing, and the message protocol.

**Tests.** Run `npm test` in `apps/web` and in `apps/server`.

## Repository layout

| Folder | What's in it |
| --- | --- |
| [apps/web](apps/web) | React + Vite storybook game: menus, battle screen, 3D scene, sword connection, voice |
| [apps/server](apps/server) | Express + WebSocket server, game rules, database, Gemini and ElevenLabs integration ([README](apps/server/README.md)) |
| [packages/protocol](packages/protocol) | Shared TypeScript types, messages, spells, and rules |
| [firmware/sword](firmware/sword) | ESP32 Arduino sketch, shared by both swords |
| [deploy/gemini-relay](deploy/gemini-relay) | Cloud Run helper for Gemini on hosted builds |
| [tools](tools) | Hosted build scripts, Postman collection, Auth0 login templates |
| [docs](docs) | Setup and feature guides |

## Tech stack

| Part | Tools |
| --- | --- |
| Sword | ESP32, MPU6500 IMU, IR transmitter and receiver, Arduino C++, BLE (Nordic UART) |
| Website | React, TypeScript, Vite 7, Three.js + React Three Fiber |
| Server | Node.js, Express, WebSockets (`ws`), Zod |
| Login and data | Auth0, Tiger Data (PostgreSQL / TimescaleDB) |
| AI and voice | Gemini (quest briefings), ElevenLabs (Moss's voice), Web Speech API (voice commands and fallback voice) |
| Hosting | Render, Google Cloud Run |
