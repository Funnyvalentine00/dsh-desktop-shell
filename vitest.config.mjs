import { defineConfig } from "vitest/config";

// Minimal config so `npm test` works under the dsh file sandbox:
// - preserveSymlinks: true keeps Vite from calling fs.realpathSync.native on
//   Windows, which otherwise triggers `exec("net use")` (a piped-stdio spawn
//   the sandbox blocks with EPERM).
// - pool "threads" uses worker_threads instead of child-process forks, which
//   the sandbox also blocks.
// Kept as plain .mjs so Vite imports it natively — a .ts config would be
// bundled with esbuild, whose service spawn is likewise blocked.
export default defineConfig({
  resolve: { preserveSymlinks: true },
  test: { pool: "threads" }
});
