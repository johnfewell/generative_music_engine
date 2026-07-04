// Pitch mapping: turn a chain node index into a playable frequency. This layer
// is deliberately separable from the math — the same graph/chain drives a
// C-minor-pentatonic MIDI ear (mixing-time-composer.html) or a cents-based
// Balinese gamelan ear with a stretched octave (mixing-time-composer-gamelan.html)
// simply by swapping the PitchMap. No dependency on core / conductor / render.

/** A node-index -> frequency mapping with human-readable labels. */
export interface PitchMap {
  /** Number of nodes this map covers (matches the graph's node count). */
  size: number;
  /** Frequency in Hz for a node index in [0, size). */
  freq(node: number): number;
  /** A short label for a node (note name, cents offset, etc.). */
  label(node: number): string;
}

/** Equal-tempered MIDI note number -> frequency: 440 * 2^((m-69)/12). */
export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// Flat spellings, scientific pitch notation (MIDI 60 = C4, 69 = A4).
const NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
function midiName(m: number): string {
  const pc = ((Math.round(m) % 12) + 12) % 12;
  const octave = Math.floor(Math.round(m) / 12) - 1;
  return NOTE_NAMES[pc] + octave;
}

/**
 * A PitchMap from an explicit list of MIDI notes (12-TET). Labels default to
 * note names; pass `labels` to override (e.g. the prototype's C2-based names).
 */
export function fromMidi(midiNotes: number[], labels?: string[]): PitchMap {
  const notes = midiNotes.slice();
  return {
    size: notes.length,
    freq: (node) => midiToFreq(notes[node]),
    label: (node) => labels?.[node] ?? midiName(notes[node]),
  };
}

/**
 * Minor-pentatonic map: scale degrees [0,3,5,7,10] semitones repeated every
 * octave, `octaves` octaves tall. Generalizes `pent` (convergence-suite.html
 * lines 151-153). pentatonicMinor(48, 2.4) reproduces the 12-note table
 * [48,51,53,55,58,60,63,65,67,70,72,75] of mixing-time-composer.html line 97.
 */
export function pentatonicMinor(rootMidi: number, octaves: number): PitchMap {
  const degs = [0, 3, 5, 7, 10];
  const size = Math.round(octaves * degs.length);
  const midiOf = (node: number) =>
    rootMidi + 12 * Math.floor(node / degs.length) + degs[node % degs.length];
  return {
    size,
    freq: (node) => midiToFreq(midiOf(node)),
    label: (node) => midiName(midiOf(node)),
  };
}

/** Options for a cents-based (microtonal) scale map. */
export type CentsScaleOptions = {
  /** Frequency of node 0 in Hz. */
  baseHz: number;
  /** Cents of each scale degree within one octave (first is usually 0). */
  steps: number[];
  /** Octave size in cents; 1200 is just, gamelan stretches it (e.g. 1205). */
  octaveCents?: number;
  /** Total number of nodes. */
  count: number;
};

/**
 * A PitchMap from a cents-based scale with a (possibly stretched) octave:
 * freq(i) = baseHz * 2^((floor(i/steps.length)*octaveCents + steps[i%steps.length]) / 1200).
 * Port of `retune` (mixing-time-composer-gamelan.html lines 121-128), generalized
 * to any scale and node count.
 */
export function fromCents({
  baseHz,
  steps,
  octaveCents = 1200,
  count,
}: CentsScaleOptions): PitchMap {
  const L = steps.length;
  const centsOf = (i: number) => Math.floor(i / L) * octaveCents + steps[i % L];
  return {
    size: count,
    freq: (node) => baseHz * Math.pow(2, centsOf(node) / 1200),
    label: (node) => `${Math.round(centsOf(node))}c`,
  };
}

/** Pelog selisir approximation, cents (mixing-time-composer-gamelan.html line 113). */
export const SELISIR = [0, 120, 270, 670, 800];
/** Near-equidistant slendro, cents (mixing-time-composer-gamelan.html line 114). */
export const SLENDRO = [0, 231, 474, 717, 955];
