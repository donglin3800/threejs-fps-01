// Ember Yard — every sound is synthesized with WebAudio. No audio files,
// no network: short noise bursts and oscillators shaped into shots, clicks,
// steps, beeps and jingles. The context starts on the first user gesture.
export class SoundBank {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.muted = false;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.42;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  _noise(dur, freq, gain, when = 0, type = 'lowpass', q = 1) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  _tone(freq, dur, gain, type = 'sine', slideTo = 0, when = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // distance in metres: distant shots are quieter and duller.
  shot(kind, dist = 0) {
    if (!this.ctx) return;
    const att = Math.max(0.12, 1 - dist / 90);
    if (kind === 'pistol') { this._noise(0.09, 2400, 0.5 * att); this._tone(160, 0.08, 0.25 * att, 'square', 70); }
    else if (kind === 'smg') { this._noise(0.07, 3200, 0.4 * att); this._tone(200, 0.06, 0.18 * att, 'square', 90); }
    else if (kind === 'rifle') { this._noise(0.13, 1800, 0.62 * att); this._tone(130, 0.11, 0.32 * att, 'square', 55); }
    else if (kind === 'marksman') { this._noise(0.22, 1400, 0.8 * att); this._tone(100, 0.18, 0.4 * att, 'square', 45); }
    else { this._noise(0.1, 2200, 0.45 * att); }
  }

  dryFire() { this._tone(900, 0.03, 0.12, 'square'); }
  reloadStart() { this._tone(500, 0.05, 0.14, 'square', 300); }
  reloadEnd() { this._tone(700, 0.05, 0.18, 'square', 900); this._noise(0.04, 4000, 0.1); }
  step(run) { this._noise(0.05, run ? 900 : 600, run ? 0.10 : 0.06); }
  hit() { this._tone(1200, 0.05, 0.2, 'sine'); }
  headshot() { this._tone(1600, 0.07, 0.22, 'sine'); this._tone(2100, 0.06, 0.14, 'sine', 0, 0.05); }
  kill() { this._tone(660, 0.09, 0.2, 'triangle'); this._tone(990, 0.12, 0.2, 'triangle', 0, 0.08); }
  hurt() { this._tone(220, 0.12, 0.25, 'sawtooth', 110); }
  plantBeep(final) { this._tone(final ? 1400 : 950, 0.09, 0.22, 'square'); }
  defuseBeep() { this._tone(1150, 0.07, 0.18, 'square'); }
  explosion() {
    this._noise(1.1, 300, 1.0); this._noise(0.7, 90, 0.9, 0.05);
    this._tone(60, 0.9, 0.7, 'sine', 30);
  }
  grenadePin() { this._tone(1400, 0.03, 0.12, 'square'); }
  bounce() { this._tone(300, 0.04, 0.1, 'square', 180); }
  roundStart() { this._tone(523, 0.12, 0.2, 'triangle'); this._tone(784, 0.16, 0.2, 'triangle', 0, 0.12); }
  roundWin() {
    [523, 659, 784, 1046].forEach((f, i) => this._tone(f, 0.16, 0.2, 'triangle', 0, i * 0.11));
  }
  roundLose() {
    [392, 330, 262].forEach((f, i) => this._tone(f, 0.2, 0.18, 'triangle', 0, i * 0.13));
  }
  buy() { this._tone(880, 0.06, 0.16, 'sine'); this._tone(1174, 0.08, 0.16, 'sine', 0, 0.06); }
  denied() { this._tone(180, 0.12, 0.2, 'square', 140); }
  click() { this._tone(1000, 0.03, 0.1, 'sine'); }
}
