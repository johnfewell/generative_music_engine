import { describe, expect, it } from "vitest";
import {
  fromCents,
  fromMidi,
  midiToFreq,
  pentatonicMinor,
  SELISIR,
  SLENDRO,
} from "./maps.js";

describe("midiToFreq", () => {
  it("A4 (69) is exactly 440 Hz", () => {
    expect(midiToFreq(69)).toBe(440);
  });

  it("an octave down (57) is 220 Hz", () => {
    expect(Math.abs(midiToFreq(57) - 220)).toBeLessThan(1e-9);
  });

  it("a semitone is the 12th root of 2", () => {
    expect(midiToFreq(70) / midiToFreq(69)).toBeCloseTo(Math.pow(2, 1 / 12), 12);
  });
});

describe("fromMidi", () => {
  it("maps each node to its MIDI frequency", () => {
    const notes = [48, 60, 72];
    const m = fromMidi(notes);
    expect(m.size).toBe(3);
    for (let i = 0; i < notes.length; i++) expect(m.freq(i)).toBe(midiToFreq(notes[i]));
  });

  it("uses provided labels when given", () => {
    const m = fromMidi([48, 51], ["C2", "Eb2"]);
    expect(m.label(0)).toBe("C2");
    expect(m.label(1)).toBe("Eb2");
  });
});

describe("pentatonicMinor", () => {
  it("reproduces the mixing-time-composer 12-note table from (48, 2.4)", () => {
    const expectedMidi = [48, 51, 53, 55, 58, 60, 63, 65, 67, 70, 72, 75];
    const m = pentatonicMinor(48, 2.4);
    expect(m.size).toBe(12);
    for (let i = 0; i < expectedMidi.length; i++) {
      expect(m.freq(i)).toBeCloseTo(midiToFreq(expectedMidi[i]), 9);
    }
  });

  it("repeats the [0,3,5,7,10] pattern every octave", () => {
    const m = pentatonicMinor(60, 1);
    // node 0 is the root, node 5 would be the octave (not present at octaves=1)
    expect(m.size).toBe(5);
    expect(m.freq(0)).toBe(midiToFreq(60));
    expect(m.freq(4)).toBe(midiToFreq(70));
  });
});

describe("fromCents (gamelan)", () => {
  it("exposes the two Balinese scale tables", () => {
    expect(SELISIR).toEqual([0, 120, 270, 670, 800]);
    expect(SLENDRO).toEqual([0, 231, 474, 717, 955]);
  });

  it("reproduces the gamelan file's selisir FREQ table (baseHz 210, octave 1205, 10 nodes)", () => {
    const baseHz = 210;
    const octaveCents = 1205;
    const m = fromCents({ baseHz, steps: SELISIR, octaveCents, count: 10 });
    expect(m.size).toBe(10);
    // independently recompute the closed form from the gamelan retune() formula
    for (let i = 0; i < 10; i++) {
      const cents = Math.floor(i / 5) * octaveCents + SELISIR[i % 5];
      const expected = baseHz * Math.pow(2, cents / 1200);
      expect(m.freq(i)).toBeCloseTo(expected, 9);
    }
    // hand anchors: node 0 is exactly baseHz; the stretched octave lands at
    // baseHz * 2^(1205/1200), strictly above a just octave (2x)
    expect(m.freq(0)).toBe(210);
    expect(m.freq(5)).toBeCloseTo(210 * Math.pow(2, 1205 / 1200), 9);
    expect(m.freq(5)).toBeGreaterThan(210 * 2);
  });

  it("defaults to a just 1200-cent octave", () => {
    const m = fromCents({ baseHz: 100, steps: [0], count: 3 });
    expect(m.freq(0)).toBe(100);
    expect(m.freq(1)).toBeCloseTo(200, 9);
    expect(m.freq(2)).toBeCloseTo(400, 9);
  });

  it("uses provided labels, falling back to cents past the end", () => {
    const m = fromCents({ baseHz: 210, steps: SELISIR, count: 10, labels: ["ding", "dong"] });
    expect(m.label(0)).toBe("ding");
    expect(m.label(1)).toBe("dong");
    expect(m.label(2)).toBe("270c");
  });
});
