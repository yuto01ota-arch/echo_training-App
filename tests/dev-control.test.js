import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { pause, sendCommand, portInUse } from "../scripts/dev-control.js";

async function availablePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function waitFor(check) {
  const deadline = Date.now() + 15_000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, "local server operation timed out");
    await pause(50);
  }
}

test("local lifecycle owns both server trees, reloads settings, rejects duplicate starts, restarts and stops safely", async () => {
  const root = await mkdtemp(join(tmpdir(), "echo-lifecycle-"));
  const appPort = await availablePort(), editorPort = await availablePort();
  const running = new Set();
  const run = (...args) => {
    const child = spawn(process.execPath, [join(root, "scripts/dev.js"), ...args], { cwd: root });
    child.output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { child.output += chunk; });
    running.add(child);
    child.done = once(child, "exit").then(([code]) => { running.delete(child); return code; });
    return child;
  };
  const put = async (path, value) => {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), value);
  };
  try {
    await put("package.json", '{"type":"module"}');
    for (const file of ["scripts/dev.js", "scripts/dev-control.js", "src/config.js"]) {
      await mkdir(join(root, file, ".."), { recursive: true });
      await cp(new URL(`../${file}`, import.meta.url), join(root, file));
    }
    const config = await readFile(join(root, "src/config.js"), "utf8");
    await put("src/config.js", config.replace(/appPort:\s*\d+/, `appPort: ${appPort}`).replace(/developerPort:\s*\d+/, `developerPort: ${editorPort}`));
    // Lightweight HTTP stand-ins exercise lifecycle logic without WebGL or real secrets.
    await put("node_modules/vite/package.json", '{"type":"module","exports":"./index.js"}');
    await put("node_modules/vite/index.js", "export const loadEnv = () => ({});");
    await put("node_modules/vite/bin/vite.js", `import http from 'node:http'; http.createServer((q,s)=>s.end('app')).listen(${appPort});`);
    await put("developer/scripts/setup-local.js", "");
    await put("developer/scripts/build-editor.js", "");
    await put("developer/.dev.vars", "before-change");
    await put("developer/.wrangler/state/keep.txt", "saved-regions");
    await put("developer/node_modules/wrangler/bin/wrangler.js", `const {spawn}=require('node:child_process'); spawn(process.execPath, ['worker-fixture.cjs'], {stdio:'inherit'});`);
    await put("developer/worker-fixture.cjs", `const http=require('node:http'); const fs=require('node:fs'); const setting=fs.readFileSync('.dev.vars','utf8'); http.createServer((q,s)=>s.end(setting)).listen(${editorPort});`);
    const first = run();
    const controllerRoot = root + "/";
    await waitFor(async () => {
      assert.equal(first.exitCode, null, first.output);
      return (await sendCommand(controllerRoot, "status").catch(() => null))?.state === "起動済み";
    });
    const status = run("status");
    assert.equal(await status.done, 0);
    assert.match(status.output, /通常画面（このMac）/);
    assert.match(status.output, /開発者ページ（このMac）/);
    const duplicate = run();
    assert.equal(await duplicate.done, 0);
    assert.match(duplicate.output, /二重起動しません/);
    await put("developer/.dev.vars", "after-change");
    await waitFor(async () => {
      try { return await (await fetch(`http://localhost:${editorPort}/login`)).text() === "after-change"; }
      catch { return false; }
    });
    assert.equal(await (await fetch(`http://localhost:${appPort}/`)).text(), "app");
    const restarted = run("restart");
    await first.done;
    await waitFor(async () => (await sendCommand(controllerRoot, "status").catch(() => null))?.state === "起動済み");
    const stop = run("stop");
    assert.equal(await stop.done, 0);
    assert.equal(await restarted.done, 0);
    await waitFor(async () => !(await portInUse(appPort)) && !(await portInUse(editorPort)));
    assert.equal(await readFile(join(root, "developer/.wrangler/state/keep.txt"), "utf8"), "saved-regions");
    if (process.platform !== "win32") {
      const closedTerminal = run();
      await waitFor(async () => (await sendCommand(controllerRoot, "status").catch(() => null))?.state === "起動済み");
      closedTerminal.kill("SIGHUP");
      assert.equal(await closedTerminal.done, 0);
      await waitFor(async () => !(await portInUse(appPort)) && !(await portInUse(editorPort)));
    }
    // A separate application using the port is left untouched.
    const other = net.createServer();
    other.listen(appPort, "127.0.0.1");
    await once(other, "listening");
    try {
      const blocked = run();
      assert.equal(await blocked.done, 1);
      assert.match(blocked.output, /既に使用されています/);
      assert.equal(await portInUse(appPort), true);
    } finally { await new Promise(resolve => other.close(resolve)); }
  } finally {
    for (const child of running) child.kill("SIGTERM");
    await Promise.all([...running].map(child => child.done));
    await rm(root, { recursive: true, force: true });
  }
});
