import { app, BrowserWindow, protocol } from "electron";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const distRoot = path.join(projectRoot, "dist");
const origin = "vicky://app";
const smoke = process.env.VICKY_ELECTRON_SMOKE === "1";
// CI can render the same WebGL scene with Chromium's software backend.
if (smoke) app.commandLine.appendSwitch("enable-unsafe-swiftshader");
// Sound is synthesized with Web Audio; let it start without waiting for a gesture (the game still unlocks on input).
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const devUrl = process.env.VITE_DEV_SERVER_URL;
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

protocol.registerSchemesAsPrivileged([
  { scheme: "vicky", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

/** Serves the built game from dist/ under vicky://app, so it runs offline without file:// quirks. */
function serveAssets() {
  protocol.handle("vicky", async (request) => {
    const url = new URL(request.url);
    if (url.host !== "app" || request.method !== "GET") {
      return new Response("Forbidden", { status: 403 });
    }
    let relativePath;
    try {
      relativePath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    } catch {
      return new Response("Bad path", { status: 400 });
    }
    // Reject Windows drive/UNC syntax as well as traversal on either platform.
    if (relativePath.includes("\\") || relativePath.includes(":")) {
      return new Response("Forbidden", { status: 403 });
    }
    const filename = path.resolve(distRoot, `.${relativePath}`);
    const relative = path.relative(distRoot, filename);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return new Response("Forbidden", { status: 403 });
    }
    try {
      const body = await readFile(filename);
      return new Response(body, {
        headers: { "Content-Type": mimeTypes[path.extname(filename)] ?? "application/octet-stream" },
      });
    } catch (error) {
      return new Response(error.code === "ENOENT" ? "Not found" : "Unable to read asset", {
        status: error.code === "ENOENT" ? 404 : 500,
      });
    }
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    title: "Neon Reef — Pearl Pusher",
    width: 1440,
    height: 900,
    fullscreen: !smoke,
    autoHideMenuBar: true,
    backgroundColor: "#05070d",
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenu(null);
  const allowedOrigin = devUrl ? new URL(devUrl).origin : origin;
  const isLocal = (target) => {
    try {
      const url = new URL(target);
      return devUrl ? url.origin === allowedOrigin : url.protocol === "vicky:" && url.host === "app";
    } catch {
      return false;
    }
  };
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (!isLocal(url)) event.preventDefault();
  });
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "Escape") {
      event.preventDefault();
      win.close();
    } else if (input.key === "F11") {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error(`Renderer exited: ${details.reason}`);
    app.exit(1);
  });
  const smokeRun = smoke ? (await import("./smoke.mjs")).prepareSmoke(win, projectRoot) : null;
  await win.loadURL(devUrl ?? `${origin}/index.html`);
  if (smokeRun) {
    await smokeRun();
  } else {
    win.show();
  }
}

app.whenReady().then(async () => {
  serveAssets();
  await createWindow();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});

// This is a game: closing its window must return control to the launcher on every OS.
app.on("window-all-closed", () => app.quit());
