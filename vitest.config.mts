import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

// `npm test` is hermetic (no database, no network). Database-backed tests live in *.int.test.ts
// and run with `npm run test:int`.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { exclude: [...configDefaults.exclude, "**/*.int.test.ts"] },
});
