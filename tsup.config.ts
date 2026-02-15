import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/utils.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  target: "esnext",
  outDir: "dist",
  external: ["@opencode-ai/plugin", "@opencode-ai/sdk", "zod"],
});
