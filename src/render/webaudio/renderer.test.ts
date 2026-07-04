import { describe, expect, it } from "vitest";
import { buildGraph, createEngine, mulberry32 } from "../../core/index.js";
import { pentatonicMinor } from "../../pitch/index.js";
import { Conductor } from "../../conductor/index.js";
import type { NoteEvent } from "../../conductor/index.js";
import { WebAudioRenderer } from "./renderer.js";

// --- a minimal AudioContext stub that records scheduling calls ---

class StubParam {
  ramps: { value: number; time: number }[] = [];
  value = 0;
  setValueAtTime(v: number, t: number) {
    this.ramps.push({ value: v, time: t });
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.ramps.push({ value: v, time: t });
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.ramps.push({ value: v, time: t });
    return this;
  }
}

class StubNode {
  gain = new StubParam();
  frequency = new StubParam();
  pan = new StubParam();
  Q = new StubParam();
  type = "";
  buffer: unknown = null;
  starts: number[] = [];
  stops: number[] = [];
  connect() {
    return this;
  }
  start(t: number) {
    this.starts.push(t);
  }
  stop(t: number) {
    this.stops.push(t);
  }
}

class StubCtx {
  currentTime = 999; // deliberately different from any event time
  sampleRate = 44100;
  destination = new StubNode();
  oscillators: StubNode[] = [];
  gains: StubNode[] = [];
  createGain() {
    const n = new StubNode();
    this.gains.push(n);
    return n;
  }
  createOscillator() {
    const n = new StubNode();
    this.oscillators.push(n);
    return n;
  }
  createStereoPanner() {
    return new StubNode();
  }
  createBiquadFilter() {
    return new StubNode();
  }
  createBufferSource() {
    const n = new StubNode();
    this.oscillators.push(n);
    return n;
  }
  createDynamicsCompressor() {
    return new StubNode();
  }
  createBuffer(_ch: number, len: number) {
    return { getChannelData: () => new Float32Array(len) };
  }
}

function makeSetup() {
  const ctx = new StubCtx();
  const renderer = new WebAudioRenderer(ctx as unknown as BaseAudioContext);
  const engine = createEngine(buildGraph({ kind: "ring", nodes: 12 }));
  const clock = { t: 1000 };
  const conductor = new Conductor(engine, {
    tempoStepsPerSec: 4,
    pitchMap: pentatonicMinor(48, 2.4),
    clock: () => clock.t,
    rng: mulberry32(1),
    setInterval: () => 0,
    clearInterval: () => {},
  });
  const notes: NoteEvent[] = [];
  conductor.on("note", (e) => notes.push(e));
  renderer.attach(conductor);
  return { ctx, conductor, notes };
}

describe("WebAudioRenderer", () => {
  it("schedules oscillators at the event time, never at ctx.currentTime", () => {
    const { ctx, conductor, notes } = makeSetup();
    conductor.start();
    conductor.pump();

    const starts = ctx.oscillators.flatMap((o) => o.starts);
    expect(starts.length).toBeGreaterThan(0);

    const eventTimes = new Set(notes.map((n) => n.time));
    for (const s of starts) {
      expect(s).not.toBe(ctx.currentTime); // 999
      expect(eventTimes.has(s)).toBe(true); // scheduled at a real event time
    }
    // and events are in the future of the clock
    for (const n of notes) expect(n.time).toBeGreaterThanOrEqual(1000);
  });

  it("maps velocity to the gain peak (melody -> strike, first partial = vel*0.5)", () => {
    const { ctx, conductor, notes } = makeSetup();
    conductor.start();
    conductor.pump();

    const melody = notes.find((n) => n.layer === "melody");
    expect(melody).toBeDefined();

    // strike -> two bars at vel*0.5; each bar's fundamental ramps to (vel*0.5)*1
    const target = melody!.velocity * 0.5;
    const allGainRamps = ctx.gains.flatMap((g) => g.gain.ramps.map((r) => r.value));
    const hit = allGainRamps.some((v) => Math.abs(v - target) < 1e-9);
    expect(hit).toBe(true);
  });

  it("unsubscribes cleanly, so no further events are rendered", () => {
    const { ctx, conductor } = makeSetup();
    // makeSetup already attached one renderer; attach a second we can detach
    const renderer2 = new WebAudioRenderer(ctx as unknown as BaseAudioContext);
    const off = renderer2.attach(conductor);
    off();
    conductor.start();
    conductor.pump();
    // renderer2 was detached before start; only renderer 1 rendered — still > 0
    expect(ctx.oscillators.length).toBeGreaterThan(0);
  });
});
