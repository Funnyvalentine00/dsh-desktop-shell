import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import {
  buildWindowUrl,
  onChildExit,
  resolveElectronPath,
  shouldOpenBrowserFallback,
  shouldSpawn,
  watchChildExit
} from "../lib/index.js";

describe("buildWindowUrl", () => {
  it("builds the loopback URL with the given port", () => {
    expect(buildWindowUrl(3080)).toBe("http://127.0.0.1:3080");
  });
});

describe("shouldSpawn", () => {
  it("spawns by default", () => {
    expect(shouldSpawn({ enabled: true }, {}, undefined)).toBe(true);
  });
  it("respects config.enabled=false", () => {
    expect(shouldSpawn({ enabled: false }, {}, undefined)).toBe(false);
  });
  it("respects DSH_DESKTOP=0", () => {
    expect(shouldSpawn({ enabled: true }, { DSH_DESKTOP: "0" }, undefined)).toBe(false);
  });
  it("respects --no-desktop (webStartup.desktop=false)", () => {
    expect(shouldSpawn({ enabled: true }, {}, { desktop: false })).toBe(false);
  });
});

describe("onChildExit", () => {
  it("exit 0 + exitOnClose tears dsh down", () => {
    expect(onChildExit(0, true)).toBe("exit-dsh");
  });
  it("non-zero exit keeps dsh running", () => {
    expect(onChildExit(1, true)).toBe("keep-running");
  });
  it("exit 0 without exitOnClose keeps dsh running", () => {
    expect(onChildExit(0, false)).toBe("keep-running");
  });
});

/** Platform-correct binary name (electron.exe on win32, electron elsewhere). */
const binaryName = process.platform === "win32" ? "electron.exe" : "electron";

describe("resolveElectronPath", () => {
  it("honors explicit config", () => {
    expect(resolveElectronPath({ electronPath: "C:/x/electron.exe" })).toBe("C:/x/electron.exe");
  });
  it("treats ELECTRON_OVERRIDE_DIST_PATH as a dist dir and joins the binary name (win32 backslash)", () => {
    const prev = process.env.ELECTRON_OVERRIDE_DIST_PATH;
    process.env.ELECTRON_OVERRIDE_DIST_PATH = "C:\\some\\dist";
    try {
      expect(resolveElectronPath({})).toBe(join("C:\\some\\dist", binaryName));
    } finally {
      if (prev !== undefined) process.env.ELECTRON_OVERRIDE_DIST_PATH = prev;
      else delete process.env.ELECTRON_OVERRIDE_DIST_PATH;
    }
  });
  it("resolves the real installed electron binary when no override is set", () => {
    // electron is installed in this project, so the require.resolve branch returns a real path.
    const prev = process.env.ELECTRON_OVERRIDE_DIST_PATH;
    delete process.env.ELECTRON_OVERRIDE_DIST_PATH;
    try {
      const resolved = resolveElectronPath({});
      expect(resolved).toBeDefined();
      expect(basename(resolved)).toBe(binaryName);
      expect(existsSync(resolved)).toBe(true);
    } finally {
      if (prev !== undefined) process.env.ELECTRON_OVERRIDE_DIST_PATH = prev;
    }
  });
});

describe("shouldOpenBrowserFallback", () => {
  it("opens the fallback browser when the web app was told not to (--no-open)", () => {
    expect(shouldOpenBrowserFallback({ openBrowserFallback: true }, { openBrowser: false })).toBe(true);
  });
  it("never double-opens when the web app will open the browser", () => {
    expect(shouldOpenBrowserFallback({ openBrowserFallback: true }, { openBrowser: true })).toBe(false);
    expect(shouldOpenBrowserFallback({ openBrowserFallback: true }, undefined)).toBe(false);
  });
  it("respects config.openBrowserFallback=false", () => {
    expect(shouldOpenBrowserFallback({ openBrowserFallback: false }, { openBrowser: false })).toBe(false);
  });
});

describe("watchChildExit", () => {
  const URL = "http://127.0.0.1:3080";
  it("calls onExitDsh when exit code is 0 and exitOnClose is true", () => {
    const child = new EventEmitter();
    let exited = false;
    watchChildExit(child, true, () => { exited = true; }, { warn: () => {} }, URL);
    child.emit("exit", 0);
    expect(exited).toBe(true);
  });
  it("warns and keeps running on non-zero exit", () => {
    const child = new EventEmitter();
    const warns = [];
    watchChildExit(child, true, () => {}, { warn: (m) => warns.push(m) }, URL);
    child.emit("exit", 1);
    expect(warns.length).toBeGreaterThan(0);
  });
  it("warns with the URL when spawning fails", () => {
    const child = new EventEmitter();
    const warns = [];
    watchChildExit(child, true, () => {}, { warn: (m) => warns.push(m) }, URL);
    child.emit("error", new Error("ENOENT"));
    expect(warns.length).toBeGreaterThan(0);
    expect(warns[0]).toContain(URL);
  });
  it("invokes onKeepRunning on non-zero exit (browser fallback path)", () => {
    const child = new EventEmitter();
    let kept = 0;
    watchChildExit(child, true, () => {}, { warn: () => {} }, URL, () => { kept += 1; });
    child.emit("exit", 1);
    expect(kept).toBe(1);
  });
  it("does not invoke onKeepRunning on exit 0 (shutdown path)", () => {
    const child = new EventEmitter();
    let kept = 0;
    watchChildExit(child, true, () => {}, { warn: () => {} }, URL, () => { kept += 1; });
    child.emit("exit", 0);
    expect(kept).toBe(0);
  });
  it("invokes onKeepRunning when spawning fails", () => {
    const child = new EventEmitter();
    let kept = 0;
    watchChildExit(child, true, () => {}, { warn: () => {} }, URL, () => { kept += 1; });
    child.emit("error", new Error("ENOENT"));
    expect(kept).toBe(1);
  });
});
