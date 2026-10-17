# Physical sword

Each sword is an ESP32 running `firmware/sword/sword.ino`. It checks the button
sequence and the motions itself, fires and receives IR, and streams its
orientation. The website mirrors every step to the game, which stays in charge
of spells, damage, and healing.

Each sword connects to **its own player's browser**, either wirelessly over
**Bluetooth** or with a **USB cable**. The messages are identical either way.
Both need **Chrome or Edge** (Bluetooth also works in Chrome on Android), and the
game must be opened at `localhost` or an `https://` address. Other browsers fall
back to the keyboard.

## Playing with the sword

1. Flash the sketch (see below). Give one sword `SWORD_ID 1` and the other `SWORD_ID 2`.
2. Power the sword (battery, or any USB power).
3. In the lobby:
   - **Bluetooth:** choose **Connect sword (Bluetooth)**, pick **Sword1** or
     **Sword2** from the list, and choose **Pair**. No Windows pairing is needed.
   - **USB cable:** close the Arduino IDE Serial Monitor first (only one program
     can use the port), choose **Connect sword (USB cable)**, and pick
     "Silicon Labs CP210x … (COMx)", not a "Bluetooth" port.
4. **Hold the sword upright and still** for a couple of seconds. That pose becomes
   "blade straight up" in the game. The panel then says **Sword ready**. Over USB
   the sword restarts first, so this takes a few seconds longer.
5. In battle:
   - **Choose:** red = Easy, yellow = Medium, green = Hard, blue = Heal.
   - **Buttons:** the game picks a random spell and sends it to the sword. Press its
     colours in order. Runes light up on screen. A wrong button restarts the sequence.
   - **Motions:** the screen shows the spell's moves (for example Up → Down). Make them.
   - **Fire:** the sword beeps and fires IR for up to 10 seconds. Aim at your
     opponent's sword. It stops when the shot lands.
6. The 3D sword follows the real one throughout the battle.

## Hits

- **Both players have swords (online):** damage happens only when the defender's
  sword receives the IR and reports it. A shot nobody receives within 10 seconds is a miss.
- **The opponent has no sword (keyboard player online):** the hit is simulated,
  as in keyboard practice.
- **Swamp Bot:** the bot has no IR, so hits are simulated with a hit chance.
  If the simulated shot misses, the website stops your sword firing.

Each sword only accepts IR from the other `SWORD_ID`, so the two swords must have
different IDs.

## Colours and keyboard

The keyboard and the sword use the same numbering:
**1 red, 2 yellow, 3 green, 4 blue**. The spell table lives in two places that
must stay in step: `SPELLS` in `packages/protocol/src/spells.ts` and `spells[]` in
the sketch, in the same order (spell ID = position + 1). A test checks they match.

## Flashing

1. Arduino IDE: install the **esp32** board package (by Espressif) and the
   **IRremote** library (by Armin Joachimsmeyer, version 4.x).
2. Open `firmware/sword/sword.ino`, select **ESP32 Dev Module** and your port, and upload.
   The sketch uses about 87% of the default app partition, mostly for Bluetooth.
3. Settings at the top: `SWORD_ID`, `USE_MOTION_SENSOR`, `ALLOW_FAKE_MOTION`,
   `PASSIVE_BUZZER`, and `STREAM_POSE` (turn it off for a quieter Serial Monitor
   while debugging gestures).

## Messages

Comma-separated lines at 115200 baud over USB, or one line per message through
the BLE Nordic UART service (`6e400001-…`; the browser writes commands to RX and
listens on TX). Over Bluetooth the browser transport is
`apps/web/src/net/bluetoothSword.ts`. The sketch asks for 128-byte packets
(`BLEDevice::setMTU`), because a `POSE` line is longer than Bluetooth's default 20 bytes. The parser is `apps/web/src/net/serialSword.ts`, and the game logic is
`apps/web/src/hooks/useSerialSword.tsx`.

| Website → sword | Meaning |
| --- | --- |
| `C,<token>,<spell 1–9>` | Start this spell (after the player chose its difficulty) |
| `H,<token>,<hp>` | Heal approved |
| `S,<token>` | Your shot landed; stop firing |
| `K` | Cancel (heal refused, spell refused, or simulated miss) |
| `N` / `G` | New battle / battle over |
| `P` | Ping (answers `PONG`) |
| `Z` | Re-zero the 3D pose: hold upright and still for 1 s |

| Sword → website (prefixed `S<id>,`) | Meaning |
| --- | --- |
| `SEL,E\|M\|H\|L` | Easy / Medium / Hard / Heal chosen |
| `STEP,<token>,<n>` / `RESET,<token>` | n buttons correct / wrong button |
| `MSTEP,<token>,<n>` | n motions done |
| `FIRE,<token>` | Motions done; firing IR with this token |
| `END,<token>,T\|H\|C` | Stopped firing: timeout, hit, cancelled |
| `HIT,<attacker id>,<token>` | This sword received the opponent's shot |
| `POSE,w,x,y,z` | Orientation, about 20 times a second |
| `READY`, `PONG`, `HEAL`, `OVER`, … | Status |

Lines without the `S<id>,` prefix (debug output) are ignored.

## Orientation

The sketch fuses the gyro and accelerometer (a Mahony filter) and reports the
rotation since it was zeroed, in the game's axes (Y up). The sensor has no
compass, so the left/right heading drifts slowly. Reconnecting re-zeroes it. If
the on-screen sword tilts the wrong way for your mounting, adjust the axis
mapping at the end of `updatePose()` in the sketch.
