import { resolve } from "node:path";
import { defineConfig } from "vite";

// Serves demos/ with the library aliased straight to the TypeScript source, so
// `npm run demo` runs the demos without a build step. More specific subpath
// aliases must come before the bare `convergence` entry.
const src = (p: string) => resolve(process.cwd(), "src", p);

export default defineConfig({
  root: "demos",
  resolve: {
    alias: [
      { find: "convergence/core", replacement: src("core/index.ts") },
      { find: "convergence/pitch", replacement: src("pitch/index.ts") },
      { find: "convergence/mood", replacement: src("mood/index.ts") },
      { find: "convergence/conductor", replacement: src("conductor/index.ts") },
      { find: "convergence/render/webaudio", replacement: src("render/webaudio/index.ts") },
      { find: /^convergence$/, replacement: src("index.ts") },
    ],
  },
  build: {
    rollupOptions: {
      input: {
        "renderer-smoke": resolve(process.cwd(), "demos/renderer-smoke.html"),
        "mixing-time": resolve(process.cwd(), "demos/mixing-time/index.html"),
      },
    },
  },
});
