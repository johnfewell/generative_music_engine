import { describe, expect, it } from "vitest";
import { mulberry32 } from "./rng.js";
import {
  buildGraph,
  buildHierarchicalGraph,
  type Graph,
  type Topology,
} from "./graph.js";
import { inject, sampleNode, stepChain } from "./chain.js";

const KINDS: Topology["kind"][] = [
  "ring",
  "complete",
  "bipartite",
  "smallworld",
  "clusters",
];

const sum = (a: Float64Array) => a.reduce((s, v) => s + v, 0);
const l1 = (a: Float64Array, b: Float64Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s;
};

/** All V1 topologies at the prototype's node count, plus a hierarchical graph. */
function everyGraph(): { name: string; g: Graph }[] {
  const graphs: { name: string; g: Graph }[] = KINDS.map((kind) => ({
    name: kind,
    g: buildGraph({ kind, nodes: 12 }),
  }));
  graphs.push({
    name: "hierarchical",
    g: buildHierarchicalGraph({
      clusters: 4,
      perCluster: 4,
      superGroups: 2,
      leakCluster: 0.1,
      leakSuper: 0.02,
    }),
  });
  return graphs;
}

describe("rng.mulberry32", () => {
  it("returns values in [0, 1)", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });
});

describe("graph builders", () => {
  it("pi sums to 1 for every topology", () => {
    for (const { name, g } of everyGraph()) {
      expect(Math.abs(sum(g.pi) - 1)).toBeLessThan(1e-12);
      // symmetric adjacency and positive degrees are preconditions for a valid
      // reversible chain
      for (let i = 0; i < g.n; i++) {
        expect(g.deg[i], `${name} node ${i} degree`).toBeGreaterThan(0);
        for (let j = 0; j < g.n; j++) expect(g.A[i][j]).toBe(g.A[j][i]);
      }
    }
  });

  it("pi[i] = deg[i]/sumDeg", () => {
    const g = buildGraph({ kind: "clusters", nodes: 12 });
    const sumDeg = sum(g.deg);
    for (let i = 0; i < g.n; i++) {
      expect(g.pi[i]).toBeCloseTo(g.deg[i] / sumDeg, 15);
    }
  });

  it("hierarchical graph exposes cluster/supergroup membership", () => {
    const g = buildHierarchicalGraph({
      clusters: 4,
      perCluster: 4,
      superGroups: 2,
      leakCluster: 0.1,
      leakSuper: 0.02,
    });
    expect(g.n).toBe(16);
    // node 7 -> cluster 1, supergroup 0; node 8 -> cluster 2, supergroup 1
    expect(Array.from(g.grouping.clusterOf)).toEqual([
      0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
    ]);
    expect(Array.from(g.grouping.superOf)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
    ]);
    // intra-cluster edge weight 1, same-super leak 0.1, cross-super leak 0.02
    expect(g.A[0][1]).toBe(1);
    expect(g.A[0][4]).toBe(0.1);
    expect(g.A[0][8]).toBe(0.02);
  });
});

describe("chain", () => {
  it("stepChain conserves probability mass for every topology", () => {
    for (const { name, g } of everyGraph()) {
      let x = inject(g, 0);
      expect(Math.abs(sum(x) - 1), `${name} after inject`).toBeLessThan(1e-12);
      for (let s = 0; s < 50; s++) {
        x = stepChain(g, x, 0.15);
        expect(Math.abs(sum(x) - 1), `${name} step ${s}`).toBeLessThan(1e-12);
      }
    }
  });

  it("stepChain does not mutate its input", () => {
    const g = buildGraph({ kind: "ring", nodes: 12 });
    const x = inject(g, 3);
    const before = Float64Array.from(x);
    stepChain(g, x, 0.15);
    expect(Array.from(x)).toEqual(Array.from(before));
  });

  it("converges to pi on the complete graph", () => {
    const g = buildGraph({ kind: "complete", nodes: 12 });
    let x = inject(g, 0);
    for (let s = 0; s < 200; s++) x = stepChain(g, x, 0.15);
    expect(l1(x, g.pi)).toBeLessThan(1e-6);
  });

  it("inject conserves mass and biases toward the node", () => {
    const g = buildGraph({ kind: "smallworld", nodes: 12 });
    const x = inject(g, 5);
    expect(Math.abs(sum(x) - 1)).toBeLessThan(1e-12);
    expect(x[5]).toBeCloseTo(0.7, 12);
  });

  it("sampleNode is deterministic for a seeded rng", () => {
    const g = buildGraph({ kind: "clusters", nodes: 12 });
    let x = inject(g, 2);
    for (let s = 0; s < 10; s++) x = stepChain(g, x, 0.15);

    const run = () => {
      const rng = mulberry32(42);
      return Array.from({ length: 200 }, () => sampleNode(x, rng));
    };
    expect(run()).toEqual(run());
  });

  it("sampleNode returns in-range indices", () => {
    const g = buildGraph({ kind: "ring", nodes: 12 });
    const x = inject(g, 0);
    const rng = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const idx = sampleNode(x, rng);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(g.n);
    }
  });
});
