import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import z from "@deepseek-ai/schemastery";
import { DesktopShellError } from "./invariant.js";

/** Stable Cordis plugin name. */
export const name = "desktop-shell";
/** Services required before the window can open. */
export const inject = ["webServer", "webStartup"];

/** Keep the error type exported for consumers of the scaffold entry. */
export { DesktopShellError } from "./invariant.js";

const require = createRequire(import.meta.url);

export const Config = z.object({
  enabled: z.boolean().default(true),
  electronPath: z.string(),
  exitOnClose: z.boolean().default(true)
});

export type DesktopShellConfig = Schemastery.TypeT<typeof Config>;

/** Path to this plugin's Electron main script (copied verbatim to lib/). */
function electronMainScript(): string {
  return fileURLToPath(new URL("./electron-main.cjs", import.meta.url));
}

/** Binary name of the Electron executable on the current platform. */
function electronBinaryName(): string {
  return process.platform === "win32" ? "electron.exe" : "electron";
}

/**
 * Resolve the Electron executable. Priority: explicit config → ELECTRON_OVERRIDE_DIST_PATH
 * → require.resolve("electron") + platform suffix. Returns undefined when unavailable.
 * On win32 require.resolve returns a backslash path, so the package dir is taken with
 * dirname() and the binary joined with join() — never string slicing on a "/".
 */
export function resolveElectronPath(config?: { electronPath?: string }): string | undefined {
  if (config?.electronPath) return config.electronPath;
  const override = process.env.ELECTRON_OVERRIDE_DIST_PATH;
  if (override) return join(override, electronBinaryName());
  try {
    const electronEntry = require.resolve("electron");
    const distPath = dirname(electronEntry);
    return join(distPath, "dist", electronBinaryName());
  } catch {
    return undefined;
  }
}

/** Canonical local URL of the web GUI. */
export function buildWindowUrl(port: number): string {
  return `http://127.0.0.1:${String(port)}`;
}

/**
 * Whether to spawn the desktop window. Disabled when config.enabled is false,
 * DSH_DESKTOP=0, or the web app was invoked with --no-desktop (webStartup.desktop === false).
 */
export function shouldSpawn(
  config: { enabled: boolean },
  env: NodeJS.ProcessEnv = process.env,
  webStartup?: { desktop?: boolean }
): boolean {
  if (!config.enabled) return false;
  if (env.DSH_DESKTOP === "0") return false;
  if (webStartup?.desktop === false) return false;
  return true;
}

/**
 * Decide dsh's fate when the Electron child exits.
 * exit 0 (tray Quit) + exitOnClose → tear down dsh; anything else → keep serving browser mode.
 */
export function onChildExit(code: number | null, exitOnClose: boolean): "exit-dsh" | "keep-running" {
  return code === 0 && exitOnClose ? "exit-dsh" : "keep-running";
}

/** Start the Electron window as a child of the dsh process. */
export function spawnDesktop(electronPath: string, mainScript: string, url: string): ReturnType<typeof spawn> {
  return spawn(electronPath, [mainScript, "--url", url], {
    stdio: "ignore",
    detached: false
  });
}

/** Hook dsh shutdown onto the child's exit. */
export function watchChildExit(
  child: ReturnType<typeof spawn>,
  exitOnClose: boolean,
  onExitDsh: () => void,
  logger: { warn: (msg: string) => void },
  url: string
): void {
  child.on("exit", (code) => {
    const decision = onChildExit(code, exitOnClose);
    if (decision === "exit-dsh") onExitDsh();
    else logger.warn(`desktop-shell: electron exited with code ${String(code)}; keeping dsh in browser mode`);
  });
  child.on("error", (err) => {
    logger.warn(`desktop-shell: failed to start electron: ${err.message}; browser mode at ${url}`);
  });
}

/**
 * Request a full dsh shutdown when the desktop window closes (tray Quit).
 * Preferred path: the launcher-provided `appExit` (bounded tree dispose + exit,
 * wired by dsh's runProfile for `dsh web`). Fallback: emit the loader 'exit'
 * event, then a short hard-exit guard so the process never survives a tray Quit.
 */
function shutdownDsh(ctx: any): void {
  if (typeof ctx.appExit === "function") {
    try {
      ctx.appExit(0);
      return;
    } catch {
      /* fall through to event + guard */
    }
  }
  let exited = false;
  const hardExit = () => {
    if (exited) return;
    exited = true;
    process.exit(0);
  };
  const guard = setTimeout(hardExit, 3000);
  guard.unref?.();
  try {
    void ctx.emit?.("exit", "SIGTERM");
  } catch {
    hardExit();
  }
}

/** Plugin entry: spawn Electron after the web server binds; degrade on any failure. */
export function apply(ctx: any, config: DesktopShellConfig): void {
  const url = buildWindowUrl(ctx.webServer.port);
  if (!shouldSpawn(config, process.env, ctx.webStartup)) {
    ctx.logger.info(`desktop-shell: disabled; browser mode at ${url}`);
    return;
  }
  try {
    const electronPath = resolveElectronPath(config);
    if (electronPath === undefined) {
      ctx.logger.warn(`desktop-shell: electron not found; browser mode at ${url}`);
      return;
    }
    const child = spawnDesktop(electronPath, electronMainScript(), url);
    watchChildExit(child, config.exitOnClose, () => {
      ctx.logger.info("desktop-shell: window closed, shutting down dsh");
      shutdownDsh(ctx);
    }, ctx.logger, url);
    ctx.logger.info(`desktop-shell: desktop window opening at ${url}`);
  } catch (err) {
    ctx.logger.warn(`desktop-shell: ${err instanceof Error ? err.message : String(err)}; browser mode at ${url}`);
  }
}
