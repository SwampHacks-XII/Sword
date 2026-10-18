/*
  sword.ino (was SwordControllerNineSpells_MotionDebug.ino)
  SwampHacks — two-way IR sword, BLE challenge commands, nine named spells,
  physical button sequence checking and MPU6500 (WHO_AM_I=0x70) gesture detection.

  Upload this SAME sketch to both swords; change SWORD_ID (1 or 2).
  On the sword without a soldered motion sensor, set USE_MOTION_SENSOR false.
  ALLOW_FAKE_MOTION enables a browser test button until BOTH sensors work.

  Commands arrive over BLE (Nordic UART) OR the USB cable (115200 baud, one per line);
  events go out over both. The game website reads them in apps/web/src/net/serialSword.ts.

  Libraries: IRremote by Armin Joachimsmeyer; ESP32 BLE bundled with the
  Espressif ESP32 Arduino board core. No Adafruit_MPU6050 library needed.
*/

#define NO_LED_FEEDBACK_CODE
#include <Arduino.h>
#include <Wire.h>
#include <math.h>
#include <stdarg.h>
#include <IRremote.hpp>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

// --------------- CHANGE THESE SETTINGS PER SWORD ----------------
#define SWORD_ID 1                // 1 = Sword1, 2 = Sword2
#define USE_MOTION_SENSOR true    // false if MPU6500 isn't wired on this sword
#define ALLOW_FAKE_MOTION true    // TEMPORARY browser testing; set false later
#define PASSIVE_BUZZER true       // false only for an active-HIGH buzzer/driver
#define STREAM_POSE true          // send orientation for the 3D sword; false = quieter Serial Monitor
// ---------------------------------------------------------------

#if SWORD_ID != 1 && SWORD_ID != 2
#error SWORD_ID must be either 1 or 2
#endif

const uint8_t IR_SEND_PIN = 23;
const uint8_t IR_RECEIVE_PIN = 32;    // Through 10k/15k voltage divider
const uint8_t BUZZER_PIN = 4;
const uint8_t buttonPins[4] = {25, 26, 27, 33}; // BLUE,GREEN,YELLOW,RED
const uint8_t ledPins[4] = {13, 14, 18, 19};    // BLUE,GREEN,YELLOW,RED
const char buttonLetters[] = "BGYR";
const uint8_t opponentID = SWORD_ID == 1 ? 2 : 1;

const uint8_t SENSOR_ADDR = 0x68;
const uint8_t SENSOR_SDA = 21;
const uint8_t SENSOR_SCL = 22;

// First use your proven sensitivity values; tune X separately if needed.
const float UP_THRESHOLD = 0.50f;      // reduced to recognize hand-held upward swipes
const float DOWN_THRESHOLD = -0.70f;
const float RIGHT_THRESHOLD = 0.70f;
const float LEFT_THRESHOLD = -0.70f;
const float TWIST_THRESHOLD = 190.0f;  // gyro magnitude, degrees/second
const uint32_t BETWEEN_MOTIONS_MS = 500;
// No per-spell calibration delay; keep estimating gravity between gestures.
const uint32_t SENSOR_POLL_MS = 20;
const uint32_t MOTION_DEBUG_INTERVAL_MS = 500;  // print only while performing a gesture
const uint32_t FIRE_WINDOW_MS = 10000;
const uint32_t IR_INTERVAL_MS = 200;
const uint32_t HIT_LED_MS = 500;
const uint32_t HIT_DEDUP_MS = 15000;
// More stable physical-button handling for long jumper wires.
const uint32_t BUTTON_DEBOUNCE_MS = 75;
const uint32_t BUTTON_REARM_MS = 120;
const uint32_t SELECTION_RELEASE_MS = 250;

// Orientation for the 3D sword (Mahony filter). Higher KP trusts gravity more: less drift, more jitter.
const uint32_t POSE_INTERVAL_MS = 50;   // ~20 updates a second
const uint8_t POSE_ZERO_SAMPLES = 50;   // 1 s of stillness at SENSOR_POLL_MS
const float POSE_KP = 1.0f;

// NUMBER -> COLOR: 1=R, 2=Y, 3=G, 4=B
// Motions: U=up, D=down, R=right, L=left, T=twist.
// Keep in step with SPELLS in packages/protocol/src/spells.ts (spell ID = position + 1).
struct SpellDefinition {
  const char* name;
  char difficulty;
  const char* buttons;
  const char* motions;
};

const SpellDefinition spells[] = {
  {"Flame",         'E', "YYY",     "U"},
  {"Water",         'E', "RYG",     "D"},
  {"Spark",         'E', "BYB",     "R"},
  {"Fireball",      'M', "YYBRG",   "UD"},
  {"Rainfall",      'M', "RYGRY",   "DU"},
  {"Thunder",       'M', "BBYGR",   "RL"},
  {"Meteor",        'H', "YBYYGRG", "TUD"},
  {"Tsunami",       'H', "RYRGRBR", "LTR"},
  {"Lightning Bolt",'H', "RYBBGYR", "URT"}
};
const uint8_t SPELL_COUNT = sizeof(spells) / sizeof(spells[0]);

// Nordic UART Service: browser reads notifications on TX and writes on RX.
#define BLE_SERVICE_UUID "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define BLE_RX_UUID      "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define BLE_TX_UUID      "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

// Browser -> sword (BLE or USB):
//   C,<token>,<spellID>   (spell IDs 1..9: defines BOTH buttons and motions)
//   X,<token>             TEST ONLY: pretend the complete motion was correct
//   H,<token>,<hp>        server-approved heal in SELECT's WAITING stage
//   S,<token>             server-approved hit: stop firing early
//   K                     cancel current spell
//   N                     new match/reset
//   G                     game over
//   P                     ping: answers PONG
//   Z                     hold still: re-zero the 3D pose ("upright") and gyro drift
// Sword -> browser:
//   S2,SEL,E | S2,START,72,5 | S2,STEP,72,2 | S2,RESET,72
//   S2,BOK,72 | S2,MREADY,72 | S2,MSTEP,72,1 | S2,MOK,72
//   S2,FIRE,72 | S2,HIT,1,71 | S2,END,72,T | S2,READY | S2,PONG
//   S2,POSE,w,x,y,z

enum Stage : uint8_t { SELECTING, WAITING, BUTTONS, MOTION, FIRING, GAME_OVER };
Stage stage = SELECTING;
char selectedDifficulty = '-';
uint8_t spellID = 0;        // 1..9, 0 means no active spell
uint8_t attackToken = 0;    // 1..255, distinguishes consecutive attacks
uint8_t nextButtonIndex = 0;
uint8_t nextMotionIndex = 0;
const SpellDefinition* currentSpell = nullptr;

uint32_t fireStartedAt = 0;
uint32_t lastIRAt = 0;
uint32_t hitLedUntil = 0;
uint32_t lastHitAt = 0;
uint8_t lastReceivedToken = 0;
uint32_t activeBuzzerOffAt = 0;

uint8_t stableButtons = 0;
bool rawPressed[4] = {false, false, false, false};
uint32_t rawChangedAt[4] = {0, 0, 0, 0};
uint32_t nextAllowedPressAt[4] = {0, 0, 0, 0};
// Require all buttons to be released before a new selection can begin.
bool selectionArmed = false;
uint32_t allReleasedSince = 0;

bool sensorReady = false;
float baselineX = 0.0f;
float baselineY = 0.0f;
uint32_t nextSensorPollAt = 0;
uint32_t nextGestureAllowedAt = 0;
bool baselineReady = false;
uint32_t lastMotionDebugAt = 0;
float maxMotionY = -10.0f;
float minMotionY = 10.0f;
uint32_t lastMotionReadErrorAt = 0;

// Full last reading, for orientation (readSensor fills these)
float lastAccelZ = 0.0f;
float lastGyroX = 0.0f, lastGyroY = 0.0f, lastGyroZ = 0.0f;

// Orientation: q = sensor -> world, r = the "upright" pose captured while zeroing
float q0 = 1, q1 = 0, q2 = 0, q3 = 0;
float r0 = 1, r1 = 0, r2 = 0, r3 = 0;
float gyroBiasX = 0, gyroBiasY = 0, gyroBiasZ = 0;
bool poseReady = false;
uint8_t poseZeroCount = 0;          // > 0 while zeroing
float zeroSum[6];
uint32_t lastPoseSampleAt = 0;
uint32_t lastPoseSentAt = 0;

BLECharacteristic* eventTx = nullptr;
volatile bool bleConnected = false;
bool wasConnected = false;
struct BleCommand { char text[40]; };
QueueHandle_t commandQueue = nullptr;

char serialLine[40];
uint8_t serialLength = 0;

class ConnectionCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    bleConnected = true;
    Serial.println("BLE client connected");
  }
  void onDisconnect(BLEServer*) override {
    bleConnected = false;
    Serial.println("BLE client disconnected");
  }
};

class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic) override {
    String value(characteristic->getValue().c_str());
    if (!commandQueue || value.length() == 0 || value.length() >= 40) return;
    BleCommand cmd = {};
    value.toCharArray(cmd.text, sizeof(cmd.text));
    xQueueSend(commandQueue, &cmd, 0);
  }
};

void emitEvent(const char* format, ...) {
  char suffix[40];
  va_list args;
  va_start(args, format);
  vsnprintf(suffix, sizeof(suffix), format, args);
  va_end(args);
  char message[48];
  snprintf(message, sizeof(message), "S%d,%s", SWORD_ID, suffix);
  Serial.println(message);
  if (bleConnected && eventTx) {
    eventTx->setValue((uint8_t*)message, strlen(message));
    eventTx->notify();
  }
}

// Passive buzzer needs a frequency. Active buzzer needs a compatible driver.
void soundSuccess() {
  if (PASSIVE_BUZZER) {
    tone(BUZZER_PIN, 2700, 350);
  } else {
    digitalWrite(BUZZER_PIN, HIGH);
    activeBuzzerOffAt = millis() + 350;
  }
}

void cancelBuzzer() {
  if (PASSIVE_BUZZER) noTone(BUZZER_PIN);
  else digitalWrite(BUZZER_PIN, LOW);
  activeBuzzerOffAt = 0;
}

void returnToSelection() {
  stage = SELECTING;
  selectionArmed = false;
  allReleasedSince = 0;
  spellID = 0;
  attackToken = 0;
  selectedDifficulty = '-';
  currentSpell = nullptr;
  nextButtonIndex = 0;
  nextMotionIndex = 0;
  emitEvent("READY");
}

void stopFiring(char reason) {
  if (stage != FIRING) return;
  uint8_t token = attackToken;
  // Transmission is controlled by pollFiring; this instantly disables it.
  stage = SELECTING;
  emitEvent("END,%u,%c", token, reason);
  returnToSelection();
}

void beginFiring() {
  if (stage != MOTION) return;
  stage = FIRING;
  fireStartedAt = millis();
  lastIRAt = fireStartedAt - IR_INTERVAL_MS;
  emitEvent("MOK,%u", attackToken);
  emitEvent("FIRE,%u", attackToken);
  soundSuccess();
}

bool writeSensorReg(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(SENSOR_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool readSensor(float& accelX, float& accelY, float& gyroMagnitude) {
  Wire.beginTransmission(SENSOR_ADDR);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(SENSOR_ADDR, (uint8_t)14) != 14) return false;
  int16_t ax = (Wire.read() << 8) | Wire.read();
  int16_t ay = (Wire.read() << 8) | Wire.read();
  int16_t az = (Wire.read() << 8) | Wire.read();
  Wire.read(); Wire.read(); // temperature
  int16_t gx = (Wire.read() << 8) | Wire.read();
  int16_t gy = (Wire.read() << 8) | Wire.read();
  int16_t gz = (Wire.read() << 8) | Wire.read();
  accelX = ax / 16384.0f;  // +/- 2 g
  accelY = ay / 16384.0f;
  lastAccelZ = az / 16384.0f;
  float x = gx / 131.0f;   // +/- 250 degrees/sec
  float y = gy / 131.0f;
  float z = gz / 131.0f;
  lastGyroX = x; lastGyroY = y; lastGyroZ = z;
  gyroMagnitude = sqrtf(x*x + y*y + z*z);
  return true;
}

void initializeSensor() {
  if (!USE_MOTION_SENSOR) {
    Serial.println("MPU sensor disabled on this sword (test simulation available)");
    return;
  }
  Wire.begin(SENSOR_SDA, SENSOR_SCL);
  Wire.setTimeOut(30);
  delay(100);
  Wire.beginTransmission(SENSOR_ADDR);
  Wire.write(0x75); // WHO_AM_I
  if (Wire.endTransmission(false) != 0 || Wire.requestFrom(SENSOR_ADDR, (uint8_t)1) != 1) {
    Serial.println("MPU sensor NOT FOUND. Check SDA=21, SCL=22, 3V3, GND");
    return;
  }
  uint8_t who = Wire.read();
  Serial.printf("Motion sensor ID: 0x%02X\n", who);
  // 0x70 = user's verified MPU6500-compatible sensor.
  if (who != 0x70 && who != 0x68) {
    Serial.println("Unexpected WHO_AM_I; check module before testing motion");
    return;
  }
  sensorReady = writeSensorReg(0x6B, 0x00) && // wake up
                writeSensorReg(0x1C, 0x00) && // accel +/-2g
                writeSensorReg(0x1B, 0x00) && // gyro +/-250 deg/s
                writeSensorReg(0x1A, 0x03);   // low-pass filter
  Serial.println(sensorReady ? "Motion sensor READY" : "Motion sensor initialization failed");
}

// ---- Orientation for the 3D sword ------------------------------------------

// Hold still for 1 s: measure gyro drift, and remember this pose as "blade upright"
void startPoseZero() {
  poseZeroCount = 1;
  for (int i = 0; i < 6; i++) zeroSum[i] = 0;
}

void finishPoseZero() {
  const float n = POSE_ZERO_SAMPLES;
  gyroBiasX = zeroSum[3] / n; gyroBiasY = zeroSum[4] / n; gyroBiasZ = zeroSum[5] / n;
  // Start from gravity alone (heading 0)
  float ax = zeroSum[0] / n, ay = zeroSum[1] / n, az = zeroSum[2] / n;
  float roll = atan2f(ay, az);
  float pitch = atan2f(-ax, sqrtf(ay * ay + az * az));
  float cr = cosf(roll / 2), sr = sinf(roll / 2);
  float cp = cosf(pitch / 2), sp = sinf(pitch / 2);
  q0 = cr * cp; q1 = sr * cp; q2 = cr * sp; q3 = -sr * sp;
  r0 = q0; r1 = q1; r2 = q2; r3 = q3;
  poseZeroCount = 0;
  poseReady = true;
  Serial.println("Pose zeroed (this is 'upright' in the game)");
}

// One Mahony step: integrate the gyro, nudged toward gravity when the sword isn't swinging
void updateOrientation(float ax, float ay, float az, float gx, float gy, float gz, float dt) {
  const float toRad = 0.01745329f;
  gx = (gx - gyroBiasX) * toRad;
  gy = (gy - gyroBiasY) * toRad;
  gz = (gz - gyroBiasZ) * toRad;

  float norm = sqrtf(ax * ax + ay * ay + az * az);
  if (norm > 0.8f && norm < 1.2f) {
    ax /= norm; ay /= norm; az /= norm;
    // Where the filter thinks gravity points, in sensor axes
    float vx = 2 * (q1 * q3 - q0 * q2);
    float vy = 2 * (q0 * q1 + q2 * q3);
    float vz = q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3;
    gx += POSE_KP * (ay * vz - az * vy);
    gy += POSE_KP * (az * vx - ax * vz);
    gz += POSE_KP * (ax * vy - ay * vx);
  }

  gx *= 0.5f * dt; gy *= 0.5f * dt; gz *= 0.5f * dt;
  float a = q0, b = q1, c = q2;
  q0 += -b * gx - c * gy - q3 * gz;
  q1 += a * gx + c * gz - q3 * gy;
  q2 += a * gy - b * gz + q3 * gx;
  q3 += a * gz + b * gy - c * gx;

  norm = sqrtf(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3);
  q0 /= norm; q1 /= norm; q2 /= norm; q3 /= norm;
}

void updatePose(float ax, float ay, uint32_t now) {
  float dt = lastPoseSampleAt ? (now - lastPoseSampleAt) / 1000.0f : SENSOR_POLL_MS / 1000.0f;
  lastPoseSampleAt = now;

  if (poseZeroCount > 0) {
    float sample[6] = {ax, ay, lastAccelZ, lastGyroX, lastGyroY, lastGyroZ};
    for (int i = 0; i < 6; i++) zeroSum[i] += sample[i];
    if (++poseZeroCount > POSE_ZERO_SAMPLES) finishPoseZero();
    return;
  }
  if (!poseReady) return;
  updateOrientation(ax, ay, lastAccelZ, lastGyroX, lastGyroY, lastGyroZ, dt);

  if (!STREAM_POSE || now - lastPoseSentAt < POSE_INTERVAL_MS) return;
  lastPoseSentAt = now;
  // Rotation since zeroing (q * conjugate(r)), turned into the game's axes:
  // sensor world is Z-up, the game is Y-up. If the 3D sword tilts the wrong way, adjust here.
  float w = q0 * r0 + q1 * r1 + q2 * r2 + q3 * r3;
  float x = -q0 * r1 + q1 * r0 - q2 * r3 + q3 * r2;
  float y = -q0 * r2 + q1 * r3 + q2 * r0 - q3 * r1;
  float z = -q0 * r3 - q1 * r2 + q2 * r1 + q3 * r0;
  emitEvent("POSE,%.4f,%.4f,%.4f,%.4f", w, x, z, -y);
}

// ---- Gestures ---------------------------------------------------------------

void startMotion() {
  stage = MOTION;
  nextMotionIndex = 0;
  // The continuously updated baseline is already available. Do NOT
  // discard it, recalibrate, or pause after completing the buttons.
  nextGestureAllowedAt = millis();
  lastMotionDebugAt = 0;
  maxMotionY = -10.0f;
  minMotionY = 10.0f;
  Serial.printf("MPU for this gesture: %s\n", sensorReady ? "READY" : "NOT READY");
  if (!sensorReady) Serial.println("CHECK: motion sensor did not initialize. Verify USE_MOTION_SENSOR=true and see boot messages.");
  emitEvent("BOK,%u", attackToken);
  emitEvent("MREADY,%u", attackToken);
  Serial.printf("Gesture: %s (0.5s gap between steps)\n", currentSpell->motions);
  Serial.println("Motion ready NOW; perform gesture!");
  if (!sensorReady) Serial.println("No MPU ready; use browser TEST motion button");
}

bool stepDetected(char movement, float deltaX, float deltaY, float rotation) {
  switch (movement) {
    case 'U': return deltaY > UP_THRESHOLD;
    case 'D': return deltaY < DOWN_THRESHOLD;
    case 'R': return deltaX > RIGHT_THRESHOLD;
    case 'L': return deltaX < LEFT_THRESHOLD;
    case 'T': return rotation > TWIST_THRESHOLD;
    default:  return false;
  }
}

void pollMotion() {
  // Always poll while the ESP32 is running, not just during the motion stage.
  // This keeps the gravity/resting-position estimate fresh in normal gameplay.
  uint32_t now = millis();
  if (!sensorReady) {
    if (stage == MOTION && now - lastMotionReadErrorAt >= 2000) {
      lastMotionReadErrorAt = now;
      Serial.println("MOTION DEBUG: SENSOR NOT READY -- no gesture can be recognized");
    }
    return;
  }
  if (now - nextSensorPollAt < SENSOR_POLL_MS) return;
  nextSensorPollAt = now;

  float ax, ay, gyro;
  if (!readSensor(ax, ay, gyro)) {
    if (stage == MOTION && now - lastMotionReadErrorAt >= 2000) {
      lastMotionReadErrorAt = now;
      Serial.println("MOTION DEBUG: I2C sensor read failed. Check MPU wiring/connectors.");
    }
    return;
  }
  updatePose(ax, ay, now);

  if (!baselineReady) {
    baselineX = ax;
    baselineY = ay;
    baselineReady = true;
  }

  // Exponential low-pass baseline to filter out gravity and gradual tilting.
  // In idle/buttons mode, quickly follow the player's holding orientation.
  // During gestures, freeze most baseline drift so rapid swipes stand out.
  // During the normal 0.5-second interval between motions, catch up again.
  bool inGesture = stage == MOTION &&
                   (int32_t)(now - nextGestureAllowedAt) >= 0;
  const float alpha = inGesture ? 0.005f : 0.12f;
  float dx = ax - baselineX;
  float dy = ay - baselineY;
  baselineX += alpha * dx;
  baselineY += alpha * dy;

  if (stage != MOTION || !currentSpell) return;
  if ((int32_t)(now - nextGestureAllowedAt) < 0) return;

  char expected = currentSpell->motions[nextMotionIndex];
  if (expected == '\0') return;
  float motionX = ax - baselineX;
  float motionY = ay - baselineY;
  if (motionY > maxMotionY) maxMotionY = motionY;
  if (motionY < minMotionY) minMotionY = motionY;

  // Report actual movement levels without flooding Serial Monitor.
  // Peak values matter because a quick swipe may happen between prints.
  if (now - lastMotionDebugAt >= MOTION_DEBUG_INTERVAL_MS) {
    lastMotionDebugAt = now;
    Serial.printf("MOTION DEBUG: expect %c | dY=%+.2f g | peakY=%+.2f g | lowY=%+.2f g | dX=%+.2f g | gyro=%.1f deg/s\n",
                  expected, motionY, maxMotionY, minMotionY, motionX, gyro);
    maxMotionY = -10.0f;
    minMotionY = 10.0f;
  }
  if (!stepDetected(expected, motionX, motionY, gyro)) return;

  nextMotionIndex++;
  emitEvent("MSTEP,%u,%u", attackToken, nextMotionIndex);
  Serial.printf("Movement %c detected (%u/%u)\n", expected,
                nextMotionIndex, (unsigned)strlen(currentSpell->motions));
  if (currentSpell->motions[nextMotionIndex] == '\0') {
    Serial.println("MOTION CORRECT! SPELL READY!");
    beginFiring();
  } else {
    nextGestureAllowedAt = now + BETWEEN_MOTIONS_MS;
    Serial.printf("Wait 0.5s, then move %c\n", currentSpell->motions[nextMotionIndex]);
  }
}

// ---- Commands ---------------------------------------------------------------

void parseCommand(char* cmd) {
  Serial.print("CMD <- ");
  Serial.println(cmd);
  if (strcmp(cmd, "P") == 0) { emitEvent("PONG"); return; }
  if (strcmp(cmd, "Z") == 0) { if (sensorReady) startPoseZero(); return; }
  if (strcmp(cmd, "N") == 0) { returnToSelection(); return; }
  if (strcmp(cmd, "K") == 0) {
    if (stage == FIRING) stopFiring('C');
    else if (stage != GAME_OVER) returnToSelection();
    return;
  }
  if (strcmp(cmd, "G") == 0) {
    stage = GAME_OVER;
    cancelBuzzer();
    emitEvent("OVER");
    return;
  }

  unsigned token = 0, id = 0, amount = 0;
  char extra = 0;
  if (cmd[0] == 'C' && sscanf(cmd, "C,%u,%u%c", &token, &id, &extra) == 2) {
    if (stage != WAITING || token < 1 || token > 255 || id < 1 || id > SPELL_COUNT) return;
    const SpellDefinition* chosen = &spells[id-1];
    if (chosen->difficulty != selectedDifficulty) return;
    attackToken = (uint8_t)token;
    spellID = (uint8_t)id;
    currentSpell = chosen;
    nextButtonIndex = 0;
    stage = BUTTONS;
    emitEvent("START,%u,%u", attackToken, spellID);
    Serial.printf("Spell: %s | Buttons: %s | Motion: %s\n",
                  chosen->name, chosen->buttons, chosen->motions);
    return;
  }
  if (cmd[0] == 'X' && sscanf(cmd, "X,%u%c", &token, &extra) == 1) {
    if (ALLOW_FAKE_MOTION && stage == MOTION && attackToken == token) {
      Serial.println("TEST: simulated completed gesture");
      beginFiring();
    }
    return;
  }
  if (cmd[0] == 'S' && sscanf(cmd, "S,%u%c", &token, &extra) == 1) {
    if (stage == FIRING && attackToken == token) stopFiring('H');
    return;
  }
  if (cmd[0] == 'H' && sscanf(cmd, "H,%u,%u%c", &token, &amount, &extra) == 2) {
    if (stage == WAITING && selectedDifficulty == 'L' &&
        token >= 1 && token <= 255 && amount <= 100) {
      soundSuccess();
      emitEvent("HEAL,%u,%u", token, amount);
      returnToSelection();
    }
    return;
  }
  emitEvent("BAD_CMD");
}

// The same commands over the USB cable, one per line
void readSerialCommands() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialLength > 0) {
        serialLine[serialLength] = '\0';
        parseCommand(serialLine);
        serialLength = 0;
      }
    } else if (serialLength < sizeof(serialLine) - 1) {
      serialLine[serialLength++] = c;
    }
  }
}

// ---- Buttons, IR, outputs ---------------------------------------------------

void handleButton(uint8_t index) {
  if (stage == SELECTING) {
    // BLUE = heal, GREEN = hard, YELLOW = medium, RED = easy
    const char selection[4] = {'L','H','M','E'};
    selectedDifficulty = selection[index];
    stage = WAITING;
    emitEvent("SEL,%c", selectedDifficulty);
    return;
  }
  if (stage != BUTTONS || !currentSpell) return;
  char expected = currentSpell->buttons[nextButtonIndex];
  char actual = buttonLetters[index];
  if (actual == expected) {
    nextButtonIndex++;
    emitEvent("STEP,%u,%u", attackToken, nextButtonIndex);
    if (currentSpell->buttons[nextButtonIndex] == '\0') startMotion();
  } else {
    nextButtonIndex = 0;
    emitEvent("RESET,%u", attackToken);
  }
}

void pollButtons() {
  uint32_t now = millis();
  uint8_t pressedEvents = 0;
  bool anyRawPressed = false;
  for (uint8_t i = 0; i < 4; ++i) {
    const bool pressed = (digitalRead(buttonPins[i]) == LOW);
    if (pressed) anyRawPressed = true;
    if (pressed != rawPressed[i]) {
      rawPressed[i] = pressed;
      rawChangedAt[i] = now;
    }
    const bool wasStablePressed = (stableButtons & (1U << i)) != 0;
    if (pressed != wasStablePressed &&
        now - rawChangedAt[i] >= BUTTON_DEBOUNCE_MS) {
      if (pressed) {
        stableButtons |= (1U << i);
        Serial.printf("PHYSICAL INPUT: %c PRESSED (GPIO %u, stage %u)\n",
                      buttonLetters[i], buttonPins[i], (unsigned)stage);
        if ((int32_t)(now - nextAllowedPressAt[i]) >= 0)
          pressedEvents |= (1U << i);
      } else {
        stableButtons &= ~(1U << i);
        nextAllowedPressAt[i] = now + BUTTON_REARM_MS;
        Serial.printf("PHYSICAL INPUT: %c RELEASED (GPIO %u)\n",
                      buttonLetters[i], buttonPins[i]);
      }
    }
  }

  // On boot and after cancelling a spell, let go of every button for 250 ms.
  // This avoids a held button immediately starting an unintended new spell.
  if (stage == SELECTING && !selectionArmed) {
    if (stableButtons == 0 && !anyRawPressed) {
      if (allReleasedSince == 0) allReleasedSince = now;
      if (now - allReleasedSince >= SELECTION_RELEASE_MS) {
        selectionArmed = true;
        Serial.println("Selection armed. Press RED=Easy / YELLOW=Medium / GREEN=Hard / BLUE=Heal.");
      }
    } else {
      allReleasedSince = 0;
    }
  }
  for (uint8_t i = 0; i < 4; ++i) {
    if (!(pressedEvents & (1U << i))) continue;
    if (stage == SELECTING && !selectionArmed) {
      Serial.println("Button ignored: waiting for all buttons to be released.");
      continue;
    }
    handleButton(i);
  }
}

void pollIR() {
  if (!IrReceiver.decode()) return;
  uint32_t now = millis();
  if (IrReceiver.decodedIRData.protocol == NEC &&
      IrReceiver.decodedIRData.address == opponentID &&
      !(IrReceiver.decodedIRData.flags & IRDATA_FLAGS_IS_REPEAT)) {
    uint8_t incomingToken = IrReceiver.decodedIRData.command;
    if (incomingToken != 0 &&
        (incomingToken != lastReceivedToken || now-lastHitAt > HIT_DEDUP_MS)) {
      lastReceivedToken=incomingToken;
      lastHitAt=now;
      hitLedUntil=now+HIT_LED_MS;
      // Defender's own button/gesture progress is not changed.
      emitEvent("HIT,%u,%u", opponentID, incomingToken);
    }
  }
  IrReceiver.resume();
}

void pollFiring() {
  if (stage != FIRING) return;
  uint32_t now = millis();
  if (now-fireStartedAt >= FIRE_WINDOW_MS) { stopFiring('T'); return; }
  if (now-lastIRAt >= IR_INTERVAL_MS) {
    lastIRAt=now;
    IrSender.sendNEC(SWORD_ID, attackToken, 0);
    IrReceiver.restartAfterSend();
  }
}

void updateOutputs() {
  uint32_t now = millis();
  if (!PASSIVE_BUZZER && activeBuzzerOffAt && (int32_t)(now-activeBuzzerOffAt)>=0) {
    digitalWrite(BUZZER_PIN, LOW);
    activeBuzzerOffAt=0;
  }
  for (int i=0;i<4;i++) {
    bool buttonHeld=(stableButtons&(1U<<i))!=0;
    bool receivedHit=i==3 && (int32_t)(hitLedUntil-now)>0;
    digitalWrite(ledPins[i], buttonHeld || receivedHit);
  }
}

void setup() {
  Serial.begin(115200);
  for (int i=0;i<4;i++) {
    pinMode(buttonPins[i], INPUT_PULLUP);
    pinMode(ledPins[i], OUTPUT);
    digitalWrite(ledPins[i], LOW);
  }
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  initializeSensor();
  if (sensorReady) startPoseZero();
  IrSender.begin(IR_SEND_PIN);
  IrReceiver.begin(IR_RECEIVE_PIN);

  commandQueue=xQueueCreate(8,sizeof(BleCommand));
  char name[16];
  snprintf(name,sizeof(name),"Sword%d",SWORD_ID);
  BLEDevice::init(name);
  // Default BLE packets carry only 20 bytes; POSE lines are ~36. Let the browser negotiate bigger ones.
  BLEDevice::setMTU(128);
  BLEServer* server=BLEDevice::createServer();
  server->setCallbacks(new ConnectionCallbacks());
  BLEService* service=server->createService(BLE_SERVICE_UUID);
  eventTx=service->createCharacteristic(BLE_TX_UUID,BLECharacteristic::PROPERTY_NOTIFY);
  eventTx->addDescriptor(new BLE2902());
  BLECharacteristic* commandRx=service->createCharacteristic(
      BLE_RX_UUID,BLECharacteristic::PROPERTY_WRITE|BLECharacteristic::PROPERTY_WRITE_NR);
  commandRx->setCallbacks(new CommandCallbacks());
  service->start();
  BLEAdvertising* advertising=BLEDevice::getAdvertising();
  advertising->addServiceUUID(BLE_SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();

  Serial.printf("Sword %d ready; BLE advertising as %s; USB commands accepted\n",SWORD_ID,name);
  Serial.println("Red=Easy, Yellow=Medium, Green=Hard, Blue=Heal");
  Serial.println("BUTTON DEBUG ON. Watch for PHYSICAL INPUT messages while hands-off.");
  Serial.printf("MPU enabled: %s | Fake motion allowed: %s\n",
    USE_MOTION_SENSOR?"YES":"NO",ALLOW_FAKE_MOTION?"YES":"NO");
}

void loop() {
  if (!bleConnected && wasConnected) {
    delay(30);
    BLEDevice::startAdvertising();
    wasConnected=false;
  } else if (bleConnected && !wasConnected) {
    wasConnected=true;
    emitEvent("READY");
  }
  BleCommand cmd;
  while (commandQueue && xQueueReceive(commandQueue,&cmd,0)==pdTRUE) {
    parseCommand(cmd.text);
  }
  readSerialCommands();
  pollIR();
  pollButtons();
  pollMotion();
  pollFiring();
  updateOutputs();
  delay(2);
}
