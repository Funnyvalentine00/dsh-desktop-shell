import { mkdirSync, copyFileSync } from "node:fs";
mkdirSync("lib", { recursive: true });
copyFileSync("src/electron-main.cjs", "lib/electron-main.cjs");
