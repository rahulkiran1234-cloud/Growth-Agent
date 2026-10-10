import path from "node:path";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ path: ".env.local" }); // integration tests talk to the real database

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["src/**/*.int.test.ts"], testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false },
});
