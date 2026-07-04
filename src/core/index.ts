// convergence/core — pure math layer.
//
// Strict boundary: ZERO dependencies, NO audio, NO timers, NO Math.random
// (a seedable RNG is injected). Must never import from mood / conductor / render.
//
// Populated by later tasks: seedable RNG, graph builders, Markov chain step,
// Jacobi eigensolver + spectral helpers, tension / total-variation metrics.
export {};
