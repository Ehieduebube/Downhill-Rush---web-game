// Procedural Web Audio sound effects. No audio files are required, so nothing can fail
// to load. The AudioContext is only created after a user gesture (autoplay policy).

type Ctx = AudioContext;

class AudioEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private white: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  private rollGain: GainNode | null = null;
  private rollFilter: BiquadFilterNode | null = null;
  private hissGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private slideGain: GainNode | null = null;
  private ambGain: GainNode | null = null;
  private muted = false;
  private failed = false;

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture handler. Safe to call repeatedly. */
  init() {
    if (this.failed) return;
    try {
      if (!this.ctx) {
        const AC: typeof AudioContext | undefined =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) {
          this.failed = true;
          return;
        }
        const ctx = new AC();
        this.ctx = ctx;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 4;
        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.9;
        this.master.connect(comp).connect(ctx.destination);
        this.sfx = ctx.createGain();
        this.sfx.gain.value = 0.85;
        this.sfx.connect(this.master);
        this.white = this.makeNoise(ctx, 'white', 2);
        this.brown = this.makeNoise(ctx, 'brown', 3);
        this.setupLoops(ctx);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    } catch {
      this.failed = true;
      this.ctx = null;
    }
  }

  private makeNoise(ctx: Ctx, kind: 'white' | 'brown', seconds: number) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return buf;
  }

  private loop(ctx: Ctx, buf: AudioBuffer) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start();
    return src;
  }

  private setupLoops(ctx: Ctx) {
    if (!this.master || !this.brown || !this.white) return;
    // Wheel rumble
    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = 'lowpass';
    this.rollFilter.frequency.value = 400;
    this.rollFilter.Q.value = 0.8;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    this.loop(ctx, this.brown).connect(this.rollFilter).connect(this.rollGain).connect(this.master);
    // Bearing hiss
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = 'bandpass';
    hissFilter.frequency.value = 2400;
    hissFilter.Q.value = 1.2;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    this.loop(ctx, this.white).connect(hissFilter).connect(this.hissGain).connect(this.master);
    // Wind
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 700;
    this.windFilter.Q.value = 0.5;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.loop(ctx, this.white).connect(this.windFilter).connect(this.windGain).connect(this.master);
    // Slide scrape
    const scrape = ctx.createBiquadFilter();
    scrape.type = 'bandpass';
    scrape.frequency.value = 3200;
    scrape.Q.value = 2.5;
    this.slideGain = ctx.createGain();
    this.slideGain.gain.value = 0;
    this.loop(ctx, this.white).connect(scrape).connect(this.slideGain).connect(this.master);
    // Distant surf ambience
    const surf = ctx.createBiquadFilter();
    surf.type = 'lowpass';
    surf.frequency.value = 520;
    this.ambGain = ctx.createGain();
    this.ambGain.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.035;
    lfo.connect(lfoGain).connect(this.ambGain.gain);
    lfo.start();
    this.loop(ctx, this.brown).connect(surf).connect(this.ambGain).connect(this.master);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.03);
    }
  }

  /** Continuous sounds, called every frame. */
  updateLoops(speed: number, grounded: boolean, sliding: boolean, active: boolean, boost = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.rollGain || !this.rollFilter || !this.hissGain || !this.windGain || !this.windFilter || !this.slideGain)
      return;
    const t = ctx.currentTime;
    const k = Math.min(speed / 43, 1);
    const roll = active && grounded ? 0.16 + 0.22 * k : 0;
    this.rollGain.gain.setTargetAtTime(roll, t, 0.05);
    this.rollFilter.frequency.setTargetAtTime(260 + 520 * k, t, 0.1);
    this.hissGain.gain.setTargetAtTime(active && grounded ? 0.008 + 0.02 * k : 0, t, 0.08);
    this.windGain.gain.setTargetAtTime(active ? 0.012 + 0.06 * k * k + 0.07 * boost : 0.006, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(500 + 900 * k + 900 * boost, t, 0.2);
    this.slideGain.gain.setTargetAtTime(active && sliding && grounded ? 0.07 : 0, t, 0.03);
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private tone(
    freq: number,
    dur: number,
    opts: { type?: OscillatorType; gain?: number; delay?: number; to?: number; attack?: number } = {},
  ) {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    const g = ctx.createGain();
    this.env(g, t, opts.gain ?? 0.2, opts.attack ?? 0.005, dur);
    osc.connect(g).connect(this.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private burst(
    dur: number,
    opts: { type?: BiquadFilterType; freq?: number; to?: number; q?: number; gain?: number; delay?: number; attack?: number } = {},
  ) {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || !this.white) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq ?? 1000, t);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    this.env(g, t, opts.gain ?? 0.2, opts.attack ?? 0.004, dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  coin(streak: number) {
    const semis = Math.min(streak, 12);
    const base = 988 * Math.pow(2, semis / 12);
    this.tone(base, 0.09, { type: 'triangle', gain: 0.16 });
    this.tone(base * 1.335, 0.22, { type: 'triangle', gain: 0.14, delay: 0.055 });
    this.tone(base * 2.67, 0.12, { type: 'sine', gain: 0.04, delay: 0.055 });
  }

  jump() {
    this.burst(0.06, { type: 'bandpass', freq: 1900, q: 1.4, gain: 0.32 });
    this.tone(170, 0.14, { to: 70, gain: 0.3, type: 'sine' });
  }

  land(impact: number) {
    const k = Math.min(Math.max(impact / 14, 0.25), 1);
    this.tone(95, 0.2, { to: 42, gain: 0.38 * k });
    this.burst(0.14, { type: 'lowpass', freq: 900, to: 200, gain: 0.25 * k });
    this.burst(0.03, { type: 'highpass', freq: 3000, gain: 0.1 * k, delay: 0.01 });
  }

  clack() {
    this.burst(0.025, { type: 'bandpass', freq: 1400, q: 2, gain: 0.06 });
    this.tone(120, 0.05, { gain: 0.06, to: 80 });
  }

  slide() {
    this.burst(0.25, { type: 'bandpass', freq: 2600, to: 1400, q: 1.5, gain: 0.14 });
  }

  trickStart() {
    this.burst(0.32, { type: 'bandpass', freq: 380, to: 2200, q: 0.9, gain: 0.22, attack: 0.04 });
  }

  trickLanded(mult: number) {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    const n = Math.min(2 + mult, 4);
    for (let i = 0; i < n; i++) this.tone(notes[i], 0.16, { type: 'triangle', gain: 0.12, delay: i * 0.06 });
  }

  crash() {
    this.burst(0.6, { type: 'lowpass', freq: 2400, to: 140, gain: 0.55 });
    this.tone(70, 0.45, { to: 35, gain: 0.5 });
    this.tone(232, 0.35, { type: 'square', gain: 0.05, to: 180, delay: 0.02 });
    this.tone(311, 0.3, { type: 'square', gain: 0.04, to: 240, delay: 0.05 });
    this.burst(0.25, { type: 'bandpass', freq: 3500, q: 3, gain: 0.12, delay: 0.12 });
  }

  fall() {
    this.burst(0.9, { type: 'bandpass', freq: 900, to: 160, q: 0.8, gain: 0.3, attack: 0.05 });
    this.tone(440, 0.9, { to: 110, gain: 0.08, type: 'triangle' });
  }

  shieldUp() {
    this.tone(520, 0.3, { to: 1040, gain: 0.14, type: 'sine' });
    this.tone(780, 0.35, { to: 1560, gain: 0.08, type: 'triangle', delay: 0.06 });
  }

  shieldBreak() {
    this.burst(0.3, { type: 'highpass', freq: 2000, gain: 0.25 });
    this.tone(880, 0.25, { to: 220, gain: 0.12, type: 'triangle' });
  }

  magnetUp() {
    // wobbling two-tone "magnetic" sweep
    this.tone(330, 0.35, { to: 660, gain: 0.12, type: 'square' });
    this.tone(495, 0.4, { to: 990, gain: 0.07, type: 'triangle', delay: 0.05 });
    this.tone(1320, 0.18, { gain: 0.05, type: 'sine', delay: 0.3 });
  }

  boostUp() {
    // ignition thump + rising whoosh
    this.tone(90, 0.25, { to: 180, gain: 0.3 });
    this.burst(0.6, { type: 'bandpass', freq: 300, to: 3200, q: 0.8, gain: 0.28, attack: 0.03 });
    this.tone(440, 0.4, { to: 1320, gain: 0.07, type: 'sawtooth', delay: 0.05 });
  }

  powerDown() {
    this.tone(880, 0.22, { to: 330, gain: 0.08, type: 'triangle' });
  }

  knock() {
    this.tone(260, 0.12, { to: 150, gain: 0.18, type: 'triangle' });
    this.burst(0.08, { type: 'bandpass', freq: 1200, gain: 0.18 });
  }

  click() {
    this.tone(720, 0.06, { gain: 0.1, type: 'sine' });
    this.tone(1080, 0.05, { gain: 0.05, type: 'sine', delay: 0.03 });
  }

  gameOver() {
    [523.25, 440, 349.23, 261.63].forEach((f, i) =>
      this.tone(f, 0.22, { type: 'triangle', gain: 0.1, delay: 0.1 + i * 0.12 }),
    );
  }

  newBest() {
    [659.25, 783.99, 987.77, 1318.5].forEach((f, i) =>
      this.tone(f, 0.18, { type: 'triangle', gain: 0.1, delay: i * 0.07 }),
    );
  }

  /** Called when the game is paused to stop the loops quickly. */
  quiet() {
    this.updateLoops(0, false, false, false);
  }

  /** Fully suspend audio processing while the page is hidden. */
  setSuspended(hidden: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (hidden && ctx.state === 'running') void ctx.suspend().catch(() => undefined);
    else if (!hidden && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  }
}

export const audio = new AudioEngine();
