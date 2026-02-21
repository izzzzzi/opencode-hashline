import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "opencode-hashline": "src/index.ts", utils: "src/utils.ts" },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  target: "esnext",
  outDir: "dist",
  external: ["@opencode-ai/plugin", "@opencode-ai/sdk", "zod"],
});
