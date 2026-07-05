// Gamelan composer on the library. The shared harness (../shared/composer)
// owns transport, controls and the render loop; this file wires only what
// makes the gamelan demo distinct: a cents-based PitchMap with gamelan labels,
// live scale retuning through `conductor.pitchMap`, and the ombak control.

import { fromCents, SELISIR, SLENDRO } from "convergence/pitch";
import { $, mountComposer } from "../shared/composer";

const SCALES = { selisir: SELISIR, slendro: SLENDRO };
const NAMES = ["ding", "dong", "deng", "dung", "dang"];
const COUNT = 10; // two stretched octaves of the 5-tone scale
const LABELS = Array.from({ length: COUNT }, (_, i) => NAMES[i % 5] + (i < 5 ? "" : "ʼ"));

const tuning = (scale: keyof typeof SCALES) =>
  fromCents({ baseHz: 210, steps: SCALES[scale], octaveCents: 1205, count: COUNT, labels: LABELS });

// Shared with the harness: the ombak slider may move before first play, and the
// renderer reads this object when it is built.
const rendererOptions = { gain: 0.4, ombakHz: 5 };
const composer = mountComposer({ pitchMap: tuning("selisir"), renderer: rendererOptions });

($("scale") as HTMLSelectElement).addEventListener("change", (e) => {
  // retune the PitchMap only — the walk keeps running, engine untouched
  composer.setPitchMap(tuning((e.target as HTMLSelectElement).value as keyof typeof SCALES));
});

($("ombak") as HTMLInputElement).addEventListener("input", (e) => {
  const v = parseFloat((e.target as HTMLInputElement).value);
  $("ombakVal").textContent = v.toFixed(1);
  rendererOptions.ombakHz = v;
  if (composer.renderer) composer.renderer.ombakHz = v; // live, no renderer rebuild
});
