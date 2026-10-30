import { defineConfig } from "vitest/config";
import path from "node:path";

// Integration tests run against a real PostgreSQL database named by TEST_DATABASE_URL.
// They fail (rather than skip) when it is missing, so CI cannot pass without them.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for integration tests (see README)");
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.int.test.ts"],
    globalSetup: ["./scripts/test-db-setup.mjs"],
    env: { DATABASE_URL: testDatabaseUrl, DIRECT_URL: testDatabaseUrl },
    fileParallelism: false,
    // Imports against a real database take seconds, not milliseconds.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
