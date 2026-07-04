// The conductor's output: a stream of typed musical events. This is the real
// product of the library — a game can consume these directly and render them
// however it likes (or ignore the bundled WebAudio renderer entirely).

/** Which voice a note belongs to. */
export type NoteLayer = "melody" | "pad" | "ornament" | "cadence";

/** A single note to sound at `time` (in the injected clock's seconds). */
export type NoteEvent = {
  /** When to play, in clock seconds. Always >= the clock at emission. */
  time: number;
  layer: NoteLayer;
  /** Chain node index this note came from. */
  node: number;
  /** Frequency in Hz (already resolved through the PitchMap). */
  freq: number;
  /** Linear velocity/gain in [0, 1]. */
  velocity: number;
  /** Duration in seconds. */
  duration: number;
  /** Stereo pan in [-1, 1]. */
  pan: number;
};

/** Kinds of musical-form resolution, coarsest timescale last. */
export type FormKind = "phraseResolved" | "sectionResolved" | "movementResolved";

/** Fires when the chain mixes at a given scale (a phrase/section/movement ends). */
export type FormEvent = {
  time: number;
  kind: FormKind;
  /** How many of this kind have resolved so far (1-based). */
  count: number;
};

/** Per-step telemetry: the raw chain state for visualizers/debuggers. */
export type TickEvent = {
  time: number;
  /** L1 distance from stationarity (the engine's tension). */
  tension: number;
  /** Snapshot copy of the distribution at this step. */
  x: Float64Array;
};
