// Render the DeepSeek logo (from the dsh web frontend favicon.svg) at multiple
// sizes using Electron/Chromium for pixel-exact SVG rasterization.
//
//   --variant app   black background + white whale (app/window/shortcut icon)
//   --variant tray  transparent background + white whale (taskbar tray icon)
//   --out <dir>     output directory for <size>.png files (default below)
//
// Run: node scripts/render-icon.cjs [--variant app|tray] [--source <path>] [--out <dir>]
// NOTE: run from a background/full-access context — Chromium's mojo IPC uses
// named pipes that the file sandbox blocks for foreground child processes.
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, nativeImage } = require("electron");

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err && err.stack ? err.stack : err);
  app.exit(5);
});

const argv = process.argv.slice(2);
const source = argv.includes("--source")
  ? argv[argv.indexOf("--source") + 1]
  : "C:/Users/XHDN/.dsh/profiles/node_modules/@deepseek-ai/dsh-web-frontend/dist/favicon.svg";
const variant = argv.includes("--variant") ? argv[argv.indexOf("--variant") + 1] : "app";
const outDir = argv.includes("--out")
  ? argv[argv.indexOf("--out") + 1]
  : path.join(__dirname, "..", "assets", ".icon-build", variant);
const sizes = variant === "tray" ? [16, 24, 32, 48] : [16, 24, 32, 48, 64, 128, 256];
const CAPTURE = 512; // capture once at high res, then resize down

// Deterministic color: strip the adaptive <style> (light/dark media query) and
// force a fixed path fill; center the logo at ~88% so the tile has breathing room.
function svgHtml() {
  const raw = fs.readFileSync(source, "utf8");
  const bg = variant === "tray" ? "transparent" : "#000000"; // black tile for app
  const svg = raw
    .replace(/<style>[\s\S]*?<\/style>/g, "<style>path{fill:#ffffff}</style>")
    .replace(/width="[^"]*"\s*height="[^"]*"/, 'width="88%" height="88%"');
  return (
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head>" +
    `<body style="margin:0;padding:0;background:${bg};width:${CAPTURE}px;height:${CAPTURE}px;overflow:hidden;display:flex;align-items:center;justify-content:center">` +
    svg +
    "</body></html>"
  );
}

async function capturePage() {
  const win = new BrowserWindow({
    width: CAPTURE,
    height: CAPTURE,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true, backgroundThrottling: false }
  });
  try {
    const url = "data:text/html;charset=utf-8," + encodeURIComponent(svgHtml());
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await win.loadURL(url);
        // Give the SVG layout/paint time to settle before capturing.
        await new Promise((r) => setTimeout(r, 1200));
        const img = await win.webContents.capturePage();
        const png = img.toPNG();
        if (!png || png.length < 100) throw new Error("empty capture");
        return nativeImage.createFromBuffer(png);
      } catch (err) {
        lastErr = err;
        console.log("capture retry " + attempt + ": " + err.message);
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    throw lastErr;
  } finally {
    win.destroy();
  }
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const big = await capturePage();
    for (const size of sizes) {
      const resized = big.resize({ width: size, height: size });
      const png = resized.toPNG();
      if (!png || png.length === 0) throw new Error("empty PNG for " + size);
      fs.writeFileSync(path.join(outDir, `${size}.png`), png);
      console.log("ok " + size);
    }
    console.log(`rendered ${variant} (${sizes.join(",")}) -> ${outDir}`);
    app.exit(0);
  } catch (err) {
    console.error("RENDER FAILED:", err && err.stack ? err.stack : err);
    app.exit(4);
  }
});
