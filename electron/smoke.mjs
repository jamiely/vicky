import { app } from "electron";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Exercises the packaged game in a real Electron window: WebGL renders the cabinet, assets stay local, a real
 * keyboard press launches balls through the physics board into slots, audio unlocks, LUCKY releases a tower pearl,
 * and a pearl pushed off the tray reaches the disk. A tall window switches to the portrait (vertical cabinet) layout.
 */
export function prepareSmoke(win, projectRoot) {
  const failures = [];
  const completedResources = [];
  // ResourceTiming omits custom-scheme assets. Observe actual Chromium requests.
  win.webContents.debugger.attach("1.3");
  const networkReady = win.webContents.debugger.sendCommand("Network.enable");
  const responses = new Map();
  win.webContents.debugger.on("message", (_event, method, params) => {
    if (method === "Network.responseReceived") {
      responses.set(params.requestId, params.response);
    } else if (method === "Network.loadingFinished") {
      const response = responses.get(params.requestId);
      if (response) completedResources.push(response.url);
    }
  });
  win.webContents.on("console-message", (details) => {
    if (details.level === "error") failures.push(details.message);
  });
  win.webContents.on("did-fail-load", (_event, code, description) => {
    failures.push(`Page load failed: ${code} ${description}`);
  });
  win.webContents.session.webRequest.onErrorOccurred((details) => {
    failures.push(`Resource failed: ${details.url}: ${details.error}`);
  });
  const evaluate = (code) => win.webContents.executeJavaScript(code, true);
  const screenshot = async (name) => {
    const file = path.join(projectRoot, "dist_electron", name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, (await win.webContents.capturePage()).toPNG());
    return file;
  };
  async function waitFor(check, description, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await check()) return;
      await pause(100);
    }
    const file = await screenshot("electron-smoke-failure.png");
    throw new Error(`Timed out waiting for ${description}; failures=${JSON.stringify(failures)}; screenshot=${file}`);
  }

  return async () => {
    await networkReady;
    await waitFor(() => evaluate("Boolean(document.querySelector('#viewport canvas'))"), "game startup (physics + cabinet)");
    const renderer = await evaluate(`(() => {
      const canvas = document.querySelector('#viewport canvas');
      return { webgl: Boolean(canvas.getContext('webgl2')), width: canvas.width, height: canvas.height };
    })()`);
    assert.equal(renderer.webgl, true, "WebGL2 renderer must be active");
    assert.ok(renderer.width > 0 && renderer.height > 0, "Canvas must have a drawable viewport");
    assert.ok(completedResources.length > 0, "Game must have loaded from the app protocol");
    assert.ok(completedResources.every((url) => url.startsWith("vicky://app/") || url.startsWith("data:") || url.startsWith("blob:")), `Game assets must remain local: ${completedResources}`);

    // Deterministic machine with the test handle exposed.
    await win.loadURL("vicky://app/index.html?test&seed=42");
    await waitFor(() => evaluate("Boolean(window.vicky)"), "deterministic startup");
    const state = () => evaluate(`(() => {
      const g = window.vicky;
      return {
        credits: g.rules.credits, shots: g.rules.shots, tickets: g.rules.tickets, ladder: { ...g.rules.ladder },
        reserve: g.rules.pearlReserve, unlocked: g.sound.unlocked,
        trayPearls: g.physics.bodies.filter((b) => b.kind === 'pearl' && !b.inBoard).length,
        diskPearls: g.disk.pearls.length,
      };
    })()`);
    const initial = await state();

    // Real keyboard: hold Space to launch, release to stop.
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Space" });
    await waitFor(async () => (await state()).credits < initial.credits, "real keyboard launch");
    await pause(1500);
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Space" });
    await waitFor(async () => (await state()).unlocked, "gesture-unlocked audio");
    await waitFor(async () => {
      const s = await state();
      return s.tickets > 0 || s.ladder.ball > 0 || s.ladder.ticket > 0 || s.reserve !== initial.reserve;
    }, "a shot falling through the peg board into a slot");

    // LUCKY releases a tower pearl down the tube onto the tray.
    const beforeLucky = await state();
    await evaluate("window.vicky.applySlot(3)");
    await waitFor(async () => (await state()).trayPearls > beforeLucky.trayPearls, "LUCKY pearl release onto the tray");

    // A pearl pushed off the front edge reaches the disk.
    await evaluate(`(() => {
      const pearl = window.vicky.physics.bodies.find((b) => b.kind === 'pearl' && !b.inBoard);
      pearl.body.setTranslation({ x: 0, y: -10, z: 25 }, true);
    })()`);
    await waitFor(async () => (await state()).diskPearls > 0, "pearl routed to the pocket disk");

    await pause(500);
    const file = await screenshot("electron-smoke.png");

    // A portrait window (vertical cabinet monitor) switches to the straight-on layout.
    win.setContentSize(405, 720);
    await waitFor(() => evaluate("document.querySelector('#app').dataset.layout === 'portrait'"), "portrait layout on a tall window");
    await pause(500);
    const portrait = await screenshot("electron-smoke-portrait.png");
    assert.deepEqual(failures, [], "Renderer/resource failures");
    console.log(`[electron-smoke] passed: WebGL, local assets, keyboard launch, slot hit, audio unlock, LUCKY release, disk routing, portrait layout; screenshots=${file}, ${portrait}`);
    app.quit();
  };
}
