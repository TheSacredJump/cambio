import { getPrefs } from './prefs';

/** Card-table sounds synthesized from filtered noise. Nothing is downloaded. */
class Sound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  /** Browsers only allow audio after a gesture, so this is called from the first pointerdown. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const ctx = new AudioContext();
      const out = new GainNode(ctx, { gain: 0.55 });
      out.connect(new DynamicsCompressorNode(ctx, { threshold: -18, ratio: 4 })).connect(ctx.destination);
      const buf = new AudioBuffer({ length: ctx.sampleRate * 2, sampleRate: ctx.sampleRate });
      const d = buf.getChannelData(0);
      // Pinkish noise sounds more like paper than white noise.
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      }
      this.ctx = ctx;
      this.out = out;
      this.noise = buf;
    } catch {
      /* no audio */
    }
  }

  private ready() {
    return getPrefs().sound && this.ctx && this.out && this.noise && this.ctx.state === 'running';
  }

  private burst(at: number, dur: number, type: BiquadFilterType, f0: number, f1: number, q: number, peak: number, attack = 0.004) {
    const ctx = this.ctx!;
    const vary = 0.92 + Math.random() * 0.16;
    const src = new AudioBufferSourceNode(ctx, { buffer: this.noise!, playbackRate: vary });
    const filter = new BiquadFilterNode(ctx, { type, frequency: f0 * vary, Q: q });
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, f1 * vary), at + dur);
    const g = new GainNode(ctx, { gain: 0 });
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak * (0.85 + Math.random() * 0.3), at + attack);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.connect(filter).connect(g).connect(this.out!);
    src.start(at, Math.random() * 1.5, dur + 0.05);
  }

  private tone(at: number, freq: number, dur: number, peak: number, type: OscillatorType = 'sine') {
    const ctx = this.ctx!;
    const o = new OscillatorNode(ctx, { type, frequency: freq });
    const g = new GainNode(ctx, { gain: 0 });
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
    o.connect(g).connect(this.out!);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  private now(delay = 0) {
    return this.ctx!.currentTime + delay;
  }

  /** A card sliding across the felt and landing. */
  slide(delay = 0, strength = 1) {
    if (!this.ready()) return;
    const t = this.now(delay);
    this.burst(t, 0.22, 'bandpass', 3000, 1700, 0.8, 0.26 * strength, 0.02);
    this.burst(t + 0.2, 0.03, 'lowpass', 1800, 900, 0.7, 0.42 * strength);
  }

  flip(delay = 0) {
    if (!this.ready()) return;
    const t = this.now(delay);
    this.burst(t, 0.07, 'bandpass', 1500, 5000, 1.5, 0.22);
    this.burst(t + 0.06, 0.012, 'bandpass', 4200, 3800, 3, 0.4);
  }

  shuffle() {
    if (!this.ready()) return;
    const t0 = this.now();
    const grains = 42;
    for (let i = 0; i < grains; i++) {
      const at = t0 + i * 0.018 * (0.7 + Math.random() * 0.6);
      const hump = Math.sin((i / grains) * Math.PI);
      this.burst(at, 0.006 + Math.random() * 0.004, 'bandpass', 2500 + Math.random() * 3000, 2400, 2 + Math.random() * 2, 0.35 * hump + 0.05, 0.001);
    }
    this.burst(t0 + grains * 0.018, 0.25, 'lowpass', 1200, 600, 0.7, 0.25, 0.01);
  }

  deal(count: number, gap: number) {
    if (!this.ready()) return;
    for (let i = 0; i < count; i++) this.slide(0.12 + i * gap, 0.55);
  }

  /** Your turn. */
  chime() {
    if (!this.ready()) return;
    const t = this.now();
    this.tone(t, 784, 0.9, 0.08);
    this.tone(t + 0.09, 1175, 1.1, 0.06);
  }

  good() {
    if (!this.ready()) return;
    const t = this.now(0.2);
    this.tone(t, 1046, 0.35, 0.07, 'triangle');
    this.tone(t + 0.06, 1568, 0.45, 0.05, 'triangle');
  }

  bad() {
    if (!this.ready()) return;
    const t = this.now(0.45);
    this.tone(t, 180, 0.35, 0.16, 'triangle');
    this.burst(t, 0.1, 'lowpass', 600, 200, 0.7, 0.3);
  }

  cambio() {
    if (!this.ready()) return;
    const t = this.now();
    [523, 659, 784, 1046].forEach((f, i) => this.tone(t + i * 0.07, f, 1.6 - i * 0.2, 0.06, 'sine'));
  }

  whoosh() {
    if (!this.ready()) return;
    this.burst(this.now(), 0.35, 'bandpass', 600, 3200, 1.2, 0.18, 0.12);
  }

  tick() {
    if (!this.ready()) return;
    this.burst(this.now(), 0.012, 'bandpass', 3800, 3600, 3, 0.25);
  }
}

export const sound = new Sound();
