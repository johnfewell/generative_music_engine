import { defineConfig } from "vitest/config";

// Separate from vite.config.ts (which sets root to demos/ for the dev server).
// Vitest prefers this file, so the test root stays at the project root.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
