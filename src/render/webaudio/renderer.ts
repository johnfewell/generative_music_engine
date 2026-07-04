// Batteries-included WebAudio renderer: subscribe it to a conductor and it
// sounds the note events. Games that want their own audio can ignore this
// module entirely and consume the event stream directly.

import type { Conductor, NoteEvent } from "../../conductor/index.js";
import { bar, gong, strike } from "./palette.js";

export type WebAudioRendererOptions = {
  /** Master gain (default 0.42, matching the prototypes). */
  gain?: number;
  /**
   * Gamelan ombak: if set, melody and pad voices double into a pair detuned by
   * +/- ombakHz/2, producing the pengumbang/pengisep beating shimmer.
   */
  ombakHz?: number;
};

type Voice = (
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  freq: number,
  vel: number,
  dur: number,
  pan?: number,
) => void;

/**
 * Renders conductor note events through the bundled instrument palette.
 * Master chain: gain -> DynamicsCompressor -> destination (suite lines 186-188).
 * Layer mapping: melody -> strike, ornament -> strike, pad -> bar, cadence -> gong.
 */
export class WebAudioRenderer {
  private readonly ctx: BaseAudioContext;
  private readonly master: GainNode;
  private readonly ombakHz: number;

  constructor(ctx: BaseAudioContext, opts: WebAudioRendererOptions = {}) {
    this.ctx = ctx;
    this.ombakHz = opts.ombakHz ?? 0;
    this.master = ctx.createGain();
    this.master.gain.value = opts.gain ?? 0.42;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(ctx.destination);
  }

  /** Subscribe to a conductor's note stream. Returns an unsubscribe function. */
  attach(conductor: Conductor): () => void {
    return conductor.on("note", (e) => this.render(e));
  }

  private render(e: NoteEvent): void {
    switch (e.layer) {
      case "melody":
        this.pair(strike, e);
        break;
      case "pad":
        this.pair(bar, e);
        break;
      case "ornament":
        strike(this.ctx, this.master, e.time, e.freq, e.velocity, e.duration, e.pan);
        break;
      case "cadence":
        gong(this.ctx, this.master, e.time, e.freq, e.velocity, e.duration);
        break;
    }
  }

  /** Play a voice, doubled into an ombak pair when ombakHz is set. */
  private pair(fn: Voice, e: NoteEvent): void {
    if (this.ombakHz > 0) {
      const d = this.ombakHz / 2;
      fn(this.ctx, this.master, e.time, e.freq + d, e.velocity * 0.5, e.duration, e.pan);
      fn(this.ctx, this.master, e.time, e.freq - d, e.velocity * 0.5, e.duration, e.pan);
    } else {
      fn(this.ctx, this.master, e.time, e.freq, e.velocity, e.duration, e.pan);
    }
  }
}
