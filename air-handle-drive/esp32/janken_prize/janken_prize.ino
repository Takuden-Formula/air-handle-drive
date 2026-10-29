// じゃんけんロボ 景品機（ESP32）
// PC（Chrome の index.html）から USB シリアルでコマンドを受けてサーボのゲートを開け、景品を1個出す。
//
// 受信コマンド（改行区切り）:
//   PING        → PONG
//   PRIZE       → 景品を1個出す → DONE <累計>
//   OPEN/CLOSE  → ゲートを開ける/閉める（調整用）
//   ANGLE <度>  → サーボを指定角度へ（調整用）
//   EV:START / EV:WIN / EV:LOSE / EV:DRAW → LED演出
// 送信:
//   BTN         → スタートボタンが押された
//   STAT ...    → 2秒ごとの状態
// 追加ライブラリ不要（ESP32 Arduino core 2.x / 3.x 両対応）

#include "config.h"

static const int SERVO_FREQ = 50;     // 50Hz = 20ms周期
static const int SERVO_RES  = 14;     // 14bit
static const int SERVO_CH   = 0;      // core 2.x 用 LEDC チャンネル

unsigned long prizeCount = 0;
unsigned long lastPrizeMs = 0;
unsigned long lastStatMs = 0;
int servoDeg = SERVO_CLOSE_DEG;
String rxLine;

// ---------- サーボ ----------
void servoBegin() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(SERVO_PIN, SERVO_FREQ, SERVO_RES);
#else
  ledcSetup(SERVO_CH, SERVO_FREQ, SERVO_RES);
  ledcAttachPin(SERVO_PIN, SERVO_CH);
#endif
}

void servoWrite(int deg) {
  deg = constrain(deg, 0, 180);
  servoDeg = deg;
  long us = map(deg, 0, 180, SERVO_MIN_US, SERVO_MAX_US);
  uint32_t duty = (uint32_t)((us * ((1UL << SERVO_RES) - 1)) / 20000UL);
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(SERVO_PIN, duty);
#else
  ledcWrite(SERVO_CH, duty);
#endif
}

// ---------- LED ----------
void blink(int times, int onMs, int offMs) {
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_PIN, HIGH); delay(onMs);
    digitalWrite(LED_PIN, LOW);  delay(offMs);
  }
}

// ---------- 景品排出 ----------
void dispensePrize() {
  unsigned long now = millis();
  if (now - lastPrizeMs < PRIZE_COOLDOWN_MS && lastPrizeMs != 0) {
    Serial.println("BUSY");
    return;
  }
  digitalWrite(LED_PIN, HIGH);
  servoWrite(SERVO_OPEN_DEG);
  delay(SERVO_OPEN_MS);
  servoWrite(SERVO_CLOSE_DEG);
  delay(300);
  digitalWrite(LED_PIN, LOW);
  prizeCount++;
  lastPrizeMs = millis();
  Serial.print("DONE ");
  Serial.println(prizeCount);
}

// ---------- コマンド処理 ----------
void handleCommand(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;
  if (cmd == "PING") Serial.println("PONG");
  else if (cmd == "PRIZE") dispensePrize();
  else if (cmd == "OPEN") { servoWrite(SERVO_OPEN_DEG); Serial.println("OK OPEN"); }
  else if (cmd == "CLOSE") { servoWrite(SERVO_CLOSE_DEG); Serial.println("OK CLOSE"); }
  else if (cmd.startsWith("ANGLE ")) {
    int d = cmd.substring(6).toInt();
    servoWrite(d);
    Serial.print("OK ANGLE "); Serial.println(servoDeg);
  }
  else if (cmd == "EV:START") blink(1, 300, 0);
  else if (cmd == "EV:WIN")   blink(2, 120, 80);
  else if (cmd == "EV:DRAW")  blink(1, 120, 0);
  else if (cmd == "EV:LOSE")  blink(1, 800, 0);
  else { Serial.print("? "); Serial.println(cmd); }
}

// ---------- ボタン ----------
void pollButton() {
  static int stable = HIGH, last = HIGH;
  static unsigned long changedMs = 0;
  int v = digitalRead(BUTTON_PIN);
  if (v != last) { last = v; changedMs = millis(); }
  if (millis() - changedMs > BTN_DEBOUNCE_MS && v != stable) {
    stable = v;
    if (stable == LOW) Serial.println("BTN");
  }
}

void setup() {
  Serial.begin(BAUD);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  servoBegin();
  servoWrite(SERVO_CLOSE_DEG);
  blink(3, 80, 80);
  Serial.println("READY janken_prize");
}

void loop() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') { handleCommand(rxLine); rxLine = ""; }
    else if (rxLine.length() < 64) rxLine += c;
  }
  pollButton();
  if (millis() - lastStatMs > STAT_INTERVAL_MS) {
    lastStatMs = millis();
    Serial.printf("STAT up=%lus prizes=%lu servo=%d btn=%d\n",
                  millis() / 1000, prizeCount, servoDeg, digitalRead(BUTTON_PIN));
  }
}
