// convergence/core — pure math layer.
//
// Strict boundary: ZERO dependencies, NO audio, NO timers, NO Math.random
// (a seedable RNG is injected). Must never import from mood / conductor / render.
//
// Populated incrementally: seedable RNG, graph builders, Markov chain step
// (this task); Jacobi eigensolver + spectral helpers, tension /
// total-variation metrics (later tasks).
export * from "./rng.js";
export * from "./graph.js";
export * from "./chain.js";
export * from "./spectral.js";
export * from "./metrics.js";
