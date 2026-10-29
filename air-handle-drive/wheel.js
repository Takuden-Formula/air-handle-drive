// 骨格（MediaPipe Pose）から「見えないハンドル」の状態を読む
// ポーズのランドマーク番号: 11=左肩 12=右肩 15=左手首 16=右手首

const VIS = 0.5;  // この信頼度より低い点は「見えていない」とみなす

// lm: 正規化座標のランドマーク(33点), W/H: 画像サイズ, mirror: 画面を左右反転して表示しているか
// 戻り値: { held(運転中の判定), ready(スタート用・厳しめ), angle(度, +が右に切る), left, right, center, radius, shoulderW }
export function readWheel(lm, W, H, mirror = true) {
  if (!lm) return { held: false };
  const ok = (i) => lm[i] && (lm[i].visibility ?? 1) > VIS;
  if (!ok(11) || !ok(12) || !ok(15) || !ok(16)) return { held: false };
  const px = (i) => ({ x: (mirror ? 1 - lm[i].x : lm[i].x) * W, y: lm[i].y * H });
  let a = px(15), b = px(16);
  if (a.x > b.x) [a, b] = [b, a];          // a = 画面で左の手, b = 右の手
  const s1 = px(11), s2 = px(12);
  const shoulderW = Math.hypot(s1.x - s2.x, s1.y - s2.y);
  const shY = (s1.y + s2.y) / 2;
  const handDist = Math.hypot(b.x - a.x, b.y - a.y);
  const midY = (a.y + b.y) / 2;
  // ハンドルを握っている姿勢: 両手が肩幅の0.4〜3.5倍離れ、高さが「頭の上」〜「おなか」の間
  // （手を下ろして立っているだけの人を誤って拾わないよう、スタート用の ready は「胸の高さ」に限定）
  const spread = shoulderW > 10 && handDist > shoulderW * 0.4 && handDist < shoulderW * 3.5;
  const held = spread && midY > shY - shoulderW * 1.6 && midY < shY + shoulderW * 1.5;
  const ready = spread && midY > shY - shoulderW * 0.8 && midY < shY + shoulderW * 1.0;
  // 時計回り（右の手が下がる）を + にする
  const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  return { held, ready, angle, left: a, right: b, center: { x: (a.x + b.x) / 2, y: midY }, radius: handDist / 2, shoulderW };
}

// ハンドル角度 → ステア量 (-1〜1)。maxDeg 回すとフル、deadDeg 以内は真っすぐ
export function angleToSteer(angle, maxDeg = 45, deadDeg = 4) {
  const a = Math.abs(angle);
  if (a < deadDeg) return 0;
  return Math.sign(angle) * Math.min(1, (a - deadDeg) / (maxDeg - deadDeg));
}
