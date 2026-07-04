// WebAudio instrument palette. Ported from the shared synths in
// convergence-suite.html lines 192-258, refactored to take
// (ctx, dest, when, ...): every voice schedules at the EVENT time `when`, never
// at ctx.currentTime — the conductor emits future-dated events and using
// currentTime would collapse the look-ahead timing.
//
// No DOM dependency: the AudioContext is passed in, so these run under a stub
// in tests.

/** [frequency ratio, amplitude] of an additive partial. */
export type Partial = [ratio: number, amp: number];

const DEFAULT_BAR_PARTIALS: Partial[] = [
  [1, 1],
  [2.76, 0.3],
  [5.4, 0.1],
];

// One shared noise buffer per context (used by hat / noiseBurst).
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.2), ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

function connectPanned(ctx: BaseAudioContext, node: AudioNode, dest: AudioNode, pan: number): void {
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(p);
    p.connect(dest);
  } else {
    node.connect(dest);
  }
}

/** Additive metallophone bar: sine partials, each with its own decay. */
export function bar(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  freq: number,
  vel: number,
  dur: number,
  pan = 0,
  partials: Partial[] = DEFAULT_BAR_PARTIALS,
): void {
  const out = ctx.createGain();
  out.gain.value = 1;
  connectPanned(ctx, out, dest, pan);
  partials.forEach(([r, a], k) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = freq * r;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vel * a, when + 0.005);
    g.gain.exponentialRampToValueAtTime(3e-4, when + dur * (k ? 0.55 : 1));
    o.connect(g);
    g.connect(out);
    o.start(when);
    o.stop(when + dur + 0.05);
  });
}

/** Bronze strike: a detuned bar pair (the shimmer of two close voices). */
export function strike(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  freq: number,
  vel: number,
  dur: number,
  pan = 0,
): void {
  bar(ctx, dest, when, freq + 1.5, vel * 0.5, dur, pan);
  bar(ctx, dest, when, freq - 1.5, vel * 0.5, dur, pan);
}

/** Second, hollow/woody timbre (different partial set). */
export function strikeB(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  freq: number,
  vel: number,
  dur: number,
  pan = 0,
): void {
  bar(ctx, dest, when, freq, vel * 0.6, dur, pan, [
    [1, 1],
    [3.2, 0.45],
    [6.9, 0.14],
  ]);
}

/** Gong: partials that settle in pitch as they bloom. */
export function gong(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  base: number,
  vel: number,
  dur: number,
): void {
  const partials: Partial[] = [
    [1, 1],
    [1.52, 0.4],
    [2.48, 0.18],
    [0.5, 0.25],
  ];
  partials.forEach(([r, a]) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(base * r * 1.02, when);
    o.frequency.exponentialRampToValueAtTime(base * r, when + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vel * a, when + 0.02);
    g.gain.exponentialRampToValueAtTime(3e-4, when + dur);
    o.connect(g);
    g.connect(dest);
    o.start(when);
    o.stop(when + dur + 0.1);
  });
}

/** Sine kick drum: pitch drops fast. */
export function kick(ctx: BaseAudioContext, dest: AudioNode, when: number, vel: number): void {
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(130, when);
  o.frequency.exponentialRampToValueAtTime(42, when + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel, when);
  g.gain.exponentialRampToValueAtTime(3e-4, when + 0.22);
  o.connect(g);
  g.connect(dest);
  o.start(when);
  o.stop(when + 0.25);
}

/** Filtered noise hi-hat. */
export function hat(ctx: BaseAudioContext, dest: AudioNode, when: number, vel: number): void {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel, when);
  g.gain.exponentialRampToValueAtTime(3e-4, when + 0.05);
  s.connect(f);
  f.connect(g);
  g.connect(dest);
  s.start(when);
  s.stop(when + 0.07);
}

/** Band-passed noise burst (pitched percussion / breath). */
export function noiseBurst(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  freq: number,
  vel: number,
  dur = 0.3,
): void {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = 2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(vel, when + 0.03);
  g.gain.exponentialRampToValueAtTime(3e-4, when + dur);
  s.connect(f);
  f.connect(g);
  g.connect(dest);
  s.start(when);
  s.stop(when + dur + 0.05);
}

/** Detuned sawtooth bass with a lowpass sweep. Takes a frequency in Hz. */
export function bassHit(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  freq: number,
  vel = 0.35,
  dur = 0.9,
): void {
  [0, 7].forEach((detCents) => {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq * (1 + detCents / 1200);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(900, when);
    f.frequency.exponentialRampToValueAtTime(120, when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.5, when);
    g.gain.exponentialRampToValueAtTime(3e-4, when + dur);
    o.connect(f);
    f.connect(g);
    g.connect(dest);
    o.start(when);
    o.stop(when + dur + 0.05);
  });
}
