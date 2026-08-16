// Electron main process for dsh-desktop-shell.
// Loaded via `electron <this-file> --url http://127.0.0.1:<port>`.
const { app, BrowserWindow, Tray, Menu, dialog } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--url") args.url = argv[i + 1];
  }
  return args;
}

function log(msg) {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(path.join(app.getPath("userData"), "desktop.log"), line);
  } catch { /* logging must never crash */ }
}

const args = parseArgs(process.argv.slice(2));
if (!args.url) {
  console.error("dsh-desktop-shell: --url is required");
  app.exit(2);
}

let isQuitting = false;
let mainWindow = null;
let tray = null;
const stateFile = () => path.join(app.getPath("userData"), "window-state.json");

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return { width: 1280, height: 800 };
  }
}

function saveWindowState(win) {
  try {
    const [x, y] = win.getPosition();
    const [width, height] = win.getSize();
    fs.writeFileSync(stateFile(), JSON.stringify({ x, y, width, height }));
  } catch { /* ignore */ }
}

function createWindow() {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    ...state,
    title: "DeepSeek Harness",
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    icon: path.join(__dirname, "..", "assets", "icon.png")
  });

  mainWindow.loadURL(args.url);
  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
    log(`did-fail-load ${code} ${desc}`);
    dialog.showErrorBox("DeepSeek Harness", `Failed to load ${args.url}\n(${code}) ${desc}`);
    app.exit(1);
  });

  // Close → hide to tray unless quitting.
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  // Debounced state save on resize/move: one trailing timer at a time.
  let saveTimer = null;
  const scheduleSave = () => {
    if (saveTimer === null) {
      saveTimer = setTimeout(() => {
        saveTimer = null;
        saveWindowState(mainWindow);
      }, 400);
    }
  };
  mainWindow.on("resize", scheduleSave);
  mainWindow.on("move", scheduleSave);
}

function createTray() {
  try {
    // Transparent white-whale tray icon (visible on dark taskbars); fall back
    // to the app icon if the tray asset is missing.
    const trayIconPath = path.join(__dirname, "..", "assets", "icon-tray.png");
    const iconPath = fs.existsSync(trayIconPath)
      ? trayIconPath
      : path.join(__dirname, "..", "assets", "icon.png");
    tray = new Tray(iconPath);
    tray.setToolTip("DeepSeek Harness");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "打开主窗口", click: () => { mainWindow.show(); mainWindow.focus(); } },
      { type: "separator" },
      { label: "退出", click: () => { isQuitting = true; app.quit(); } }
    ]));
    tray.on("click", () => { mainWindow.show(); mainWindow.focus(); });
  } catch (err) {
    log(`tray init failed: ${err.message}`);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    createWindow();
    createTray();
    app.on("activate", () => { if (mainWindow === null) createWindow(); else mainWindow.show(); });
  });
  app.on("before-quit", () => { isQuitting = true; });
  app.on("window-all-closed", (e) => {
    // Tray keeps the app alive; on macOS convention we still exit on Quit only.
    if (isQuitting) app.exit(0);
  });
}
