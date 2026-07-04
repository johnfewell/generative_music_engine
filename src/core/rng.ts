// Seedable RNG for the core layer.
//
// The core is forbidden from touching Math.random so that every musical
// outcome is reproducible from a seed. Anything in core that needs randomness
// takes an injected `Rng`.

/** A uniform pseudo-random source returning values in [0, 1). */
export type Rng = () => number;

/**
 * Standard mulberry32 PRNG. Fast, 32-bit state, good enough for note choice.
 * Deterministic: the same seed always yields the same stream.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
