import { describe, expect, it } from "vitest";
import { createMetastableEngine, mulberry32 } from "../core/index.js";
import { pentatonicMinor } from "../pitch/index.js";
import { Conductor } from "../conductor/index.js";
import type { NoteEvent } from "../conductor/index.js";
import { MOOD_MAP } from "./presets.js";
import { MoodSurface } from "./surface.js";

function makeClock(start = 0) {
  const state = { t: start };
  return { now: () => state.t, advance: (dt: number) => (state.t += dt) };
}

function setup() {
  const engine = createMetastableEngine({ seed: 7, alpha: 0.3 });
  const clock = makeClock(0);
  const conductor = new Conductor(engine, {
    tempoStepsPerSec: 4,
    pitchMap: pentatonicMinor(36, 3.2),
    clock: clock.now,
    rng: mulberry32(7),
    lookAheadSec: 1.2,
    setInterval: () => 0,
    clearInterval: () => {},
  });
  const surface = new MoodSurface(conductor);
  return { engine, clock, conductor, surface };
}

describe("MOOD_MAP", () => {
  it("maps the documented ranges", () => {
    expect(MOOD_MAP.alpha(1)).toBeCloseTo(0.95, 12);
    expect(MOOD_MAP.alpha(0)).toBe(0);
    expect(MOOD_MAP.leakCluster(0)).toBeCloseTo(0.005, 12);
    expect(MOOD_MAP.leakCluster(1)).toBeCloseTo(0.3, 12);
    expect(MOOD_MAP.leakSuper(0)).toBeCloseTo(0.001, 12);
    expect(MOOD_MAP.leakSuper(1)).toBeCloseTo(0.05, 12);
    expect(MOOD_MAP.velocityGain(0)).toBeCloseTo(0.5, 12);
    expect(MOOD_MAP.velocityGain(1)).toBeCloseTo(1.5, 12);
    expect(MOOD_MAP.ornamentProbability(1)).toBeCloseTo(0.6, 12);
    expect(MOOD_MAP.tempoMultiplier(0)).toBeCloseTo(0.8, 12);
    expect(MOOD_MAP.tempoMultiplier(1)).toBeCloseTo(1.3, 12);
  });
});

describe("MoodSurface glide", () => {
  it("glides alpha to <0.05 within 3 time constants, monotonically", () => {
    const { conductor, clock, surface } = setup();
    const glideSec = 2;
    surface.set({ patience: 0 }, { glideSec });

    const samples: { mt: number; alpha: number }[] = [];
    let musicalTime = 0;
    conductor.onStep((info) => {
      musicalTime += info.dt;
      samples.push({ mt: musicalTime, alpha: conductor.alpha });
    });

    conductor.start();
    for (let i = 0; i < 500 && musicalTime < 3 * glideSec + 2; i++) {
      conductor.pump();
      clock.advance(0.05);
    }

    // monotonically non-increasing
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].alpha).toBeLessThanOrEqual(samples[i - 1].alpha + 1e-12);
    }
    // below 0.05 by 3 time constants
    const at3tau = samples.find((s) => s.mt >= 3 * glideSec);
    expect(at3tau).toBeDefined();
    expect(at3tau!.alpha).toBeLessThan(0.05);
  });
});

describe("MoodSurface rebuild crossfade", () => {
  it("set({wander}) triggers exactly one rebuild with no melody gap", () => {
    const { engine, clock, conductor, surface } = setup();
    let rebuildCount = 0;
    const origRebuild = engine.rebuild.bind(engine);
    engine.rebuild = (leaks) => {
      rebuildCount++;
      origRebuild(leaks);
    };

    const melodyTimes: number[] = [];
    conductor.on("note", (e: NoteEvent) => {
      if (e.layer === "melody") melodyTimes.push(e.time);
    });

    conductor.start();
    for (let i = 0; i < 20; i++) {
      conductor.pump();
      clock.advance(0.1);
    }
    const fromIdx = melodyTimes.length;

    surface.set({ wander: 1 });
    expect(rebuildCount).toBe(1);

    // drive through the 8-step crossfade window and beyond
    for (let i = 0; i < 40; i++) {
      conductor.pump();
      clock.advance(0.1);
    }

    const window = melodyTimes.slice(fromIdx);
    expect(window.length).toBeGreaterThan(8); // steps kept flowing
    // a step duration is at most 1/(baseTempo*0.8); no gap may exceed two of them
    const maxStepDur = 1 / (4 * 0.8);
    let maxGap = 0;
    for (let i = 1; i < window.length; i++) {
      maxGap = Math.max(maxGap, window[i] - window[i - 1]);
    }
    expect(maxGap).toBeLessThanOrEqual(2 * maxStepDur + 1e-9);
  });
});

describe("MoodSurface presets", () => {
  it("round-trips preset('tense') -> preset('calm'); current() settles to targets", () => {
    const { clock, conductor, surface } = setup();
    conductor.start();

    surface.preset("tense");
    for (let i = 0; i < 300; i++) {
      conductor.pump();
      clock.advance(0.05);
    }
    surface.preset("calm");
    for (let i = 0; i < 500; i++) {
      conductor.pump();
      clock.advance(0.05);
    }

    const m = surface.current();
    expect(m.patience).toBeCloseTo(0.8, 2);
    expect(m.urgency).toBeCloseTo(0.1, 2);
    expect(m.wander).toBeCloseTo(0.15, 6); // wander is exact (applied on rebuild)
    expect(surface.currentHint().brightness).toBeCloseTo(0.3, 6);
  });
});
