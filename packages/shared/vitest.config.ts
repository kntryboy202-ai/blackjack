// ABOUTME: Vitest configuration for the shared package type tests.
// ABOUTME: Uses node environment since there are no DOM dependencies.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
