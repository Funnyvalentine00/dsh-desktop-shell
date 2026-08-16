import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "lib",
  dts: true,
  clean: true,
  // package.json is "type": "module", so emit lib/index.js + lib/index.d.ts
  // (matches main/exports and the cordis.patch.yml row) instead of .mjs/.d.mts.
  fixedExtension: false
});
