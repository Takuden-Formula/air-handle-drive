// じゃんけんロボ 景品機の設定（ピン・角度・時間はここだけ変える）
#pragma once

// ---- ピン ----
#define SERVO_PIN        18   // サーボ信号線（オレンジ/黄）
#define LED_PIN          2    // 状態LED（DevKitC は基板上の青LEDが無い品もある→外付けLEDを330Ω経由で）
#define BUTTON_PIN       4    // スタートボタン（もう片方は GND。内部プルアップ使用）

// ---- サーボ（SG90想定） ----
#define SERVO_CLOSE_DEG  10   // ゲートを閉じた角度
#define SERVO_OPEN_DEG   80   // ゲートを開いた角度
#define SERVO_OPEN_MS    450  // 開けておく時間[ms]（カプセル1個が通る時間に合わせる）
#define SERVO_MIN_US     500  // 0度のパルス幅[us]
#define SERVO_MAX_US     2400 // 180度のパルス幅[us]

// ---- 通信・その他 ----
#define BAUD             115200
#define STAT_INTERVAL_MS 2000 // 状態をシリアルに出す間隔
#define BTN_DEBOUNCE_MS  50
#define PRIZE_COOLDOWN_MS 1500 // 連続排出を防ぐ最短間隔
