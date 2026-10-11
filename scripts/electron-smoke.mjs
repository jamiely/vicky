import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
try {
  await access(new URL("../dist/index.html", import.meta.url));
} catch {
  console.error("[electron-smoke] Missing dist/index.html; run npm run build:electron:web first.");
  process.exit(1);
}
const env = { ...process.env, VICKY_ELECTRON_SMOKE: "1" };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const child = spawn(electronPath, [projectRoot], { cwd: projectRoot, env, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
const forward = (chunk) => {
  const text = chunk.toString();
  output += text;
  process.stdout.write(text);
};
child.stdout.on("data", forward);
child.stderr.on("data", forward);
const timer = setTimeout(() => {
  console.error("[electron-smoke] Timed out after 180 seconds.");
  child.kill("SIGKILL");
}, 180_000);
child.on("error", (error) => {
  clearTimeout(timer);
  console.error(error);
  process.exitCode = 1;
});
child.on("close", (code, signal) => {
  clearTimeout(timer);
  if (code !== 0 || !output.includes("[electron-smoke] passed:")) {
    console.error(`[electron-smoke] Startup/game verification failed: code=${code} signal=${signal}`);
    process.exitCode = 1;
  }
});
