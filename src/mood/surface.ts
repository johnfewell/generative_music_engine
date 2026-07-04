// Mood surface: the handful of dials a game actually touches, mapped onto the
// honestly-meaningful math params. Some dials GLIDE (change continuously with no
// rebuild); others REBUILD the chain and are crossfaded so the music never
// jumps. Layer 2 — depends only on the conductor's public surface.

import type { Conductor } from "../conductor/index.js";
import { MOOD_MAP } from "./presets.js";
import type { PresetName } from "./presets.js";
import { PRESETS } from "./presets.js";

/** The three mood axes, each in [0, 1]. */
export type Mood = { patience: number; wander: number; urgency: number };

/** A register/brightness hint a preset passes through to the renderer. */
export type MoodHint = { register?: number; brightness?: number };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function clampMood(partial: Partial<Mood>): Partial<Mood> {
  const out: Partial<Mood> = {};
  if (partial.patience !== undefined) out.patience = clamp01(partial.patience);
  if (partial.wander !== undefined) out.wander = clamp01(partial.wander);
  if (partial.urgency !== undefined) out.urgency = clamp01(partial.urgency);
  return out;
}

// Warm-up length for a rebuild crossfade (steps). Velocities dip to 1/N over
// these steps, then the chain re-injects at its current peak.
const CROSSFADE_STEPS = 8;
const DEFAULT_GLIDE_SEC = 2;

/**
 * Drives a conductor's live params from three mood axes.
 *
 * | axis     | affects                                   | kind    |
 * |----------|-------------------------------------------|---------|
 * | patience | alpha = 0.95*patience                     | GLIDE   |
 * | wander   | leak.cluster 0.005..0.3, leak.super 0.001..0.05 (log) | REBUILD |
 * | urgency  | velocity 0.5..1.5x, ornament 0..0.6, tempo 0.8..1.3x  | GLIDE   |
 *
 * GLIDE axes exponentially smooth toward their target once per conductor step
 * (time constant `glideSec`, default 2s). WANDER rebuilds the chain once and
 * crossfades: velocities dip over `CROSSFADE_STEPS`, then the chain re-injects
 * at its loudest node (not random) to preserve melodic continuity.
 */
export class MoodSurface {
  private readonly conductor: Conductor;
  private readonly baseTempo: number;
  private readonly target: Mood;
  private readonly currentMood: Mood;
  private glideSec = DEFAULT_GLIDE_SEC;
  private crossfadeLeft = 0;
  private hint: MoodHint = {};

  constructor(conductor: Conductor) {
    this.conductor = conductor;
    this.baseTempo = conductor.tempo;
    // Seed patience from the conductor's current alpha; neutral urgency/wander.
    const patience = clamp01(conductor.alpha / 0.95);
    this.currentMood = { patience, wander: 0.3, urgency: 0.5 };
    this.target = { ...this.currentMood };
    conductor.onStep((info) => this.step(info.dt));
  }

  /** Update mood axes. Providing `wander` rebuilds the chain (crossfaded). */
  set(partial: Partial<Mood>, opts?: { glideSec?: number }): void {
    if (opts?.glideSec !== undefined) this.glideSec = opts.glideSec;
    const clamped = clampMood(partial);
    const wanderChanged =
      clamped.wander !== undefined && clamped.wander !== this.target.wander;
    Object.assign(this.target, clamped);
    if (wanderChanged) this.rebuildForWander();
  }

  /** Apply a named preset (mood axes + a renderer register/brightness hint). */
  preset(name: PresetName): void {
    const p = PRESETS[name];
    this.hint = { ...(p.hint ?? {}) };
    this.set({ patience: p.patience, wander: p.wander, urgency: p.urgency });
  }

  /** The current (glided) mood. After settling it equals the last targets. */
  current(): Mood {
    return { ...this.currentMood };
  }

  /** The last preset's renderer hint (register shift / brightness). */
  currentHint(): MoodHint {
    return { ...this.hint };
  }

  // --- internals ---

  private rebuildForWander(): void {
    const engine = this.conductor.engine as {
      rebuild?: (leaks: { cluster: number; super: number }) => void;
    };
    if (typeof engine.rebuild !== "function") return; // no leaks to change (non-hierarchical)
    engine.rebuild({
      cluster: MOOD_MAP.leakCluster(this.target.wander),
      super: MOOD_MAP.leakSuper(this.target.wander),
    });
    this.currentMood.wander = this.target.wander;
    this.crossfadeLeft = CROSSFADE_STEPS; // begin the warm-up dip
  }

  /** Exponential glide + crossfade, run once per conductor step. */
  private step(dt: number): void {
    const g = 1 - Math.exp(-dt / this.glideSec);
    this.currentMood.patience += (this.target.patience - this.currentMood.patience) * g;
    this.currentMood.urgency += (this.target.urgency - this.currentMood.urgency) * g;

    const c = this.conductor;
    c.alpha = MOOD_MAP.alpha(this.currentMood.patience);
    c.tempo = this.baseTempo * MOOD_MAP.tempoMultiplier(this.currentMood.urgency);
    c.ornamentProbability = MOOD_MAP.ornamentProbability(this.currentMood.urgency);

    let xfade = 1;
    if (this.crossfadeLeft > 0) {
      const k = CROSSFADE_STEPS - this.crossfadeLeft; // 0 .. N-1
      xfade = 1 - k / CROSSFADE_STEPS; // 1 .. 1/N, never 0 (no silent step)
      this.crossfadeLeft--;
      if (this.crossfadeLeft === 0) this.reinjectAtPeak();
    }
    c.velocityGain = MOOD_MAP.velocityGain(this.currentMood.urgency) * xfade;
  }

  private reinjectAtPeak(): void {
    const x = this.conductor.engine.x;
    let peak = 0;
    for (let i = 1; i < x.length; i++) if (x[i] > x[peak]) peak = i;
    this.conductor.inject(peak);
  }
}
