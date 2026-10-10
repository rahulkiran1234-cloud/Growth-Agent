// Bundles the Netlify background function into one self-contained file, so it needs no path-alias or TypeScript
// support from the host. Run by the Netlify build command (see netlify.toml).
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = await build({
  entryPoints: [path.join(root, "netlify/job-entry.ts")],
  outfile: path.join(root, "netlify/functions/job-background.mjs"),
  bundle: true, platform: "node", format: "esm", target: "node22", sourcemap: false, minify: false, logLevel: "info",
  alias: { "@": path.join(root, "src") },
  external: ["pg-native"], // optional native driver that pg loads inside a try/catch
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" }, // some dependencies are CommonJS
  metafile: true,
});
const bytes = Object.values(result.metafile.outputs).reduce((a, o) => a + o.bytes, 0);
console.log(`job-background bundled (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
