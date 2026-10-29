// 景品機（ESP32）との通信：Web Serial（115200 bps、1 行 1 命令）
// 送る: PRIZE（景品を出す）/ EV:START・EV:LOSE（LED の演出）/ PING
// 受け取る: BTN（ESP32 のボタン）/ STAT…（状態。ログには出さない）
export class PrizeSerial {
  // log(msg), onLine(line), onStatus(connected), onError(msg)
  constructor({ log, onLine, onStatus, onError }) {
    this.log = log; this.onLine = onLine; this.onStatus = onStatus; this.onError = onError;
    this.port = null; this.writer = null;
  }
  get supported() { return 'serial' in navigator; }
  get connected() { return !!this.writer; }

  async open(p) {
    try {
      await p.open({ baudRate: 115200 });
      this.port = p; this.writer = p.writable.getWriter(); this.onStatus(true); this.log('景品機に接続しました');
      this._readLoop(p); setTimeout(() => this.send('PING'), 1500);
    } catch (e) { this.onError('景品機に接続できません: ' + e.message + '\n（Arduino IDE のシリアルモニタが開いていたら閉じてください）'); }
  }
  async _readLoop(p) {
    const dec = new TextDecoder(); let buf = '';
    while (p.readable) {
      const reader = p.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value); let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line) continue;
            if (!line.startsWith('STAT')) this.log('ESP32 > ' + line);
            this.onLine(line);
          }
        }
      } catch (e) { this.log('受信エラー: ' + e.message); break; } finally { reader.releaseLock(); }
    }
    this.onStatus(false); this.port = null; this.writer = null;
  }
  async send(cmd) {
    if (!this.writer) return false;
    try { await this.writer.write(new TextEncoder().encode(cmd + '\n')); this.log('ESP32 < ' + cmd); return true; }
    catch (e) { this.log('送信エラー: ' + e.message); return false; }
  }
  async request() {
    if (!this.supported) return this.onError('このブラウザは Web Serial に対応していません。Chrome か Edge で開いてください。');
    try { await this.open(await navigator.serial.requestPort()); } catch { this.log('ポート選択キャンセル'); }
  }
  async autoConnect() {
    if (!this.supported) return;
    const ports = await navigator.serial.getPorts(); if (ports.length) this.open(ports[0]);
    navigator.serial.addEventListener('connect', (e) => { if (!this.port) this.open(e.target); });
  }
}
