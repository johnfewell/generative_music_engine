import { describe, expect, it } from "vitest";
import { buildGraph, mulberry32 } from "../core/index.js";
import { pentatonicMinor } from "../pitch/index.js";
import { Conductor, createEngine } from "./conductor.js";
import type { FormEvent, NoteEvent } from "./events.js";

/** A manually advanced fake clock in seconds. */
function makeClock(start = 0) {
  const state = { t: start };
  return {
    now: () => state.t,
    advance: (dt: number) => {
      state.t += dt;
    },
    set: (v: number) => {
      state.t = v;
    },
  };
}

const LOOK_AHEAD = 1.2;

function makeConductor(opts: { tempo?: number; seed?: number; kind?: "ring" | "clusters" } = {}) {
  const graph = buildGraph({ kind: opts.kind ?? "ring", nodes: 12 });
  const engine = createEngine(graph, { alpha: 0.15 });
  const clock = makeClock(1000);
  const conductor = new Conductor(engine, {
    tempoStepsPerSec: opts.tempo ?? 4,
    pitchMap: pentatonicMinor(48, 2.4),
    clock: clock.now,
    rng: mulberry32(opts.seed ?? 42),
    lookAheadSec: LOOK_AHEAD,
    // disable the real timer; the tests drive pump() by hand
    setInterval: () => 0,
    clearInterval: () => {},
  });
  return { conductor, engine, clock };
}

describe("Conductor scheduling", () => {
  it("emits events at or after the clock, monotonically ordered per layer", () => {
    const { conductor, clock } = makeConductor();
    const lastPerLayer: Record<string, number> = {};
    let nowAtPump = 0;
    let count = 0;
    conductor.on("note", (e) => {
      count++;
      expect(e.time).toBeGreaterThanOrEqual(nowAtPump - 1e-9);
      if (e.layer in lastPerLayer) {
        expect(e.time).toBeGreaterThanOrEqual(lastPerLayer[e.layer] - 1e-9);
      }
      lastPerLayer[e.layer] = e.time;
    });
    conductor.start();
    for (let i = 0; i < 200; i++) {
      nowAtPump = clock.now();
      conductor.pump();
      clock.advance(0.05);
    }
    expect(count).toBeGreaterThan(0);
  });

  it("emits ~tempo*seconds melody notes", () => {
    const tempo = 5;
    const { conductor, clock } = makeConductor({ tempo });
    const melodyTimes: number[] = [];
    conductor.on("note", (e) => {
      if (e.layer === "melody") melodyTimes.push(e.time);
    });
    conductor.start();
    const startNow = clock.now();
    for (let i = 0; i < 400; i++) {
      conductor.pump();
      clock.advance(0.025); // 400 * 0.025 = 10 simulated seconds
    }
    const played = melodyTimes.filter((t) => t < startNow + 10).length;
    expect(Math.abs(played - tempo * 10)).toBeLessThanOrEqual(1);
  });

  it("resolves exactly one phrase with a cadence and reseed", () => {
    const { conductor, engine, clock } = makeConductor({ tempo: 4 });
    const forms: FormEvent[] = [];
    const notes: NoteEvent[] = [];
    let xMaxAtPhrase = 0;
    conductor.on("form", (e) => {
      forms.push(e);
      xMaxAtPhrase = Math.max(...engine.x);
    });
    conductor.on("note", (e) => notes.push(e));
    conductor.start();
    for (let i = 0; i < 3000 && forms.length === 0; i++) {
      conductor.pump();
      clock.advance(0.05);
    }
    expect(forms.length).toBe(1);
    expect(forms[0].kind).toBe("phraseResolved");
    expect(forms[0].count).toBe(1);

    // a cadence note accompanies the resolution, at the same time
    const cadences = notes.filter((n) => n.layer === "cadence");
    expect(cadences.length).toBe(1);
    expect(cadences[0].time).toBeCloseTo(forms[0].time, 9);

    // the chain was re-concentrated (inject puts 0.7 on the target node)
    expect(xMaxAtPhrase).toBeGreaterThanOrEqual(0.7 - 1e-9);
  });

  it("resyncs on a late wake instead of bursting a backlog", () => {
    const tempo = 4;
    const { conductor, clock } = makeConductor({ tempo });
    const allTimes: number[] = [];
    const melodyTimes: number[] = []; // one per step, so this measures step count
    conductor.on("note", (e) => {
      allTimes.push(e.time);
      if (e.layer === "melody") melodyTimes.push(e.time);
    });
    conductor.start();
    conductor.pump(); // normal fill of the look-ahead window
    allTimes.length = 0;
    melodyTimes.length = 0;

    clock.advance(5); // tab was hidden for 5 seconds
    const now = clock.now();
    conductor.pump();

    // no burst: step count bounded by the look-ahead window, not 5s of steps
    const maxWindowSteps = Math.ceil(LOOK_AHEAD * tempo) + 1;
    expect(melodyTimes.length).toBeGreaterThan(0);
    expect(melodyTimes.length).toBeLessThanOrEqual(maxWindowSteps);
    // every emitted event is in the future of the new now
    for (const t of allTimes) expect(t).toBeGreaterThanOrEqual(now - 1e-9);
    // step times land inside the look-ahead window
    for (const t of melodyTimes) expect(t).toBeLessThanOrEqual(now + LOOK_AHEAD + 1e-9);
    expect(Math.min(...melodyTimes)).toBeLessThanOrEqual(now + LOOK_AHEAD);
  });

  it("is deterministic for a given seed and clock script", () => {
    const run = (seed: number) => {
      // ring mixes at a medium rate: tension starts high and crosses below
      // threshold around step ~13, so phrases resolve within the run and form
      // events get exercised for determinism too. (A complete graph mixes so
      // fast that tension is already below threshold at the first observed step,
      // so no downward crossing is ever seen — see the topology sweep.)
      const graph = buildGraph({ kind: "ring", nodes: 12 });
      const engine = createEngine(graph);
      const clock = makeClock(0);
      const conductor = new Conductor(engine, {
        tempoStepsPerSec: 4,
        pitchMap: pentatonicMinor(48, 2.4),
        clock: clock.now,
        rng: mulberry32(seed),
        lookAheadSec: LOOK_AHEAD,
        setInterval: () => 0,
        clearInterval: () => {},
      });
      const notes: NoteEvent[] = [];
      const forms: FormEvent[] = [];
      const ticks: { time: number; tension: number; x: number[] }[] = [];
      conductor.on("note", (e) => notes.push(e));
      conductor.on("form", (e) => forms.push(e));
      conductor.on("tick", (e) => ticks.push({ time: e.time, tension: e.tension, x: Array.from(e.x) }));
      conductor.start();
      for (let i = 0; i < 300; i++) {
        conductor.pump();
        clock.advance(0.05);
      }
      return { notes, forms, ticks };
    };

    const a = run(7);
    const b = run(7);
    expect(a.notes).toEqual(b.notes);
    expect(a.forms).toEqual(b.forms);
    expect(a.ticks).toEqual(b.ticks);
    expect(a.forms.length).toBeGreaterThan(0); // the run actually did something

    const c = run(8);
    expect(c.notes).not.toEqual(a.notes);
  });

  it("live tempo and alpha setters proxy through to timing and the engine", () => {
    const { conductor, engine } = makeConductor();
    conductor.tempo = 8;
    expect(conductor.tempo).toBe(8);
    conductor.alpha = 0.4;
    expect(conductor.alpha).toBe(0.4);
    expect(engine.alpha).toBe(0.4);
  });

  it("invokes the default global timer with the global as receiver", () => {
    // Reproduce the browser's "Illegal invocation" guard: setInterval /
    // clearInterval are not generic and throw if `this` isn't the global.
    const realSI = globalThis.setInterval;
    const realCI = globalThis.clearInterval;
    let scheduled = 0;
    let cleared = 0;
    globalThis.setInterval = function (this: unknown): number {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      scheduled++;
      return 42;
    } as unknown as typeof realSI;
    globalThis.clearInterval = function (this: unknown): void {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      cleared++;
    } as unknown as typeof realCI;
    try {
      const engine = createEngine(buildGraph({ kind: "ring", nodes: 12 }));
      const clock = makeClock(0);
      // no setInterval override -> exercises the default global path
      const c = new Conductor(engine, {
        tempoStepsPerSec: 4,
        pitchMap: pentatonicMinor(48, 2.4),
        clock: clock.now,
        rng: mulberry32(1),
      });
      expect(() => c.start()).not.toThrow();
      expect(scheduled).toBe(1);
      expect(() => c.stop()).not.toThrow();
      expect(cleared).toBe(1);
    } finally {
      globalThis.setInterval = realSI;
      globalThis.clearInterval = realCI;
    }
  });
});
