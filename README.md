# convergence

A generative music engine driven by Markov chain convergence.

Music emerges from a lazy random walk on a graph: melody notes are sampled from
the walk's probability distribution, harmonic pads follow its slowest
eigenmodes, and musical **tension** is the distance between the current
distribution and the stationary one. When the chain mixes (tension falls below
a threshold), the phrase resolves with a cadence and the walk is re-seeded —
form is literally convergence.

## Run the demos

Requires Node ≥ 18 and a browser (WebAudio needs a click to start).

```sh
npm install
npm run demo
```

Then open the printed URL (default http://localhost:5173/):

- **/mixing-time/** — the composer on a 12-note minor-pentatonic ear. Change
  the graph topology and hear how fast/slow-mixing structures compose
  differently; α (laziness) and tempo are live; click a node to inject
  probability there as a stinger.
- **/gamelan/** — the same engine retuned to a 10-node Balinese scale with a
  stretched 1205-cent octave. Switch selisir ↔ slendro while it plays, and
  control the ombak (paired-detune beating) in Hz.
- **/renderer-smoke.html** — minimal renderer check.

The demos are served straight from `src/` via vite aliases — no build step.

## Use the library

```ts
import { createMixingTimeEngine, mulberry32 } from "convergence/core";
import { pentatonicMinor } from "convergence/pitch";
import { Conductor } from "convergence/conductor";
import { WebAudioRenderer } from "convergence/render/webaudio";

const engine = createMixingTimeEngine({
  topology: { kind: "smallworld", nodes: 12 }, // ring | complete | bipartite | smallworld | clusters
  alpha: 0.15, // walk laziness
  seed: 7,
});

const ctx = new AudioContext();
const conductor = new Conductor(engine, {
  tempoStepsPerSec: 4,
  pitchMap: pentatonicMinor(48, 2.4), // node index -> frequency
  clock: () => ctx.currentTime, // the conductor never touches wall time itself
  rng: mulberry32(1234), // sole randomness source: runs are reproducible
});

const renderer = new WebAudioRenderer(ctx, { gain: 0.4 });
const detach = renderer.attach(conductor);
conductor.start();
```

Everything musical is live-settable — no rebuilds:

```ts
conductor.tempo = 8; // steps per second
conductor.alpha = 0.4; // laziness; rescales the spectrum, walk continues
conductor.pitchMap = fromCents({
  // retune mid-phrase; the walk is untouched
  baseHz: 210,
  steps: SLENDRO,
  octaveCents: 1205,
  count: 10,
  labels: ["ding", "dong", "deng", "dung", "dang" /* … */],
});
conductor.inject(3); // game event -> re-concentrate the walk at a node
renderer.ombakHz = 5; // gamelan paired-voice beating
```

### Bring your own audio

The WebAudio renderer is optional. A game (or any host) can consume the typed
event stream directly and skip `convergence/render/webaudio` entirely:

```ts
conductor.on("note", (e) => {
  // { time, layer: "melody" | "ornament" | "pad" | "cadence",
  //   node, freq, velocity, duration, pan }
});
conductor.on("form", (e) => {
  // { time, kind: "phraseResolved" | "sectionResolved" | "movementResolved", count }
});
conductor.on("tick", (e) => {
  // { time, tension, x } — one per chain step, for visualization
});
```

Events are emitted ahead of time by a look-ahead scheduler (default 1.2 s), so
they can be sample-accurately scheduled by the host. A hidden tab resyncs
forward instead of bursting a backlog on wake.

## Modules

Each layer is a subpath import; take only what you need.

| Module                        | What it holds                                                                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `convergence/core`            | Seedable RNG, graph builders, lazy Markov step, Jacobi eigensolver, spectral helpers (`estimateMixingTime`, `lazyLambda`), tension/TV metrics, engines (mixing-time, metastable)          |
| `convergence/pitch`           | `PitchMap` interface and builders: `fromMidi`, `pentatonicMinor`, `fromCents` (microtonal/gamelan, stretched octaves, custom labels), `SELISIR`/`SLENDRO` tables                          |
| `convergence/conductor`       | The look-ahead scheduler: turns an engine into typed `note`/`form`/`tick` events; live tempo/alpha/pitchMap; `inject()` stingers                                                          |
| `convergence/mood`            | `MoodSurface`: maps a small mood vector (patience / wander / urgency) plus presets onto engine + conductor parameters, gliding or rebuild-crossfading between them                        |
| `convergence/render/webaudio` | Optional batteries-included renderer: strike/bar/gong instrument palette, compressor master chain, gamelan ombak detune                                                                   |

The hierarchical (metastable) engine — `createMetastableEngine` — nests
clusters inside supergroups; the conductor then resolves **phrases** (cluster
mixing), **sections** (supergroup mixing) and **movements** (full mixing) as
separate form events.

## How it works

- A lazy random walk `x ← αx + (1−α)xP` runs on a weighted graph. `alpha`
  controls patience; the graph topology controls how the walk mixes.
- The transition matrix is symmetrized and diagonalized once per graph
  (Jacobi). The spectral gap gives a **mixing-time estimate**; the slowest
  eigenmodes drive the pad voices; sign structure of bipartite modes audibly
  alternates.
- Tension `‖x − π‖₁` (distance from stationarity) drives velocity and
  ornament density, and its downward threshold crossings resolve musical form.

## Development

```sh
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run build      # tsup -> dist/
npm run demo       # vite dev server for demos/
```

The root-level HTML files (`mixing-time-composer.html`,
`mixing-time-composer-gamelan.html`, `convergence-suite.html`,
`tiny-planet-r185-duet.html`) are the original standalone prototypes the
library was ported from; the ports in `src/` cite them by line. `demos/` is
the same music rebuilt on the library — those files are deliberately pure
wiring, and any math they'd need to reimplement is treated as a missing
library feature.

## License

[PolyForm Noncommercial 1.0.0](./LICENSE.md): you may use, modify, and share
this software for any noncommercial purpose; commercial use is not permitted.

Required Notice: Copyright John Fewell (https://github.com/johnfewell/generative_music_engine)
