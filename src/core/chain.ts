// The Markov chain itself: one lazy random-walk step, mass injection, and
// note sampling. Ported from `step` / `inject` (mixing-time-composer.html lines
// 168-190) and the melody sampler (lines 222-225). All functions are pure and
// return fresh arrays — the input distribution is never mutated.

import type { Graph } from "./graph.js";
import type { Rng } from "./rng.js";

/**
 * One lazy random-walk step: `x <- alpha*x + (1-alpha)*x*M`, where
 * `M = D^{-1} A` is the row-stochastic transition matrix. Laziness (alpha > 0)
 * keeps the chain aperiodic so it converges on bipartite graphs too.
 * Returns a new array; `x` is left untouched.
 */
export function stepChain(g: Graph, x: Float64Array, alpha: number): Float64Array {
  const { n, A, deg } = g;
  const nx = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    nx[i] += alpha * x[i];
    const c = ((1 - alpha) * x[i]) / deg[i];
    const row = A[i];
    for (let j = 0; j < n; j++) if (row[j]) nx[j] += c * row[j];
  }
  return nx;
}

/**
 * Concentrate the distribution onto a node: 0.7 of the mass on `node`, the
 * remaining 0.3 spread over its neighbors in proportion to edge weight. Total
 * mass stays 1 (graphs have no self-loops, so neighbor weights sum to deg).
 */
export function inject(g: Graph, node: number): Float64Array {
  const { n, A, deg } = g;
  const nx = new Float64Array(n);
  nx[node] = 0.7;
  const row = A[node];
  for (let j = 0; j < n; j++) if (row[j]) nx[j] += (0.3 * row[j]) / deg[node];
  return nx;
}

/**
 * Sample a node index from the distribution, sharpened by raising each mass to
 * the power `sharpen` and renormalizing. Higher `sharpen` biases toward the
 * peaks. Consumes exactly one value from `rng`.
 */
export function sampleNode(x: Float64Array, rng: Rng, sharpen = 1.4): number {
  const n = x.length;
  const sharp = new Float64Array(n);
  let Z = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.pow(x[i], sharpen);
    sharp[i] = s;
    Z += s;
  }
  let r = rng() * Z;
  for (let i = 0; i < n; i++) {
    r -= sharp[i];
    if (r <= 0) return i;
  }
  return n - 1;
}
