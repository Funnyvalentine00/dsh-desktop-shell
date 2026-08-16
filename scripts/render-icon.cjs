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

// Build a classic BMP-format multi-size .ico from PNG buffers (maximum
// compatibility with Windows Explorer, unlike PNG-compressed .ico entries).
// Returns the .ico bytes.
function buildIco(pngs) {
  const entries = [];
  for (const { size, png } of pngs) {
    const img = nativeImage.createFromBuffer(png);
    const bgra = img.toBitmap(); // top-down BGRA, width*height*4
    const w = img.getSize().width;
    const h = img.getSize().height;
    // DIB pixels are bottom-up: flip row order.
    const rowBytes = w * 4;
    const xor = Buffer.alloc(rowBytes * h);
    for (let y = 0; y < h; y += 1) {
      bgra.copy(xor, (h - 1 - y) * rowBytes, y * rowBytes, (y + 1) * rowBytes);
    }
    // AND mask: fully opaque (all zeros), each 1-bpp row padded to 4 bytes.
    const andRow = Math.ceil(Math.ceil(w / 8) / 4) * 4;
    const and = Buffer.alloc(andRow * h);
    // BITMAPINFOHEADER (40 bytes) + XOR + AND.
    const hdr = Buffer.alloc(40);
    hdr.writeInt32LE(40, 0);
    hdr.writeInt32LE(w, 4);
    hdr.writeInt32LE(h * 2, 8);
    hdr.writeUInt16LE(1, 12);
    hdr.writeUInt16LE(32, 14);
    // biCompression = BI_RGB (0), rest zero.
    const blob = Buffer.concat([hdr, xor, and]);
    entries.push({ size: w, blob });
  }
  entries.sort((a, b) => a.size - b.size);
  const headerSize = 6 + 16 * entries.length;
  let offset = headerSize;
  const dir = Buffer.alloc(headerSize);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(entries.length, 4);
  entries.forEach((e, i) => {
    const o = 6 + i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o);
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.blob.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.blob.length;
  });
  return Buffer.concat([dir, ...entries.map((e) => e.blob)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const big = await capturePage();
    const pngs = [];
    for (const size of sizes) {
      const resized = big.resize({ width: size, height: size });
      const png = resized.toPNG();
      if (!png || png.length === 0) throw new Error("empty PNG for " + size);
      fs.writeFileSync(path.join(outDir, `${size}.png`), png);
      pngs.push({ size, png });
      console.log("ok " + size);
    }
    if (variant === "app") {
      const icoPath = path.join(__dirname, "..", "assets", "icon.ico");
      fs.writeFileSync(icoPath, buildIco(pngs));
      console.log("wrote " + icoPath + " (" + (fs.statSync(icoPath).size) + " bytes)");
      // The desktop shortcut references a distinct filename: Explorer caches
      // icons per path, so regeneration must refresh BOTH names.
      const whaleIcoPath = path.join(__dirname, "..", "assets", "deepseek-whale.ico");
      fs.copyFileSync(icoPath, whaleIcoPath);
      console.log("wrote " + whaleIcoPath);
    }
    console.log(`rendered ${variant} (${sizes.join(",")}) -> ${outDir}`);
    app.exit(0);
  } catch (err) {
    console.error("RENDER FAILED:", err && err.stack ? err.stack : err);
    app.exit(4);
  }
});
