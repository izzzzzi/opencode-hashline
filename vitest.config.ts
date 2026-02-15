import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["external/**", "node_modules/**"],
  },
});
