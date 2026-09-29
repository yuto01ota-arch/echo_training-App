import net from "node:net";
import { realpathSync } from "node:fs";
import { mkdir, readFile, writeFile, unlink, chmod } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEV_SERVER } from "../src/config.js";

export const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export function controlPaths(root) {
  root = realpathSync(root);
  const id = createHash("sha256").update(root).digest("hex");
  return {
    directory: join(root, ".local-dev"),
    record: join(root, ".local-dev", "session.json"),
    socket: process.platform === "win32"
      ? `\\\\.\\pipe\\echo-training-${id}`
      : join(tmpdir(), `echo-${id.slice(0, 16)}.sock`),
  };
}
export async function readSession(root) {
  try { return JSON.parse(await readFile(controlPaths(root).record, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== "ESRCH"; }
}
export async function sendCommand(root, action) {
  const session = await readSession(root);
  if (!session) return null;
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(controlPaths(root).socket);
    let reply = "";
    const timer = setTimeout(() => socket.destroy(new Error(
      "管理プロセスが応答しません。起動したターミナルを確認してください。",
    )), DEV_SERVER.controlTimeoutMs);
    socket.on("connect", () => socket.write(JSON.stringify({ token: session.token, action }) + "\n"));
    socket.on("data", chunk => {
      reply += chunk;
      if (reply.length > DEV_SERVER.controlMaxBytes) socket.destroy(new Error("Invalid controller reply"));
      if (!reply.includes("\n")) return;
      try { resolve(JSON.parse(reply.split("\n")[0])); }
      catch (error) { reject(error); }
      socket.end();
    });
    socket.on("error", error => {
      if (!alive(session.pid)) resolve(null);
      else reject(error);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      if (!reply) reject(new Error("管理プロセスとの接続が閉じられました。"));
    });
  });
}

// One controller per checkout. A token protects against stale PID reuse;
// stop/restart requests never kill a process merely because it occupies a port.
export async function createController(root, metadata, status, onStop) {
  const paths = controlPaths(root);
  await mkdir(paths.directory, { recursive: true });
  const previous = await readSession(root);
  if (previous && alive(previous.pid))
    throw new Error("このプロジェクトは起動済みです。npm run dev:status で確認してください。");
  if (previous) await unlink(paths.record);
  const record = { ...metadata, pid: process.pid, token: randomUUID() };
  await writeFile(paths.record, JSON.stringify(record), { flag: "wx", mode: 0o600 });
  // A crashed controller can leave a Unix socket file; no live owner exists now.
  if (process.platform !== "win32") await unlink(paths.socket).catch(error => {
    if (error.code !== "ENOENT") throw error;
  });
  const server = net.createServer(socket => {
    let data = "";
    socket.setTimeout(DEV_SERVER.controlTimeoutMs, () => socket.destroy());
    socket.on("error", () => {});
    socket.on("data", chunk => {
      data += chunk;
      if (data.length > DEV_SERVER.controlMaxBytes) return socket.destroy();
      if (!data.includes("\n")) return;
      try {
        const request = JSON.parse(data.split("\n")[0]);
        if (request.token !== record.token) return socket.destroy();
        socket.end(JSON.stringify(status()) + "\n");
        if (request.action === "stop") onStop();
      } catch { socket.destroy(); }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(paths.socket, resolve);
  });
  if (process.platform !== "win32") await chmod(paths.socket, 0o600);
  return async () => {
    await new Promise(resolve => server.close(resolve));
    await unlink(paths.record).catch(error => { if (error.code !== "ENOENT") throw error; });
  };
}

export async function stopManaged(root) {
  const response = await sendCommand(root, "stop");
  if (!response) return false;
  const deadline = Date.now() + DEV_SERVER.stopTimeoutMs * 2;
  while (await readSession(root)) {
    if (Date.now() > deadline) throw new Error("停止処理が完了しませんでした。起動したターミナルを確認してください。");
    await pause(DEV_SERVER.pollIntervalMs);
  }
  return true;
}
export async function portInUse(port) {
  const probe = host => new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(DEV_SERVER.controlTimeoutMs);
    const finish = used => { socket.destroy(); resolve(used); };
    socket.on("connect", () => finish(true));
    socket.on("error", () => finish(false));
    socket.on("timeout", () => finish(false));
  });
  return (await Promise.all([probe("127.0.0.1"), probe("::1")])).some(Boolean);
}
