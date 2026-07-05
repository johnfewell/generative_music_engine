// Mixing-time composer on the library. The shared harness (../shared/composer)
// owns transport, controls and the render loop; the library owns the math,
// scheduling and audio. All that makes this demo itself is the 12-TET
// minor-pentatonic ear.

import { pentatonicMinor } from "convergence/pitch";
import { mountComposer } from "../shared/composer";

mountComposer({ pitchMap: pentatonicMinor(48, 2.4), renderer: { gain: 0.4 } });
