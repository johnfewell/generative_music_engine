// convergence — generative music engine driven by Markov chain convergence.
//
// Root barrel. Each layer is also available as a subpath import
// (convergence/core, convergence/pitch, convergence/mood,
// convergence/conductor, convergence/render/webaudio) so consumers can pull in
// only what they need — a game can take the conductor's event stream and skip
// the WebAudio renderer entirely.
export * from "./core/index.js";
export * from "./pitch/index.js";
export * from "./mood/index.js";
export * from "./conductor/index.js";
export * from "./render/webaudio/index.js";
