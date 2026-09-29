import { DEV_SERVER } from "../src/config.js";
import { spawn } from "node:child_process";
import { access, watch } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { createController, sendCommand, stopManaged, portInUse, pause } from "./dev-control.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const developerDirectory = fileURLToPath(new URL("../developer/", import.meta.url));
const args = process.argv.slice(2);
const command = ["status", "stop", "restart"].includes(args[0]) ? args.shift() : "start";
const editorOnly = args.includes("--editor-only");
const viteArgs = args.filter(arg => arg !== "--editor-only");
const portIndex = viteArgs.indexOf("--port");
const appPort = Number(viteArgs.find(arg => arg.startsWith("--port="))?.slice("--port=".length) ||
  (portIndex >= 0 ? viteArgs[portIndex + 1] : DEV_SERVER.appPort));
const appURL = `http://localhost:${appPort}/echo_training-App/`;
const localEditorURL = `http://localhost:${DEV_SERVER.developerPort}/`;
const env = loadEnv("development", root, "VITE_");
const developerURL = editorOnly ? localEditorURL : env.VITE_DEVELOPER_URL || localEditorURL;
const localEditor = new URL(developerURL).origin === new URL(localEditorURL).origin;
const children = new Set();
const watcher = new AbortController();
let stopping = false, restartingEditor = false, state = "起動中", closeController;
let editor, reloadTimer, shuttingDown, reloadRequested = false;

function report(data, interactive = false) {
  console.log(`\nECHO TRAINING：${data.state}`);
  if (data.appURL) console.log(`通常画面（このMac）：${data.appURL}`);
  console.log(`開発者ページ（${data.localEditor ? "このMac" : "外部の接続先"}）：${data.developerURL}`);
  console.log("状態確認：npm run dev:status　停止：npm run dev:stop　再起動：npm run dev:restart");
  if (interactive) console.log("このターミナルで Ctrl+C を押しても停止できます。");
  console.log();
}
function signalChild(child, signal) {
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) { if (error.code !== "ESRCH") throw error; }
}
async function stopChild(child) {
  if (!child || !children.has(child)) return;
  signalChild(child, "SIGTERM");
  const timer = setTimeout(() => signalChild(child, "SIGKILL"), DEV_SERVER.stopTimeoutMs);
  await child.done;
  clearTimeout(timer);
}
function start(script, scriptArgs, options = {}) {
  const child = spawn(process.execPath, [script, ...scriptArgs], {
    cwd: root, stdio: "inherit", detached: process.platform !== "win32", ...options,
  });
  children.add(child);
  child.done = new Promise(resolve => {
    child.on("error", error => {
      console.error(error.message);
      children.delete(child);
      resolve();
      process.exitCode = 1;
      shutdown();
    });
    child.on("exit", code => {
      children.delete(child);
      resolve();
      if (!stopping && !(child === editor && restartingEditor)) {
        process.exitCode = code || 1;
        console.error("サーバーが終了したため、関連するサーバーも停止します。");
        shutdown();
      }
    });
  });
  return child;
}
function shutdown() {
  if (shuttingDown) return shuttingDown;
  stopping = true;
  state = "停止中";
  watcher.abort();
  clearTimeout(reloadTimer);
  shuttingDown = (async () => {
    await Promise.all([...children].map(stopChild));
    await closeController?.();
    console.log("ECHO TRAINING：停止しました。保存済みの部位・設定は残っています。");
  })();
  return shuttingDown;
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, shutdown);

async function waitReady(url, label) {
  const deadline = Date.now() + DEV_SERVER.startupTimeoutMs;
  while (!stopping) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(DEV_SERVER.healthTimeoutMs) });
      if (response.ok) return;
      if (response.status === 503 && label === "認証サーバー")
        throw new Error("認証設定を確認してください：developer/.dev.vars と src/config.js の AUTH の条件が一致していません。");
    } catch (error) {
      if (error.message.startsWith("認証設定")) throw error;
    }
    if (Date.now() > deadline) throw new Error(`${label}が起動しませんでした。上のログを確認してください。`);
    await pause(DEV_SERVER.pollIntervalMs);
  }
}
function startEditor() {
  return start(fileURLToPath(new URL("../developer/node_modules/wrangler/bin/wrangler.js", import.meta.url)), [
    "dev", "--port", String(DEV_SERVER.developerPort), "--var", `PUBLIC_APP_URL:${appURL}`,
  ], { cwd: developerDirectory });
}
async function reloadEditor() {
  reloadRequested = true;
  if (stopping || restartingEditor) return;
  restartingEditor = true;
  try {
    while (reloadRequested && !stopping) {
      reloadRequested = false;
      state = "認証設定を再読み込み中";
      console.log("パスワード設定の変更を検出しました。認証サーバーを再起動します。");
      await stopChild(editor);
      if (stopping) return;
      editor = startEditor();
      await waitReady(`${localEditorURL}login`, "認証サーバー");
    }
    if (!stopping) {
      state = "起動済み";
      console.log("新しい認証設定を読み込みました。ブラウザーを再読み込みしてください。");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    await shutdown();
  } finally { restartingEditor = false; }
}
async function watchPassword() {
  try {
    for await (const event of watch(developerDirectory, { signal: watcher.signal })) {
      if (event.filename !== ".dev.vars") continue;
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(reloadEditor, DEV_SERVER.secretReloadDelayMs);
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error("パスワード設定の監視が終了しました。変更後は npm run dev:restart を実行してください。");
    }
  }
}

try {
  if (!Number.isInteger(appPort) || appPort < 1 || appPort > 65535)
    throw new Error("--port に有効なポート番号を指定してください。");
  if (command === "status") {
    const current = await sendCommand(root, "status");
    if (current) report(current);
    else {
      console.log("ECHO TRAINING：停止中。npm run dev で起動できます。");
      for (const port of [appPort, DEV_SERVER.developerPort])
        if (await portInUse(port)) console.log(`${port}番ポートは管理外のプロセスが使用しています。以前起動したターミナルで停止してください。`);
    }
  } else if (command === "stop") {
    console.log(await stopManaged(root) ? "このプロジェクトのサーバーを停止しました。" : "管理しているサーバーは起動していません。");
  } else {
    if (command === "restart") await stopManaged(root);
    const current = await sendCommand(root, "status");
    if (current) {
      report(current);
      console.log("二重起動しません。設定を読み直す場合は npm run dev:restart を使ってください。");
    } else {
      const status = () => ({ state, appURL: editorOnly ? null : appURL, developerURL, localEditor });
      closeController = await createController(root, {}, status, shutdown);
      for (const port of [...(!editorOnly ? [appPort] : []), ...(localEditor ? [DEV_SERVER.developerPort] : [])]) {
        if (await portInUse(port)) throw new Error(
          `${port}番ポートは既に使用されています。別のサーバーを黙って再利用しません。以前起動したターミナルで停止し、npm run dev を実行してください。`,
        );
      }
      if (localEditor) {
        await access(new URL("../developer/node_modules/wrangler/bin/wrangler.js", import.meta.url)).catch(() => {
          throw new Error("依存関係がありません。npm ci --prefix developer を実行してください。");
        });
        await import("../developer/scripts/setup-local.js");
        await import("../developer/scripts/build-editor.js");
      }
      if (!stopping && localEditor) {
        editor = startEditor();
        await waitReady(`${localEditorURL}login`, "認証サーバー");
        if (!stopping) void watchPassword();
      }
      if (!stopping && !editorOnly) {
        start(fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url)), [
          "--strictPort", "--port", String(appPort), ...viteArgs,
        ], { env: { ...process.env, VITE_DEVELOPER_URL: developerURL } });
        await waitReady(appURL, "通常画面のサーバー");
      }
      if (!stopping) { state = "起動済み"; report(status(), true); }
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
  await shutdown();
}
