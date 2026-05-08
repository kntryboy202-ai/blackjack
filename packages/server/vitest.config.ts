// ABOUTME: Vitest configuration for the server package tests.
// ABOUTME: Sets test DATABASE_URL to an isolated test.db and uses forks pool to avoid shared singleton state.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      DATABASE_URL: "file:./test.db",
      SESSION_SECRET: "test_secret_do_not_use_in_prod",
      NODE_ENV: "test",
    },
    pool: "forks",
    // Run test files sequentially to avoid concurrent writes to the shared test.db
    fileParallelism: false,
  },
});
