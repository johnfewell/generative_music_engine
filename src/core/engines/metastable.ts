// Concrete engines. Both stay inside the core layer (zero deps, no audio, no
// timers, no Math.random — randomness only via the injected seed's mulberry32).
//
// The metastable engine is v1's flagship: nested weakly-coupled clusters make
// ONE random walk carry note-, phrase-, section- and movement-level form at
// once — the fix for Markov music's flat long-range structure. Ported from
// convergence-suite.html mode 5 `mMeta` (lines 710-745) and its helpers
// makeHier / hierStep / injectHier / tv3 (lines 272-322); the graph and metrics
// live in core already (buildHierarchicalGraph, tvHierarchical).

import { inject as injectMass, stepChain } from "../chain.js";
import type { Engine } from "../engine.js";
import { buildGraph, buildHierarchicalGraph } from "../graph.js";
import type { Grouping, Topology } from "../graph.js";
import { tvHierarchical } from "../metrics.js";
import type { HierarchicalTV } from "../metrics.js";
import { mulberry32 } from "../rng.js";
import { jacobi, symmetrizedMatrix } from "../spectral.js";

/**
 * A basic single-scale engine built from a named topology. Wraps buildGraph +
 * jacobi + stepChain + inject into the Engine interface. `seed` chooses the
 * starting node deterministically.
 */
export function createMixingTimeEngine(opts: {
  topology: Topology;
  alpha?: number;
  seed?: number;
}): Engine {
  const graph = buildGraph(opts.topology);
  const rng = mulberry32(opts.seed ?? 0);
  const start = Math.floor(rng() * graph.n);
  const engine: Engine = {
    graph,
    alpha: opts.alpha ?? 0.15,
    x: injectMass(graph, start),
    eig: jacobi(symmetrizedMatrix(graph)),
    step() {
      engine.x = stepChain(engine.graph, engine.x, engine.alpha);
    },
    inject(node: number) {
      engine.x = injectMass(engine.graph, node);
    },
  };
  return engine;
}

/** Leak weights between clusters (same supergroup) and across supergroups. */
export type Leaks = { cluster: number; super: number };

/** A hierarchical engine: an Engine plus its grouping and per-step TV reading. */
export interface MetastableEngine extends Engine {
  /** Per-node cluster/supergroup membership (drives the hierarchical metrics). */
  grouping: Grouping;
  /** Total variation at full / cluster / supergroup scales for the current x. */
  hierarchicalTV(): HierarchicalTV;
  /** Rebuild the graph with new leak weights, keeping the current x (renormalized). */
  rebuild(newLeaks: Partial<Leaks>): void;
}

export type MetastableOptions = {
  clusters?: number;
  perCluster?: number;
  superGroups?: number;
  leak?: Leaks;
  alpha?: number;
  seed?: number;
};

/**
 * The metastable engine. Clusters are grouped into supergroups; intra-cluster
 * edges are strong (weight 1) and the cluster/super leaks are weak, so mixing
 * happens at three separated timescales.
 *
 * PitchMap sizing / register mapping: drive this with a PitchMap of size
 * clusters*perCluster whose node index encodes cluster*perCluster + position,
 * so the cluster index selects an octave register (the `clPitch` idea from
 * convergence-suite.html lines 155-156). E.g. for the default 4x4 graph, a
 * 16-node map where nodes 0-3 are register 0, 4-7 register 1, etc.
 */
export function createMetastableEngine(opts: MetastableOptions = {}): MetastableEngine {
  const clusters = opts.clusters ?? 4;
  const perCluster = opts.perCluster ?? 4;
  const superGroups = opts.superGroups ?? 2;
  let leakCluster = opts.leak?.cluster ?? 0.05;
  let leakSuper = opts.leak?.super ?? 0.006;
  const rng = mulberry32(opts.seed ?? 0);

  const build = () =>
    buildHierarchicalGraph({ clusters, perCluster, superGroups, leakCluster, leakSuper });

  let built = build();
  const start = Math.floor(rng() * built.n);

  const engine: MetastableEngine = {
    graph: built,
    grouping: built.grouping,
    alpha: opts.alpha ?? 0.3,
    x: injectMass(built, start),
    eig: jacobi(symmetrizedMatrix(built)),
    step() {
      engine.x = stepChain(engine.graph, engine.x, engine.alpha);
    },
    inject(node: number) {
      engine.x = injectMass(engine.graph, node);
    },
    hierarchicalTV() {
      return tvHierarchical(engine.x, engine.graph.pi, engine.grouping);
    },
    rebuild(newLeaks: Partial<Leaks>) {
      if (newLeaks.cluster !== undefined) leakCluster = newLeaks.cluster;
      if (newLeaks.super !== undefined) leakSuper = newLeaks.super;
      built = build();
      engine.graph = built;
      engine.grouping = built.grouping;
      engine.eig = jacobi(symmetrizedMatrix(built)); // new array — conductor detects the change
      // node count is unchanged, so x stays valid; renormalize defensively so
      // sum(x) === 1 exactly
      let s = 0;
      for (let i = 0; i < engine.x.length; i++) s += engine.x[i];
      if (s > 0) for (let i = 0; i < engine.x.length; i++) engine.x[i] /= s;
    },
  };
  return engine;
}
