import { describe, expect, it } from "vitest";
import { mulberry32 } from "./rng.js";
import { buildHierarchicalGraph } from "./graph.js";
import { inject, stepChain } from "./chain.js";
import { CrossingDetector, tv, tvHierarchical, tensionL1 } from "./metrics.js";

/** A random probability distribution over n nodes from a seeded rng. */
function randomDist(n: number, rng: () => number): Float64Array {
  const x = new Float64Array(n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    x[i] = rng();
    s += x[i];
  }
  for (let i = 0; i < n; i++) x[i] /= s;
  return x;
}

const hier = () =>
  buildHierarchicalGraph({
    clusters: 4,
    perCluster: 4,
    superGroups: 2,
    leakCluster: 0.05,
    leakSuper: 0.006,
  });

describe("tv / tensionL1", () => {
  it("tv(pi, pi) === 0", () => {
    const pi = new Float64Array([0.25, 0.25, 0.25, 0.25]);
    expect(tv(pi, pi)).toBe(0);
  });

  it("tv(pointMass, uniform) === (n-1)/n", () => {
    for (const n of [4, 12, 16]) {
      const point = new Float64Array(n);
      point[0] = 1;
      const uniform = new Float64Array(n).fill(1 / n);
      expect(tv(point, uniform)).toBeCloseTo((n - 1) / n, 12);
    }
  });

  it("tv is half the L1 tension", () => {
    const rng = mulberry32(5);
    const x = randomDist(8, rng);
    const pi = randomDist(8, rng);
    expect(tv(x, pi)).toBeCloseTo(tensionL1(x, pi) / 2, 12);
  });
});

describe("tvHierarchical", () => {
  it("obeys the data-processing inequality superg <= cluster <= full", () => {
    const g = hier();
    const rng = mulberry32(99);
    for (let trial = 0; trial < 100; trial++) {
      const x = randomDist(g.n, rng);
      const pi = randomDist(g.n, rng);
      const m = tvHierarchical(x, pi, g.grouping);
      expect(m.superg).toBeLessThanOrEqual(m.cluster + 1e-12);
      expect(m.cluster).toBeLessThanOrEqual(m.full + 1e-12);
    }
  });

  it("full scale equals plain tv", () => {
    const g = hier();
    const x = inject(g, 0);
    const m = tvHierarchical(x, g.pi, g.grouping);
    expect(m.full).toBeCloseTo(tv(x, g.pi), 12);
  });

  it("all scales are 0 at the stationary distribution", () => {
    const g = hier();
    const m = tvHierarchical(g.pi, g.pi, g.grouping);
    expect(m.full).toBeCloseTo(0, 12);
    expect(m.cluster).toBeCloseTo(0, 12);
    expect(m.superg).toBeCloseTo(0, 12);
  });
});

describe("hierarchical crossing order (physics)", () => {
  // NOTE: task .4 criterion #3 asks for `cluster` to cross 0.25 STRICTLY BEFORE
  // `superg`. That is provably impossible: the data-processing inequality forces
  // superg <= cluster <= full at every step, so a coarser scale can never cross
  // later. With the specified params all three even cross on the SAME step,
  // because near mixing the slowest (cross-super) eigenmode dominates and is
  // flat within each supergroup, making the three TVs equal. We therefore assert
  // the provable, self-consistent ordering (superg <= cluster <= full) instead.
  // See discovered-from bead for the reconciliation.
  it("crosses 0.25 in coarse-to-fine order: superg <= cluster <= full", () => {
    const g = hier();
    let x = inject(g, 0);
    const alpha = 0.3;
    let tSuperg = -1;
    let tCluster = -1;
    let tFull = -1;
    for (let t = 0; t < 5000; t++) {
      const m = tvHierarchical(x, g.pi, g.grouping);
      // pointwise data-processing inequality holds along the whole trajectory
      expect(m.superg).toBeLessThanOrEqual(m.cluster + 1e-12);
      expect(m.cluster).toBeLessThanOrEqual(m.full + 1e-12);
      if (tSuperg < 0 && m.superg < 0.25) tSuperg = t;
      if (tCluster < 0 && m.cluster < 0.25) tCluster = t;
      if (tFull < 0 && m.full < 0.25) tFull = t;
      if (tSuperg >= 0 && tCluster >= 0 && tFull >= 0) break;
      x = stepChain(g, x, alpha);
    }
    expect(tSuperg).toBeGreaterThan(0);
    expect(tCluster).toBeGreaterThan(0);
    expect(tFull).toBeGreaterThan(0);
    expect(tSuperg).toBeLessThanOrEqual(tCluster);
    expect(tCluster).toBeLessThanOrEqual(tFull);
  });
});

describe("CrossingDetector", () => {
  it("fires exactly once for a value that dips below and stays", () => {
    const d = new CrossingDetector(0.25);
    const values = [0.5, 0.4, 0.3, 0.2, 0.1, 0.05, 0.1, 0.05];
    const fires = values.map((v) => d.update(v));
    expect(fires.filter(Boolean).length).toBe(1);
    expect(fires[3]).toBe(true); // the step where 0.3 -> 0.2 crosses below
  });

  it("does not fire on the first value (no history)", () => {
    const d = new CrossingDetector(0.25);
    expect(d.update(0.1)).toBe(false);
  });

  it("does not fire on an upward crossing", () => {
    const d = new CrossingDetector(0.25);
    d.update(0.1);
    expect(d.update(0.5)).toBe(false);
  });

  it("suppresses re-fires during cooldown", () => {
    const d = new CrossingDetector(0.25, 5);
    // cross down, then oscillate; the re-crossing at index 3 falls inside the
    // 5-update cooldown window opened by the first fire, so it is suppressed
    const seq = [0.5, 0.2, 0.5, 0.2];
    const fires = seq.map((v) => d.update(v));
    expect(fires.filter(Boolean).length).toBe(1);
    expect(fires[1]).toBe(true);
  });

  it("fires again after cooldown expires", () => {
    const d = new CrossingDetector(0.25, 1);
    expect(d.update(0.5)).toBe(false);
    expect(d.update(0.2)).toBe(true); // fire, cool = 1
    expect(d.update(0.5)).toBe(false); // cooldown decrements
    expect(d.update(0.2)).toBe(true); // fires again
  });

  it("reset() clears history so the next value cannot cross", () => {
    const d = new CrossingDetector(0.25);
    d.update(0.5);
    d.reset();
    expect(d.update(0.2)).toBe(false);
  });
});
