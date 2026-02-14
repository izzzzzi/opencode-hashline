import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "esnext",
  outDir: "dist",
  external: ["@opencode-ai/plugin", "@opencode-ai/sdk"],
});
