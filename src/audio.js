// A tiny procedural soundscape: wind, wingbeats, chimes and a sparse
// pentatonic score. No audio files, everything is synthesized on the fly.

const PENTATONIC = [293.66, 349.23, 392.0, 440.0, 523.25, 587.33, 698.46, 783.99];

export class Soundscape {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.muted = false;
    this.master = null;
    this.windGain = null;
    this.windHigh = null;
    this.speed = 30;
    this.lastWindUpdate = 0;
    this.timer = null;
    this.chirpTimer = null;
  }

  start() {
    if (this.started) {
      this.ctx?.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.started = true;
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);

    // a soft shared echo
    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = 0.42;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.28;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.22;
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delay.connect(this.wet);
    this.wet.connect(this.master);

    // wind bed
    const noiseBuf = this._noiseBuffer(5);
    this.noiseBuffer = noiseBuf;
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuf;
    wind.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.5;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.055;
    wind.connect(bp).connect(this.windGain).connect(this.master);
    wind.start();

    const wind2 = ctx.createBufferSource();
    wind2.buffer = noiseBuf;
    wind2.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    this.windHigh = ctx.createGain();
    this.windHigh.gain.value = 0.02;
    wind2.connect(lp).connect(this.windHigh).connect(this.master);
    wind2.start();

    this._scheduleMusic();
    this.timer = setInterval(() => this._scheduleMusic(), 5200);
    this.chirpTimer = setInterval(() => this._chirp(), 12000 + Math.random() * 9000);
  }

  _noiseBuffer(seconds) {
    const ctx = this.ctx;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.94 + white * 0.06;
      data[i] = last * 2.2;
    }
    return buffer;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.15);
    }
  }

  setSpeed(speed) {
    if (!this.started || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastWindUpdate < 0.12) return;
    this.lastWindUpdate = now;
    const t = Math.min(1, Math.max(0, (speed - 12) / 60));
    this.windGain.gain.setTargetAtTime(0.035 + t * 0.12, now, 0.4);
    this.windHigh.gain.setTargetAtTime(0.012 + t * 0.055, now, 0.35);
  }

  flap() {
    if (!this.started || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.9;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(380, now);
    bp.frequency.exponentialRampToValueAtTime(900, now + 0.16);
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.16, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    src.connect(bp).connect(g).connect(this.master);
    src.start(now, Math.random() * 2, 0.4);
  }

  collect(index = 0) {
    if (!this.started || this.muted) return;
    const base = PENTATONIC[(index + 2) % PENTATONIC.length];
    const notes = [base, base * 1.5, base * 2];
    notes.forEach((f, i) => this._bell(f, 0.1, 0.55, i * 0.11, this.ctx.currentTime));
  }

  complete() {
    if (!this.started || this.muted) return;
    const now = this.ctx.currentTime;
    [293.66, 369.99, 440, 587.33, 739.99].forEach((f, i) => {
      this._bell(f, 0.12, 2.4, now + i * 0.16);
      this._bell(f * 0.5, 0.07, 3.4, now + i * 0.16);
    });
  }

  bell(freq, volume, dur, delay = 0) {
    this._bell(freq, volume, dur, delay, this.ctx.currentTime);
  }

  _bell(freq, volume, dur, delay, when) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = when + delay;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(volume, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master);
    g.connect(this.delay);
    const parts = [
      [1, 1, 'sine'],
      [2.01, 0.32, 'sine'],
      [3.0, 0.1, 'triangle'],
    ];
    parts.forEach(([mul, amp, type]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * mul;
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
    });
  }

  _chirp() {
    if (!this.started || this.muted || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    const g = ctx.createGain();
    g.gain.value = 0.03;
    g.connect(pan).connect(this.master);
    const count = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const t = now + i * 0.14;
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f = 1900 + Math.random() * 900;
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 1.18, t + 0.07);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.06, t + 0.015);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 0.14);
    }
  }

  _scheduleMusic() {
    if (!this.started || this.muted || !this.ctx || this.ctx.state !== 'running') return;
    // sparse, wind-chime-like motif
    const now = this.ctx.currentTime + 0.05;
    const root = PENTATONIC[1 + Math.floor(Math.random() * 4)];
    const pattern = [0, 2, 4, 2];
    pattern.forEach((step, i) => {
      if (Math.random() < 0.35) return;
      const f = PENTATONIC[(step + Math.floor(Math.random() * 2)) % PENTATONIC.length];
      this._bell(f, 0.025 + Math.random() * 0.02, 3.6, i * 0.55, now);
    });
    this._bell(root / 2, 0.018, 5.0, 0, now);
  }

  windRush() {
    if (!this.started || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(500, now);
    bp.frequency.exponentialRampToValueAtTime(1800, now + 0.6);
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.07, now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
    src.connect(bp).connect(g).connect(this.master);
    src.start(now, Math.random() * 2, 0.9);
  }
}
