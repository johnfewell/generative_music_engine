// Tone.js renderer for the tiny-planet demo — the "bring your own audio" path:
// it consumes the conductor's typed event stream directly and never touches
// convergence/render/webaudio. Instruments and voicing are ported from
// tiny-planet-r185-duet.html `buildToneRig` (lines 1522-1561): an AM pad
// behind a slow-drifting lowpass, two panned FM duet voices into a feedback
// delay, and a sine MonoSynth bass. Scheduling stays in the library.
//
// The duet: voice A sings the conductor's melody events; voice B draws its own
// note from the SAME live distribution (the tick snapshot) with its own seeded
// rng. Right after an inject the walk is concentrated, so the draws agree and
// the voices sing in unison; as the chain relaxes toward stationarity they
// drift apart. The prototype faked this convergence with a coupled pair of
// walkers — here it falls out of the chain itself.

import * as Tone from "tone";
import { mulberry32, sampleNode } from "convergence/core";
import type { Conductor, NoteEvent } from "convergence/conductor";

/** Melody timbres: electric piano by day, music box by night (prototype 1604-1609). */
const DAY_MEL = { harmonicity: 2, modulationIndex: 7, envelope: { release: 1.6 } };
const NIGHT_MEL = { harmonicity: 3.5, modulationIndex: 11, envelope: { release: 2.4 } };

export type TinyPlanetRig = {
  /** Day/night factor 0..1: swaps melody timbre, lifts an octave, hushes. */
  setNight(f: number): void;
  /** Mood brightness hint 0..1 -> pad filter drift range (dim night, open day). */
  setBrightness(b: number): void;
  /** Star collected: a small rising two-note fanfare. */
  pickup(): void;
  /** Probability planted at a node: a soft blip at that node's pitch. */
  plant(freq: number): void;
  /** Unsubscribe from the conductor. Instruments stay alive (demo never tears down). */
  detach(): void;
};

/** Build the instruments and subscribe to a conductor. Call after Tone.start(). */
export function buildRig(conductor: Conductor): TinyPlanetRig {
  const beat = 1 / conductor.tempo;

  // --- master chain: music bus -> reverb -> destination ---
  const musicVol = new Tone.Gain(0.9);
  const verb = new Tone.Reverb({ decay: 4.5, wet: 0.32 });
  musicVol.connect(verb);
  verb.toDestination();

  // --- pad: AM polysynth behind a lowpass whose cutoff drifts tape-slow ---
  const padFilter = new Tone.Filter(1500, "lowpass");
  padFilter.connect(musicVol);
  const padLfo = new Tone.LFO(0.05, 900, 2100);
  padLfo.connect(padFilter.frequency);
  padLfo.start();
  const pad = new Tone.PolySynth(Tone.AMSynth);
  pad.set({
    harmonicity: 1.01,
    oscillator: { type: "triangle" },
    modulation: { type: "sine" },
    envelope: { attack: 0.9, decay: 0.5, sustain: 0.55, release: 3.5 },
    modulationEnvelope: { attack: 1.2, decay: 0.6, sustain: 0.4, release: 3 },
  });
  pad.volume.value = -17;
  pad.connect(padFilter);

  // --- duet: two FM voices, panned apart, sharing a feedback delay ---
  const melDelay = new Tone.FeedbackDelay(beat * 0.75, 0.34);
  melDelay.connect(musicVol);
  const mkMel = () => {
    const s = new Tone.FMSynth();
    s.set({
      ...DAY_MEL,
      oscillator: { type: "sine" },
      modulation: { type: "sine" },
      envelope: { attack: 0.015, decay: 0.5, sustain: 0.15, ...DAY_MEL.envelope },
      modulationEnvelope: { attack: 0.02, decay: 0.4, sustain: 0.1, release: 1 },
    });
    s.volume.value = -17;
    return s;
  };
  const melA = mkMel();
  const melB = mkMel();
  const panA = new Tone.Panner(-0.55);
  const panB = new Tone.Panner(0.55);
  melA.connect(panA);
  melB.connect(panB);
  panA.connect(melDelay);
  panA.connect(musicVol);
  panB.connect(melDelay);
  panB.connect(musicVol);

  // --- bass: sine MonoSynth for cadences (movement resolutions) ---
  const bass = new Tone.MonoSynth();
  bass.set({
    oscillator: { type: "sine" },
    envelope: { attack: 0.02, decay: 0.5, sustain: 0.4, release: 1.2 },
    filterEnvelope: { attack: 0.02, baseFrequency: 220, octaves: 1 },
  });
  bass.volume.value = -13;
  bass.connect(musicVol);

  // --- bells: triangle chimes for section bells / star pickups ---
  const bells = new Tone.PolySynth(Tone.Synth);
  bells.set({
    oscillator: { type: "triangle" },
    envelope: { attack: 0.01, decay: 0.4, sustain: 0, release: 1.4 },
  });
  bells.volume.value = -18;
  bells.connect(musicVol);

  // --- state ---
  let nightF = 0;
  let nightTimbre = false;
  const rngB = mulberry32(99); // voice B's private randomness; A's lives in the conductor
  let lastX: Float64Array | null = null;
  let wasUnison = false;
  let lastChimeAt = -Infinity;
  let lastMelodyFreq = 220;

  // Never schedule into the past: a hair after now, like the prototype (1601).
  const t0 = (t: number) => Math.max(t, Tone.now() + 0.02);
  const night = () => nightF > 0.6;

  function applyMelTimbre(): void {
    if (night() === nightTimbre) return;
    nightTimbre = night();
    const s = nightTimbre ? NIGHT_MEL : DAY_MEL;
    melA.set(s);
    melB.set(s);
  }

  function playDuet(e: NoteEvent): void {
    applyMelTimbre();
    const time = t0(e.time);
    const oct = night() ? 2 : 1; // the music box sings an octave up
    const hush = night() ? 0.65 : 1;
    lastMelodyFreq = e.freq * oct;
    melA.triggerAttackRelease(e.freq * oct, e.duration, time, Math.min(1, e.velocity * hush));

    if (!lastX) return;
    const size = conductor.pitchMap.size;
    const nodeB = sampleNode(lastX, rngB, 1.4);
    const gap = Math.abs(nodeB - e.node);
    // wider gap -> more urgent (prototype 1494), scaled onto the event velocity
    const velB = Math.min(1, e.velocity * (0.7 + 0.6 * (gap / Math.max(1, size - 1))) * hush);
    const freqB = conductor.pitchMap.freq(nodeB) * oct;
    melB.triggerAttackRelease(freqB, e.duration, time + 0.012, velB);

    // coalescence: both voices drew the same node — soft tonic chime, throttled
    const unison = nodeB === e.node;
    if (unison && !wasUnison && time - lastChimeAt > 3) {
      lastChimeAt = time;
      pad.triggerAttackRelease([e.freq * 2, e.freq * 4], beat * 3.2, time, 0.16);
    }
    wasUnison = unison;
  }

  const offNote = conductor.on("note", (e) => {
    switch (e.layer) {
      case "melody":
        playDuet(e);
        break;
      case "ornament":
        melA.triggerAttackRelease(
          e.freq * (night() ? 2 : 1),
          e.duration,
          t0(e.time),
          Math.min(1, e.velocity),
        );
        break;
      case "pad":
        // conductor pad velocities are scaled for the raw-oscillator renderer;
        // the AM synth sits at -17 dB, so open them up (cap well under clip)
        pad.triggerAttackRelease(e.freq, e.duration, t0(e.time), Math.min(0.6, e.velocity * 4));
        break;
      case "cadence":
        bass.triggerAttackRelease(e.freq, e.duration, t0(e.time), 0.8);
        break;
    }
  });

  // tick precedes the step's notes in the conductor, so this snapshot is the
  // exact distribution the melody was drawn from
  const offTick = conductor.on("tick", (e) => {
    lastX = e.x;
  });

  const offForm = conductor.on("form", (e) => {
    const time = t0(e.time);
    if (e.kind === "phraseResolved") {
      // the phrase settling: a low-key dyad over the last melody pitch
      pad.triggerAttackRelease([lastMelodyFreq, lastMelodyFreq * 2], beat * 2.4, time, 0.12);
    } else if (e.kind === "sectionResolved") {
      // journey bell (prototype 1771-1774): G4 then D5, softly rung
      bells.triggerAttackRelease(392.0, 1.0, time, 0.35);
      bells.triggerAttackRelease(587.33, 1.2, time + 0.2, 0.3);
    } else {
      // movement: the conductor already cadences the bass; add a slow shimmer
      for (let i = 0; i < 3; i++) {
        bells.triggerAttackRelease(1400 + i * 380, 0.5, time + 0.25 + i * 0.18, 0.16);
      }
    }
  });

  return {
    setNight(f: number) {
      nightF = f;
    },
    setBrightness(b: number) {
      // shift the drift range, never ramp an LFO-driven signal (prototype 1745)
      padLfo.min = 380 + 520 * b;
      padLfo.max = 900 + 1200 * b;
    },
    pickup() {
      const now = Tone.now();
      bells.triggerAttackRelease(523.25, 0.3, now + 0.02, 0.4);
      bells.triggerAttackRelease(783.99, 0.4, now + 0.11, 0.35);
    },
    plant(freq: number) {
      bells.triggerAttackRelease(freq * 2, 0.35, Tone.now() + 0.02, 0.25);
    },
    detach() {
      offNote();
      offTick();
      offForm();
    },
  };
}
