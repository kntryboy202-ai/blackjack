// ABOUTME: Vitest configuration for the React client package.
// ABOUTME: Uses happy-dom as the DOM environment for component tests.

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
  },
});
