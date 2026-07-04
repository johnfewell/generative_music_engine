// Mood -> math-param mappings and named presets.

import type { Mood, MoodHint } from "./surface.js";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Geometric (log) interpolation — right for weights spanning orders of magnitude. */
const logLerp = (a: number, b: number, t: number) => a * Math.pow(b / a, t);

/**
 * The mood-to-math mapping tables. GLIDE params are read every step; REBUILD
 * params (leak weights) are applied through a rebuild + crossfade.
 */
export const MOOD_MAP = {
  /** patience -> walk laziness (smoothness). GLIDE. */
  alpha: (patience: number) => 0.95 * patience,
  /** wander -> same-supergroup leak weight (log 0.005..0.3). REBUILD. */
  leakCluster: (wander: number) => logLerp(0.005, 0.3, wander),
  /** wander -> cross-supergroup leak weight (log 0.001..0.05). REBUILD. */
  leakSuper: (wander: number) => logLerp(0.001, 0.05, wander),
  /** urgency -> velocity multiplier (0.5..1.5x). GLIDE. */
  velocityGain: (urgency: number) => lerp(0.5, 1.5, urgency),
  /** urgency -> ornament probability (0..0.6). GLIDE. */
  ornamentProbability: (urgency: number) => lerp(0, 0.6, urgency),
  /** urgency -> tempo multiplier (0.8..1.3x). GLIDE. */
  tempoMultiplier: (urgency: number) => lerp(0.8, 1.3, urgency),
} as const;

/** A named mood plus a renderer register/brightness hint. */
export type MoodPreset = Mood & { hint?: MoodHint };

export const PRESETS = {
  /** unhurried, mostly settled — long smooth lines, rare ornaments */
  calm: { patience: 0.8, wander: 0.15, urgency: 0.1, hint: { register: -1, brightness: 0.3 } },
  /** roaming curiosity — the melody wanders between registers */
  explore: { patience: 0.45, wander: 0.5, urgency: 0.35, hint: { register: 0, brightness: 0.6 } },
  /** restless and loud — fast, dense, high in the register */
  tense: { patience: 0.15, wander: 0.3, urgency: 0.85, hint: { register: 1, brightness: 0.9 } },
  /** hushed and low — patient but dim, few ornaments */
  night: { patience: 0.7, wander: 0.25, urgency: 0.2, hint: { register: -1, brightness: 0.2 } },
} satisfies Record<string, MoodPreset>;

export type PresetName = keyof typeof PRESETS;
