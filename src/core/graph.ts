// Weighted graph builders for the Markov chain.
//
// A `Graph` bundles the symmetric adjacency `A` with the derived quantities the
// chain needs every step: degrees, the stationary distribution `pi`, and
// sqrt(deg) (used by the spectral layer for the symmetric normalization
// D^{-1/2} A D^{-1/2}). Ported and generalized from `presetAdj` / `rebuild` in
// mixing-time-composer.html and `makeHier` in convergence-suite.html.

/** Named adjacency shape plus the node count to build it at. */
export type Topology = {
  kind: "ring" | "complete" | "bipartite" | "smallworld" | "clusters";
  nodes: number;
  /**
   * Weak-link weight. For `clusters` it is the bridge between the two halves
   * (source default 0.12); for `smallworld` it is the long-range chord weight
   * (default 0.5). Ignored by the other kinds.
   */
  bridgeWeight?: number;
};

/** A built graph: symmetric adjacency plus derived chain quantities. */
export type Graph = {
  n: number;
  /** Row-major symmetric adjacency; `A[i][j]` is the weight of edge i-j. */
  A: Float64Array[];
  /** Weighted degree per node, `deg[i] = sum_j A[i][j]`. */
  deg: Float64Array;
  /** Stationary distribution of the random walk, `pi[i] = deg[i]/sumDeg`. */
  pi: Float64Array;
  /** sqrt(deg[i]); precomputed for the symmetric normalization. */
  sqrtDeg: Float64Array;
};

/** Config for a three-level hierarchical (metastable) graph. */
export type HierarchicalTopology = {
  /** Number of clusters. */
  clusters: number;
  /** Nodes in each cluster. */
  perCluster: number;
  /** Number of supergroups; `clusters` must divide evenly into these. */
  superGroups: number;
  /** Leak weight between clusters that share a supergroup (source `w2`). */
  leakCluster: number;
  /** Leak weight between clusters in different supergroups (source `w3`). */
  leakSuper: number;
};

/**
 * Per-node membership for a hierarchical graph, consumed by the hierarchical
 * metrics (see metrics.ts). `clusterOf`/`superOf` are O(1) accessors rather than
 * arrays so the same shape works for any cluster/supergroup sizes.
 */
export type Grouping = {
  /** Cluster index of node `i`. */
  clusterOf(i: number): number;
  /** Supergroup index of node `i`. */
  superOf(i: number): number;
  /** Number of clusters. */
  clusters: number;
  /** Number of supergroups. */
  supers: number;
};

/** An `n x n` array of zero rows. */
function zeros(n: number): Float64Array[] {
  return Array.from({ length: n }, () => new Float64Array(n));
}

/**
 * Compute degrees, pi, and sqrtDeg from an adjacency matrix.
 * Mirrors `rebuild` (mixing-time-composer.html lines 155-165).
 */
function finalizeGraph(n: number, A: Float64Array[]): Graph {
  const deg = new Float64Array(n);
  let sumDeg = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) deg[i] += A[i][j];
    sumDeg += deg[i];
  }
  const pi = new Float64Array(n);
  const sqrtDeg = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    pi[i] = deg[i] / sumDeg;
    sqrtDeg[i] = Math.sqrt(deg[i]);
  }
  return { n, A, deg, pi, sqrtDeg };
}

/**
 * Build one of the named topologies at an arbitrary node count.
 * Generalizes `presetAdj` (mixing-time-composer.html lines 103-116), which was
 * hardcoded to N=12.
 */
export function buildGraph(t: Topology): Graph {
  const n = t.nodes;
  const A = zeros(n);
  const link = (i: number, j: number, w = 1) => {
    A[i][j] = w;
    A[j][i] = w;
  };

  switch (t.kind) {
    case "ring":
      for (let i = 0; i < n; i++) link(i, (i + 1) % n);
      break;

    case "complete":
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) link(i, j);
      break;

    case "bipartite":
      for (let i = 0; i < n; i += 2) for (let j = 1; j < n; j += 2) link(i, j);
      break;

    case "smallworld": {
      const w = t.bridgeWeight ?? 0.5;
      for (let i = 0; i < n; i++) link(i, (i + 1) % n);
      // Long-range chords across the ring diameter. Generalizes the N=12
      // hardcoded shortcuts (0,6),(3,9),(1,7) in the source prototype.
      const half = Math.floor(n / 2);
      const stride = Math.max(2, Math.floor(n / 3));
      for (let i = 0; i < half; i += stride) link(i, (i + half) % n, w);
      break;
    }

    case "clusters": {
      const w = t.bridgeWeight ?? 0.12;
      const h = Math.floor(n / 2);
      for (let i = 0; i < h; i++) for (let j = i + 1; j < h; j++) link(i, j);
      for (let i = h; i < n; i++) for (let j = i + 1; j < n; j++) link(i, j);
      link(h - 1, h, w); // weak bridge between the two dense clusters
      break;
    }
  }

  return finalizeGraph(n, A);
}

/**
 * Build a three-level metastable graph: clusters grouped into supergroups.
 * Intra-cluster edges are weight 1; clusters sharing a supergroup leak at
 * `leakCluster`; clusters in different supergroups leak at `leakSuper`.
 * Generalizes `makeHier` (convergence-suite.html lines 272-289).
 */
export function buildHierarchicalGraph(
  t: HierarchicalTopology,
): Graph & { grouping: Grouping } {
  const { clusters, perCluster, superGroups, leakCluster, leakSuper } = t;
  const n = clusters * perCluster;
  const clustersPerSuper = clusters / superGroups;
  const clusterOf = (i: number) => Math.floor(i / perCluster);
  const superOf = (i: number) => Math.floor(clusterOf(i) / clustersPerSuper);

  const A = zeros(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let w: number;
      if (clusterOf(i) === clusterOf(j)) w = 1;
      else if (superOf(i) === superOf(j)) w = leakCluster;
      else w = leakSuper;
      A[i][j] = w;
      A[j][i] = w;
    }
  }

  const base = finalizeGraph(n, A);
  return {
    ...base,
    grouping: { clusterOf, superOf, clusters, supers: superGroups },
  };
}
