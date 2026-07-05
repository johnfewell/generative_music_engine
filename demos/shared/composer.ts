// Shared harness for the composer demos: transport (play/stop/rebuild), the
// graph + spectrum render loop, and the controls every composer page has
// (topology, laziness, tempo, play, click-to-inject). Demo entry files stay
// pure wiring: pick a PitchMap and renderer options, add page-specific
// controls. Every bit of math still comes from `convergence/core`, all audio
// from `convergence/render/webaudio`, all scheduling from
// `convergence/conductor` — if a demo ever needed to reimplement any of that,
// the library would be missing something.

import {
  createMixingTimeEngine,
  estimateMixingTime,
  lazyLambda,
  mulberry32,
  tensionL1,
} from "convergence/core";
import type { Topology } from "convergence/core";
import type { PitchMap } from "convergence/pitch";
import { Conductor } from "convergence/conductor";
import { WebAudioRenderer } from "convergence/render/webaudio";
import type { WebAudioRendererOptions } from "convergence/render/webaudio";

/** Typed getElementById; demo pages own the matching markup. */
export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export type ComposerOptions = {
  /** Initial tuning. Its size fixes the node count for the page's lifetime. */
  pitchMap: PitchMap;
  /** Options for the renderer built on first play. Read at that moment, so
   *  mutating the object before first play (e.g. an ombak slider) is honored. */
  renderer?: WebAudioRendererOptions;
};

export type Composer = {
  /** The live conductor. Replaced by a topology rebuild — read, don't cache. */
  readonly conductor: Conductor;
  /** The renderer, once first play has created it. */
  readonly renderer: WebAudioRenderer | null;
  /** Retune live: notes emitted from now on use the new map; the walk, engine
   *  and scheduled times are untouched. Size must match the initial map. */
  setPitchMap(map: PitchMap): void;
};

export function mountComposer(opts: ComposerOptions): Composer {
  let pitchMap = opts.pitchMap;
  const N = pitchMap.size;

  const state = { alpha: 0.15, tempo: 4, topology: "smallworld" as Topology["kind"] };
  let ctx: AudioContext | null = null;
  let conductor = makeConductor();
  let renderer: WebAudioRenderer | null = null;
  let detach: (() => void) | null = null;
  let playing = false;
  let phraseCount = 0;

  // --- DOM ---
  const canvas = $("graph") as HTMLCanvasElement;
  const g2 = canvas.getContext("2d")!;
  const spectrumEl = $("spectrum");
  const phraseEl = $("phrase");
  const tensionValEl = $("tensionVal");
  const tensionBarEl = $("tensionBar");
  const tmixEl = $("tmix");
  const bars: HTMLElement[] = [];
  for (let k = 0; k < N; k++) {
    const b = document.createElement("i");
    spectrumEl.appendChild(b);
    bars.push(b);
  }

  function makeConductor(): Conductor {
    const engine = createMixingTimeEngine({
      topology: { kind: state.topology, nodes: N },
      alpha: state.alpha,
      seed: 7,
    });
    const c = new Conductor(engine, {
      tempoStepsPerSec: state.tempo,
      pitchMap,
      clock: () => (ctx ? ctx.currentTime : 0),
      rng: mulberry32(1234),
    });
    c.on("form", () => {
      phraseCount++;
      if (phraseEl) phraseEl.textContent = String(phraseCount);
    });
    return c;
  }

  /** Rebuild the whole chain for a new topology, preserving play state. */
  function rebuild(): void {
    const wasPlaying = playing;
    if (playing) stop();
    conductor = makeConductor();
    phraseCount = 0;
    if (phraseEl) phraseEl.textContent = "0";
    if (wasPlaying) play();
  }

  function play(): void {
    if (!ctx) ctx = new AudioContext();
    void ctx.resume();
    if (!renderer) renderer = new WebAudioRenderer(ctx, opts.renderer);
    detach = renderer.attach(conductor);
    conductor.start();
    playing = true;
    $("play").textContent = "⏸ stop";
  }

  function stop(): void {
    conductor.stop();
    detach?.();
    detach = null;
    playing = false;
    $("play").textContent = "▶ play";
  }

  // --- geometry ---
  function nodePos(i: number): { x: number; y: number } {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    return { x: 330 + Math.cos(a) * 165, y: 215 + Math.sin(a) * 165 };
  }

  // --- render loop (presentation only; reads live library state) ---
  function frame(): void {
    const engine = conductor.engine;
    const x = engine.x;
    const { A, pi } = engine.graph;
    const modes = engine.eig;

    // graph
    g2.clearRect(0, 0, canvas.width, canvas.height);
    g2.lineWidth = 1;
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        if (!A[i][j]) continue;
        const a = nodePos(i);
        const b = nodePos(j);
        g2.strokeStyle = `rgba(150,160,190,${Math.min(0.5, 0.12 + A[i][j] * 0.35)})`;
        g2.beginPath();
        g2.moveTo(a.x, a.y);
        g2.lineTo(b.x, b.y);
        g2.stroke();
      }
    }
    for (let i = 0; i < N; i++) {
      const p = nodePos(i);
      const r = 5 + Math.sqrt(Math.max(0, x[i])) * 46;
      g2.fillStyle = x[i] > pi[i] ? "#ff5d8f" : "#6cc5ff";
      g2.beginPath();
      g2.arc(p.x, p.y, r, 0, Math.PI * 2);
      g2.fill();
      g2.fillStyle = "#cdd0da";
      g2.font = "11px system-ui";
      g2.textAlign = "center";
      g2.fillText(pitchMap.label(i), p.x, p.y - r - 5);
    }

    // tension
    const T = tensionL1(x, pi);
    tensionValEl.textContent = T.toFixed(3);
    tensionBarEl.style.width = `${Math.min(100, T * 55)}%`;

    // mode spectrum (live in α over cached modes — no re-diagonalizing)
    for (let k = 0; k < N; k++) {
      const lam = lazyLambda(modes[k].l, state.alpha);
      const h = Math.min(100, Math.abs(lam) * 100);
      bars[k].style.height = `${h}%`;
      bars[k].style.background = lam < 0 ? "#ff5d8f" : "#6cc5ff";
      bars[k].style.opacity = k === 0 ? "1" : "0.75";
    }

    // mixing-time estimate
    const tm = estimateMixingTime(modes, state.alpha, N);
    tmixEl.textContent = Number.isFinite(tm) ? String(tm) : "∞";

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // --- controls ---
  $("play").addEventListener("click", () => (playing ? stop() : play()));

  ($("topology") as HTMLSelectElement).addEventListener("change", (e) => {
    state.topology = (e.target as HTMLSelectElement).value as Topology["kind"];
    rebuild();
  });

  ($("alpha") as HTMLInputElement).addEventListener("input", (e) => {
    state.alpha = parseFloat((e.target as HTMLInputElement).value);
    $("alphaVal").textContent = state.alpha.toFixed(2);
    conductor.alpha = state.alpha; // live, no rebuild — α only rescales the spectrum
  });

  ($("tempo") as HTMLInputElement).addEventListener("input", (e) => {
    state.tempo = parseFloat((e.target as HTMLInputElement).value);
    $("tempoVal").textContent = String(state.tempo);
    conductor.tempo = state.tempo;
  });

  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < N; i++) {
      const p = nodePos(i);
      const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    conductor.inject(best); // game -> music stinger
  });

  return {
    get conductor() {
      return conductor;
    },
    get renderer() {
      return renderer;
    },
    setPitchMap(map: PitchMap) {
      if (map.size !== N) throw new Error(`pitchMap size ${map.size} != node count ${N}`);
      pitchMap = map;
      conductor.pitchMap = map;
    },
  };
}
