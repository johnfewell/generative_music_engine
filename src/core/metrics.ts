// Tension metrics: the engine's sense of musical form. A phrase ends when the
// walk's distance from its stationary distribution drops below a threshold
// (0.25 in the prototypes). The metastable engine measures that distance at
// three scales at once (note / phrase / section). Ported from
// mixing-time-composer.html line 178 (`tension`) and convergence-suite.html
// lines 299-305 (`tv`, `tv3`) and 724-731 (the prevTV + cooldown crossing gate).

import type { Grouping } from "./graph.js";

// Re-exported so the hierarchical metric's grouping type is importable from the
// metrics module too. It is the exact shape buildHierarchicalGraph returns.
export type { Grouping };

/** L1 distance from stationarity, sum |x[i] - pi[i]|. Thresholded at 0.25. */
export function tensionL1(x: Float64Array, pi: Float64Array): number {
  let t = 0;
  for (let i = 0; i < x.length; i++) t += Math.abs(x[i] - pi[i]);
  return t;
}

/** Total variation distance = tensionL1 / 2 (in [0, 1]). */
export function tv(x: Float64Array, pi: Float64Array): number {
  return tensionL1(x, pi) / 2;
}

/** Total variation measured at the full, cluster, and supergroup scales. */
export type HierarchicalTV = { full: number; cluster: number; superg: number };

/**
 * Total variation at three scales simultaneously: node-level (`full`), between
 * cluster-marginals (`cluster`), and between supergroup-marginals (`superg`).
 * Generalizes `tv3` (convergence-suite.html lines 300-305) to any cluster and
 * supergroup sizes. By the data-processing inequality the coarser scales can
 * only shrink the distance: `superg <= cluster <= full` at every step.
 */
export function tvHierarchical(
  x: Float64Array,
  pi: Float64Array,
  grouping: Grouping,
): HierarchicalTV {
  const { clusters, supers } = grouping;
  const cx = new Float64Array(clusters);
  const cp = new Float64Array(clusters);
  const sx = new Float64Array(supers);
  const sp = new Float64Array(supers);
  for (let i = 0; i < x.length; i++) {
    const c = grouping.clusterOf(i);
    const s = grouping.superOf(i);
    cx[c] += x[i];
    cp[c] += pi[i];
    sx[s] += x[i];
    sp[s] += pi[i];
  }
  let cluster = 0;
  for (let c = 0; c < clusters; c++) cluster += Math.abs(cx[c] - cp[c]);
  let superg = 0;
  for (let s = 0; s < supers; s++) superg += Math.abs(sx[s] - sp[s]);
  return { full: tv(x, pi), cluster: cluster / 2, superg: superg / 2 };
}

/**
 * Fires once each time a monitored value crosses strictly below `threshold`
 * from at-or-above it, then stays silent for `cooldown` further updates. The
 * conductor uses one per scale to emit phrase / section / movement events
 * exactly once per resolution. Port of the prevTV + cooldown gate in
 * convergence-suite.html lines 724-731.
 */
export class CrossingDetector {
  private prev: number | null = null;
  private cool = 0;

  constructor(
    readonly threshold: number,
    readonly cooldown = 0,
  ) {}

  /** Returns true only on a downward crossing that is not within cooldown. */
  update(value: number): boolean {
    if (this.cool > 0) {
      this.cool--;
      this.prev = value;
      return false;
    }
    const crossed =
      this.prev !== null && this.prev >= this.threshold && value < this.threshold;
    this.prev = value;
    if (crossed) this.cool = this.cooldown;
    return crossed;
  }

  /** Forget history (e.g. after a re-seed), so the next value can't cross. */
  reset(): void {
    this.prev = null;
    this.cool = 0;
  }
}
