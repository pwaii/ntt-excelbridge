// Dev-only screenshot helper. No dependencies: Node 22 built-in fetch + WebSocket
// drive headless Chrome over the DevTools Protocol. Seeds the local-development
// consent flag so ProtectedRoute pages render, then captures full-page PNGs.
// Usage: node shoot.mjs "/jobs/new::out/create.png" "/login::out/login.png"  [width]
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.BASE || "http://localhost:5175";
const PORT = 9333;
const WIDTH = Number(process.argv.find((a) => /^\d+$/.test(a))) || 1440;
const specs = process.argv.slice(2).filter((a) => a.includes("::"));

const udir = `${process.env.TEMP || "/tmp"}/cc-shoot-${Date.now()}`;
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${udir}`, `--window-size=${WIDTH},900`, "about:blank"], { stdio: "ignore" });

async function version() { for (let i = 0; i < 60; i++) { try { return await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(250); } } throw new Error("chrome devtools never came up"); }
const ver = await version();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
const send = (method, params = {}, sessionId) => new Promise((r) => { const mid = ++id; pend.set(mid, r); ws.send(JSON.stringify({ id: mid, method, params, sessionId })); });

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await S("Page.enable"); await S("Runtime.enable");
// Seed the local-development consent before any app script runs, so
// ProtectedRoute sees an authenticated local-user on first paint.
await S("Page.addScriptToEvaluateOnNewDocument", { source: "try{sessionStorage.setItem('xlsx.local-development-access','enabled')}catch(e){}" });

async function nav(url) { await S("Page.navigate", { url }); await sleep(7000); }

await nav(`${BASE}/login`);

for (const spec of specs) {
  const [route, out] = spec.split("::");
  await nav(`${BASE}${route}`);
  const { contentSize, cssContentSize } = await S("Page.getLayoutMetrics", {});
  const cs = cssContentSize || contentSize;
  const height = Math.min(Math.ceil(cs.height), 9000);
  await S("Emulation.setDeviceMetricsOverride", { width: WIDTH, height, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  const { data } = await S("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(data, "base64"));
  console.log("wrote", out, `${WIDTH}x${height}`);
  await S("Emulation.clearDeviceMetricsOverride", {});
}
ws.close(); chrome.kill();
