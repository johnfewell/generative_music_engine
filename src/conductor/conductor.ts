// The conductor: turns a chain engine into a scheduled stream of typed events.
//
// Two ideas are ported here:
//  1. WHAT happens per step — `beat()` from mixing-time-composer.html lines
//     214-266: advance the chain, sample a melody note from the sharpened
//     distribution (velocity following tension), sound the top-3 eigenmode pads,
//     and resolve a phrase when tension mixes below threshold -> cadence + reseed.
//  2. WHEN it happens — the look-ahead scheduler from tiny-planet-r185-duet.html
//     lines 1589-1616: emit events slightly in the future and, on a late wake
//     (hidden tab), RESYNC forward instead of firing a backlog of stale notes.
//
// Strict layer boundary: NO WebAudio, NO Tone.js, NO DOM. Time is read only
// through the injected `clock`; randomness only through the injected `rng`.

import {
  CrossingDetector,
  inject as injectMass,
  jacobi,
  lazyLambda,
  modeCoeffs,
  sampleNode,
  stepChain,
  symmetrizedMatrix,
  tensionL1,
} from "../core/index.js";
import type { Eigenpair, Graph, Rng } from "../core/index.js";
import type { PitchMap } from "../pitch/index.js";
import type { FormEvent, NoteEvent, TickEvent } from "./events.js";

/**
 * The layer-1 bundle the conductor drives. The basic chain (createEngine) and
 * the metastable engine (a later task) both implement this shape.
 */
export interface Engine {
  /** The graph (supplies pi / node count / sqrtDeg). */
  readonly graph: Graph;
  /** Laziness of the walk; live-settable through the conductor. */
  alpha: number;
  /** Current distribution; replaced (not mutated) by step/inject. */
  x: Float64Array;
  /** Eigenpairs of the symmetrized transition matrix, sorted by eigenvalue. */
  readonly eig: Eigenpair[];
  /** Advance the chain one lazy step using the current alpha. */
  step(): void;
  /** Re-concentrate the distribution onto a node. */
  inject(node: number): void;
}

/** Build the basic single-scale engine from a graph. */
export function createEngine(
  graph: Graph,
  opts: { alpha?: number; x0?: Float64Array } = {},
): Engine {
  return {
    graph,
    alpha: opts.alpha ?? 0.15,
    x: opts.x0 ? Float64Array.from(opts.x0) : injectMass(graph, 0),
    eig: jacobi(symmetrizedMatrix(graph)),
    step() {
      this.x = stepChain(this.graph, this.x, this.alpha);
    },
    inject(node: number) {
      this.x = injectMass(this.graph, node);
    },
  };
}

/** Injectable interval scheduler (defaults to the host's setInterval). */
type IntervalScheduler = (cb: () => void, ms: number) => unknown;
type IntervalCanceller = (handle: unknown) => void;

export type ConductorOptions = {
  /** Chain steps per second (musical tempo). Live-settable. */
  tempoStepsPerSec: number;
  /** Node-index -> frequency mapping. */
  pitchMap: PitchMap;
  /** Monotonic clock in seconds (e.g. AudioContext.currentTime or Tone.now). */
  clock: () => number;
  /** Seedable RNG; the sole source of randomness (keeps streams reproducible). */
  rng: Rng;
  /** Look-ahead horizon in seconds (default 1.2). */
  lookAheadSec?: number;
  /** Tension below which a phrase resolves (default 0.25). */
  phraseThreshold?: number;
  /** Pump cadence for the internal timer in ms (default 100). */
  pumpIntervalMs?: number;
  /** Override setInterval (tests pass a no-op and call pump() manually). */
  setInterval?: IntervalScheduler;
  /** Override clearInterval. */
  clearInterval?: IntervalCanceller;
};

type NoteListener = (e: NoteEvent) => void;
type FormListener = (e: FormEvent) => void;
type TickListener = (e: TickEvent) => void;

// A wake this far behind now means the host was asleep (hidden tab): resync
// forward rather than replay the backlog. Ported from the tiny-planet scheduler.
const RESYNC_LATE_SEC = 0.8;
const RESYNC_AHEAD_SEC = 0.2;

export class Conductor {
  private readonly pitchMap: PitchMap;
  private readonly clock: () => number;
  private readonly rng: Rng;
  private readonly lookAheadSec: number;
  private readonly phraseThreshold: number;
  private readonly pumpIntervalMs: number;
  private readonly scheduleInterval: IntervalScheduler | null;
  private readonly cancelInterval: IntervalCanceller | null;

  private readonly phraseDetector: CrossingDetector;
  private readonly noteListeners = new Set<NoteListener>();
  private readonly formListeners = new Set<FormListener>();
  private readonly tickListeners = new Set<TickListener>();

  private stepsPerSec: number;
  private started = false;
  private nextTime = 0;
  private phraseCount = 0;
  private timerHandle: unknown = null;

  constructor(
    private readonly engine: Engine,
    opts: ConductorOptions,
  ) {
    this.stepsPerSec = opts.tempoStepsPerSec;
    this.pitchMap = opts.pitchMap;
    this.clock = opts.clock;
    this.rng = opts.rng;
    this.lookAheadSec = opts.lookAheadSec ?? 1.2;
    this.phraseThreshold = opts.phraseThreshold ?? 0.25;
    this.pumpIntervalMs = opts.pumpIntervalMs ?? 100;
    this.phraseDetector = new CrossingDetector(this.phraseThreshold);
    const g = globalThis as unknown as {
      setInterval?: IntervalScheduler;
      clearInterval?: IntervalCanceller;
    };
    this.scheduleInterval = opts.setInterval ?? g.setInterval ?? null;
    this.cancelInterval = opts.clearInterval ?? g.clearInterval ?? null;
  }

  /** Steps per second; setting it retimes future steps immediately. */
  get tempo(): number {
    return this.stepsPerSec;
  }
  set tempo(v: number) {
    this.stepsPerSec = v;
  }

  /** Walk laziness (proxied to the engine). */
  get alpha(): number {
    return this.engine.alpha;
  }
  set alpha(v: number) {
    this.engine.alpha = v;
  }

  /** Subscribe to an event channel. Returns an unsubscribe function. */
  on(type: "note", cb: NoteListener): () => void;
  on(type: "form", cb: FormListener): () => void;
  on(type: "tick", cb: TickListener): () => void;
  on(type: "note" | "form" | "tick", cb: (e: never) => void): () => void {
    const set =
      type === "note"
        ? this.noteListeners
        : type === "form"
          ? this.formListeners
          : this.tickListeners;
    const listener = cb as never;
    (set as Set<unknown>).add(listener);
    return () => {
      (set as Set<unknown>).delete(listener);
    };
  }

  /** Begin scheduling. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.nextTime = this.clock();
    this.phraseDetector.reset();
    if (this.scheduleInterval) {
      this.timerHandle = this.scheduleInterval(() => this.pump(), this.pumpIntervalMs);
    }
  }

  /** Stop scheduling. Emitted-but-future events are the host's to honor or drop. */
  stop(): void {
    this.started = false;
    if (this.timerHandle !== null && this.cancelInterval) {
      this.cancelInterval(this.timerHandle);
    }
    this.timerHandle = null;
  }

  /** Game -> music stinger: re-concentrate the chain at a node right now. */
  inject(node: number): void {
    this.engine.inject(node);
    this.phraseDetector.reset();
  }

  /**
   * Run the look-ahead loop: emit every step whose time falls inside the
   * look-ahead window, advancing an internal clock on a fixed beat grid. Safe to
   * call at any cadence; a long gap between calls resyncs instead of bursting.
   */
  pump(): void {
    if (!this.started) return;
    const now = this.clock();
    const beat = 1 / this.stepsPerSec;

    if (this.nextTime < now - RESYNC_LATE_SEC) {
      this.nextTime = now + RESYNC_AHEAD_SEC; // woke up late: skip the backlog
    }

    while (this.started && this.nextTime < now + this.lookAheadSec) {
      // Clamp emission time to >= now so a small lag never schedules the past.
      this.emitStep(Math.max(this.nextTime, now), beat);
      this.nextTime += beat;
    }
  }

  /** One `beat()`: advance the chain and emit its melody / pads / form events. */
  private emitStep(time: number, beat: number): void {
    const eng = this.engine;
    eng.step();
    const x = eng.x;
    const pi = eng.graph.pi;
    const size = this.pitchMap.size;
    const T = tensionL1(x, pi);

    this.emitTick({ time, tension: T, x: Float64Array.from(x) });

    // --- melody: sample the sharpened distribution; louder at higher tension ---
    const note = sampleNode(x, this.rng, 1.4);
    const velocity = 0.1 + 0.3 * Math.min(1, T / 1.4);
    const pan = size > 1 ? (note / (size - 1)) * 1.4 - 0.7 : 0;
    this.emitNote({
      time,
      layer: "melody",
      node: note,
      freq: this.pitchMap.freq(note),
      velocity,
      duration: beat * 2.4,
      pan,
    });

    // --- ornament: a dense flourish half a beat later when tension runs high ---
    if (T > 1.1 && this.rng() < 0.5) {
      const n2 = Math.min(size - 1, note + (this.rng() < 0.5 ? 1 : 2));
      this.emitNote({
        time: time + beat * 0.5,
        layer: "ornament",
        node: n2,
        freq: this.pitchMap.freq(n2),
        velocity: velocity * 0.7,
        duration: beat * 1.5,
        pan: 0,
      });
    }

    // --- pads: the top-3 slowest eigenmodes, each decaying at its own rate ---
    const coeffs = modeCoeffs(x, eng.graph, eng.eig);
    const modes = eng.eig
      .map((e, k) => ({ k, e, lam: lazyLambda(e.l, eng.alpha), c: coeffs[k] }))
      .filter((m) => m.k > 0)
      .sort((a, b) => Math.abs(b.lam) - Math.abs(a.lam))
      .slice(0, 3);
    for (let mi = 0; mi < modes.length; mi++) {
      const m = modes[mi];
      const amp = Math.abs(m.c);
      if (amp < 0.05) continue;
      // The strongest same-sign eigenvector components (the sign of c picks the
      // pole, so bipartite modes audibly alternate).
      const side = Math.sign(m.c);
      const comps = m.e.v
        .map((v, i) => ({ i, s: v * side }))
        .filter((o) => o.s > 0.12)
        .sort((a, b) => b.s - a.s)
        .slice(0, 2);
      for (let ci = 0; ci < comps.length; ci++) {
        const cm = comps[ci];
        this.emitNote({
          time,
          layer: "pad",
          node: cm.i,
          freq: this.pitchMap.freq(cm.i) * 2 * (1 + 0.001 * mi), // octave up + detune
          velocity: Math.min(0.09, amp * 0.28) * (ci ? 0.6 : 1),
          duration: beat * 3.5,
          pan: mi === 0 ? -0.3 : 0.3,
        });
      }
    }

    // --- phrase: resolved when the walk mixes below threshold -> cadence + reseed ---
    if (this.phraseDetector.update(T)) {
      this.phraseCount++;
      const target = Math.floor(this.rng() * size);
      this.emitNote({
        time,
        layer: "cadence",
        node: target,
        freq: this.pitchMap.freq(target) * 0.5, // cadence one octave down
        velocity: 0.3,
        duration: 1.2,
        pan: 0,
      });
      eng.inject(target); // re-concentrate before announcing, so listeners see the reseed
      this.emitForm({ time, kind: "phraseResolved", count: this.phraseCount });
    }
  }

  private emitNote(e: NoteEvent): void {
    for (const cb of this.noteListeners) cb(e);
  }
  private emitForm(e: FormEvent): void {
    for (const cb of this.formListeners) cb(e);
  }
  private emitTick(e: TickEvent): void {
    for (const cb of this.tickListeners) cb(e);
  }
}
