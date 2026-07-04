// The chain "engine": the mutable bundle the conductor drives each beat. It is
// a pure core concept (graph + distribution + spectrum + step/inject), so it
// lives in core — the conductor consumes this interface, and the concrete
// engines (basic mixing-time, metastable) implement it without ever importing
// upward. Keeping the type here is what lets src/core/engines/* stay in-layer.

import { inject as injectMass, stepChain } from "./chain.js";
import type { Graph } from "./graph.js";
import { jacobi, symmetrizedMatrix } from "./spectral.js";
import type { Eigenpair } from "./spectral.js";

/**
 * A driveable chain. `step`/`inject` replace `x` (never mutate in place).
 * `graph`/`eig` are reassigned by engines that support rebuild(); the conductor
 * watches the `eig` reference to notice a structural change. A hierarchical
 * engine additionally carries a `grouping` (see the metastable engine).
 */
export interface Engine {
  graph: Graph;
  /** Laziness of the walk; live-settable through the conductor. */
  alpha: number;
  /** Current distribution; replaced (not mutated) by step/inject. */
  x: Float64Array;
  /** Eigenpairs of the symmetrized transition matrix, sorted by eigenvalue. */
  eig: Eigenpair[];
  /** Advance the chain one lazy step using the current alpha. */
  step(): void;
  /** Re-concentrate the distribution onto a node. */
  inject(node: number): void;
}

/** Build the basic single-scale engine from an already-built graph. */
export function createEngine(
  graph: Graph,
  opts: { alpha?: number; x0?: Float64Array } = {},
): Engine {
  const engine: Engine = {
    graph,
    alpha: opts.alpha ?? 0.15,
    x: opts.x0 ? Float64Array.from(opts.x0) : injectMass(graph, 0),
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
