import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";
import path from "node:path";

// ADR-0012: vitest, not jest. esbuild (vitest's default transform) drops
// `emitDecoratorMetadata`, which Nest's injector needs, so the SWC plugin
// does the transform instead.
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    // One Postgres cluster, one schema: the suites share it and must not
    // fight over the same rows.
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@ecapital/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
});
