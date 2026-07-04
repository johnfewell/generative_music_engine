import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "core/index": "src/core/index.ts",
    "pitch/index": "src/pitch/index.ts",
    "mood/index": "src/mood/index.ts",
    "conductor/index": "src/conductor/index.ts",
    "render/webaudio/index": "src/render/webaudio/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
});
