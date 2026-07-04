// convergence/conductor — look-ahead scheduler.
//
// Strict boundary: NO WebAudio, NO DOM. The clock is injected so it survives
// hidden tabs. Turns chain state into a stream of typed note events plus form
// callbacks (phraseResolved, etc.).
//
// Typed event stream + look-ahead scheduler.
export * from "./events.js";
export * from "./conductor.js";
