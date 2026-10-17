# Sword ⚔️

**A two-player magic-sword game for SwampHacks XII.**

Two physical swords, two laptops, and one shared game. Each sword contains an ESP32, buttons, a motion sensor, and infrared (IR) hardware. The website shows the game and a moving 3D version of each sword.

## Start here

The backend now supports **player profiles, two-player sessions, and sword/camera data storage**. You can test these before building the website or connecting the hardware.

1. **Create Auth0 and Tiger Data accounts.** Follow [the setup guide](docs/backend-setup.md) for the exact dashboard settings and connection steps.
2. **Configure the backend.** From `apps/server`, install dependencies and copy `.env.example` to a private `.env`. Fill in the Auth0 tenant URL, API audience, and Tiger Data connection string.
3. **Set up the database tables.** Run `npm run db:check`, then `npm run db:setup` from `apps/server`. Existing profiles are preserved.
4. **Start the backend.** Run `npm run dev`, then open http://localhost:3001/health.
5. **Try a two-player session.** Follow [the game data guide](docs/game-data-api.md) and import `tools/sword-api.postman_collection.json` into Postman. It includes profiles, match creation/joining, sword assignment, and sample uploads for both players.

The backend can start without account settings, but protected routes stay unavailable. See [the backend README](apps/server/README.md) for endpoints and verified commands.

**Play online or with Swamp Bot.** From `apps/web`, run `npm ci`, then `npm run dev`, and open http://localhost:5173. Choose **I’ll draw my destiny** to meet Moss and discover your evil twin. Then sign in through Auth0 and select **Create game**, **Join game**, or **Play with Swamp Bot**. Friends join the same **four-digit room code**. In the lobby, the host chooses **Start my quest**; both players read the story briefing and choose **Accept my quest** before battle begins. Guests can choose Swamp Bot practice from the login page. Online mode also needs `apps/server` running. Follow [the online play guide](docs/play-online.md) for environment settings and a two-account test.

**Play from different networks.** [Optional Render hosting](docs/hosting-render.md) serves the website and backend at one public HTTPS address. Your existing local setup stays available. Both players open the hosted address; neither needs to run a server on their laptop. Internet access is required, but the players do not need the same Wi-Fi.

**Play again together.** After a battle, either player can choose **rematch** to return both players to the same lobby and room code. The host starts the next battle. Each completed round's result is kept in the database.

Spell combat uses the same rules in both modes.

Choose **Easy**, **Medium**, or **Hard** before each spell to receive a random
spell from that group. Damage ranges are **5–14**, **15–24**, and **25–30**.
Each player also gets **two 10–20 HP heals per battle**, with a **five-second
cooldown** between uses. See [combat and voice](docs/combat-and-voice.md) for all
nine sequences, controls, and testing.

Moss speaks automatically on story pages after you enter the prologue. Use
**Mute Moss** to silence playback while narration keeps moving; unmuting
returns at the current point. Choosing the next page stops its audio immediately.
Playback is slightly faster while preserving the ElevenLabs
voice’s pitch. In battle, Moss has
spoken reactions such as “Good hit!” and “That one missed!”, controlled by a
voice on/off button. **ElevenLabs is the main voice** when configured,
including the prologue and guest games; the lighter browser voice takes over
when credits run out or playback is unavailable. The browser backup has no speech
API charge. Follow [ElevenLabs setup](docs/elevenlabs-setup.md).

During either mode, the keyboard stands in for your sword:

- `1`–`4`: the red, blue, green and yellow buttons
- `Q`, `E`, `R`, `W`: swing left, swing right, rotate wrist, hold upright
- `Space`: the trigger

The interface uses a pastel pixel meadow, parchment scrolls, and Moss, the green NPC story guide. **Gemini can write Moss’s short quest briefing for each round**, shared by both players, with a different story on rematch and a quick local fallback. Follow [the Gemini setup guide](docs/gemini-setup.md) to enable and test it. See [the storyline guide](docs/storyline-ui.md) to edit the scenes, and [Auth0 appearance](docs/auth0-appearance.md) to match the hosted login screen to the game. The 3D fighters and swords are still placeholders. To use a real 3D model, put a `.glb` in `apps/web/public/models` and set its path in `apps/web/src/scene/models.ts`.

Online battles use an authenticated WebSocket connection and server-owned spell/health state. The browser bot and online backend share messages and rules in `packages/protocol`. Physical sword connections, real IR reception, and camera capture still need to be built. Online keyboard practice simulates successful attack hits.

## The game we're building

1. **Remember** the spell sequence shown on your laptop.
2. **Enter** the sequence using the buttons on your sword.
3. **Move and aim** your sword to cast the spell. The exact gesture and firing controls are still to be decided.
4. **Land a hit:** the opponent's IR receiver detects the attack, and the server checks it before updating the game.

Both laptops should see the same match state. We'll 3D print two swords to hold the electronics.

## Find your folder

Everything lives in one repository, with separate folders for each part of the project.

```text
Sword/
├── README.md
├── apps/
│   ├── web/
│   │   ├── public/models/
│   │   └── src/
│   │       ├── components/
│   │       └── hooks/
│   └── server/
│       └── src/
├── packages/
│   └── protocol/
│       └── src/
├── firmware/
│   ├── include/
│   └── src/
├── hardware/
│   ├── cad/
│   ├── prints/
│   └── electronics/
├── docs/
├── tools/
└── .github/
    └── workflows/
```

| If you're working on… | Put it in… | Examples |
| --- | --- | --- |
| What players see | `apps/web` | Spell sequence, health bar, menus, 3D sword viewer |
| Rules and multiplayer | `apps/server` | Validate spells, track health, update both laptops |
| Messages between the parts | `packages/protocol` | Movement updates, button presses, player IDs, hit reports |
| Code running on the ESP32 | `firmware` | Read sensors/buttons, connect to Wi-Fi, send/receive IR |
| The physical swords | `hardware` | CAD models, print exports, wiring diagrams |
| Guides and team decisions | `docs` | Setup, calibration, connection format, design notes |
| Development helpers | `tools` | Fake sword data, sensor logs, calibration utilities |
| Automated GitHub checks | `.github/workflows` | Build and type checks once the projects exist |

### Inside the website

| Folder | What belongs here |
| --- | --- |
| `apps/web/src/components` | Reusable screen elements: spell display, health bar, player panel, sword viewer |
| `apps/web/src/hooks` | Reusable React logic, such as connecting to the server and receiving updates |
| `apps/web/public/models` | 3D models for the browser, preferably `.glb` files |

### Inside firmware and hardware

| Folder | What belongs here |
| --- | --- |
| `firmware/include` | C++ header files: declarations, hardware interfaces, configuration structure |
| `firmware/src` | C++ implementation: sensors, buttons, Wi-Fi, IR, and optional LEDs |
| `hardware/cad` | Editable sword and enclosure design files |
| `hardware/prints` | Printable `.stl` / `.3mf` exports and print settings |
| `hardware/electronics` | Parts list, pin assignments, schematics, wiring photos, power details |

**Browser model → `apps/web/public/models`. Printable sword → `hardware/prints`. Editable design → `hardware/cad`.**

## How it connects

**Voice commands:** on game selection, click **Talk to Moss** to create a game,
join a four-digit room, or play with Swamp Bot by speaking. Moss acknowledges
commands using the existing voice. See [voice commands](docs/voice-commands.md)
for browser support, microphone permissions, and a quick test.

```text
Sword 1 / ESP32 ──┐                  ┌── Laptop 1 website
                  ├── Shared server ─┤
Sword 2 / ESP32 ──┘                  └── Laptop 2 website
```

The swords send readings over Wi-Fi. The server coordinates the match and sends updates to both browsers. One laptop can run the shared server.

- **Firmware reads the hardware.** It reports movement, button presses, and received IR attacks.
- **The server decides what happens.** It checks spells and hits, prevents duplicate damage, and keeps the match state consistent.
- **The website shows the result.** It displays the spell sequence, sword movement, health, and score.

When another laptop or ESP32 connects, use the server laptop's local network address. `localhost` means the device you're currently using.

## Suggested team split

| Teammate | Main folders | First goal |
| --- | --- | --- |
| Software 1 | `apps/web` | Build player login and character screens; add live movement when hardware is ready |
| Software 2 | `apps/server`, `packages/protocol`, `tools` | Verify player identity and save profiles in Tiger Data |
| Hardware 1 | `firmware`, `hardware/electronics` | Send button presses and real motion readings over Wi-Fi |
| Hardware 2 | `hardware/cad`, `hardware/prints`, IR firmware | Test enclosure fit and IR transmission/reception |

Agree together on wiring, sensor mounting, message formats, and how an IR shot identifies its sender. Keep shared decisions in `docs`.

## Proposed tools

The website supports Auth0 login, online room codes, and local Swamp Bot games. The backend runs shared online battles and stores profiles, sessions, winners, sword readings, and camera tracking in Tiger Data. Hardware capture remains planned.

Signed-in players choose **Save name** on the hero page to store their name with their account. Returning players see their saved name and an **Edit** button. Edit opens the name field again; **Save name** keeps the change, while **Cancel** restores the previous name. Save or cancel an edit before entering a game. Guest names stay local to the current visit.

| Part | Tools |
| --- | --- |
| Website | React + TypeScript + Vite 7 (Vite 8 hits an npm 10.8 install bug) |
| 3D viewer | Three.js + React Three Fiber |
| Server | Node.js + TypeScript + Express + WebSockets |
| Player login | Auth0 |
| Database | Tiger Data / PostgreSQL |
| Dialogue and story (planned) | Gemini API |
| Shared messages | TypeScript + Zod for checking incoming data |
| ESP32 | PlatformIO + Arduino framework + C++ |
| Physical design | Team-selected CAD software |

## Keep these in mind

- **Start with rotation.** A motion sensor does not directly give reliable absolute position. Calibrate it and agree which sensor directions match the 3D model.
- **Use one message format.** The website and server can share TypeScript definitions. The C++ firmware must send the same format, including agreed units and IDs.
- **Give each sword its own identity.** Both can use the same firmware project with different device/player settings.
- **Separate live updates from recordings.** WebSockets deliver live game updates. Tiger Data stores profiles, session state, events, and timestamped recordings; avoid writing every animation frame to the database.
- **Keep secrets local.** Don't commit Wi-Fi passwords, database credentials, or tokens. Ignore rules exclude local environment files, dependency folders, and build output.

## Git basics

Git tracks files, so **empty folders won't appear on GitHub or in a fresh clone** until they contain tracked files. We can add real project files as we build, or use `.gitkeep` placeholders later if needed.

To commit only this README when ready:

```sh
git status
git add README.md
git commit -m "Document project layout and next steps"
```

Review `git status` before committing. Local environment files, dependencies, and caches are ignored; commit the example configuration and lockfile.

