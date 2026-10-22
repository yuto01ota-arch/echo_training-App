import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

// Exercise different settings without touching the working copy or local data.
test("one config change controls authentication, new publications and legacy playback", async () => {
  const dir = await mkdtemp(join(tmpdir(), "echo-config-"));
  try {
    await writeFile(join(dir, "package.json"), '{"type":"module"}');
    for (const file of [
      "src/config.js", "src/custom/schema.js", "src/custom/framePack.js",
      "src/custom/settings.js", "src/custom/catalog.js", "src/echo/scans.js",
      "src/echo/source/menuConfig.js", "src/echo/scanMotion.js", "developer/catalog.js", "developer/worker.js",
    ]) {
      const target = join(dir, file);
      await mkdir(dirname(target), { recursive: true });
      await cp(new URL(`../${file}`, import.meta.url), target);
    }
    const path = join(dir, "src/config.js");
    const source = await readFile(path, "utf8");
    await writeFile(path, source
      .replace(/FRAME_COUNT\s*=\s*\d+/, "FRAME_COUNT = 120")
      .replace(/PACK_SIZE\s*=\s*\d+/, "PACK_SIZE = 12")
      .replace(/minPasswordLength:\s*\d+/, "minPasswordLength: 12")
      .replace(/maxPasswordLength:\s*\d+/, "maxPasswordLength: 64")
      .replace(/sessionSeconds:[^,]+/, "sessionSeconds: 2 * 60 * 60"));
    const load = (file) => import(pathToFileURL(join(dir, file)).href);
    const { default: worker } = await load("developer/worker.js");
    const { validateScan, PACK_COUNT } = await load("src/custom/schema.js");
    const { packFrames } = await load("src/custom/framePack.js");
    const { SCANS } = await load("src/echo/scans.js");
    assert.ok(SCANS.every(scan => scan.frameCount === 200), "bundled media is unchanged");
    assert.equal(PACK_COUNT, 10);
    const geometry = {
      title: "設定変更のテスト", category: "腹部", model: "male", pose: "standing",
      view: "front", rotate: 0,
      camera: { position: [0, 1, 3], target: [0, 1, 0], up: [0, 1, 0], span: 1, aspect: 1 },
      plane: { right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1] },
      path: { start: { x: 0, y: 1 }, end: { x: 0, y: 1.2 } },
      imageWidth: 320, imageHeight: 180,
    };
    const config = validateScan(geometry);
    assert.equal(config.frameCount, 120);
    assert.equal(config.packSize, 12);
    const records = new Map();
    const env = {
      DEVELOPER_PASSWORD: "p".repeat(12), SESSION_SECRET: "s".repeat(32),
      LOGIN_LIMITER: { limit: async () => ({ success: true }) },
      SCANS: {
        put: async (key, value) => records.set(key, value),
        get: async (key, type) => {
          const value = records.get(key) ?? null;
          return value && type === "json" ? JSON.parse(value) : value;
        },
        delete: async key => records.delete(key),
        list: async ({ prefix }) => ({
          keys: [...records.keys()].filter(key => key.startsWith(prefix)).map(name => ({ name })),
          list_complete: true,
        }),
      },
    };
    const origin = "https://developer.example";
    let cookie = "";
    const call = (path, options = {}) => worker.fetch(new Request(origin + path, {
      ...options, headers: { Origin: origin, Cookie: cookie, ...options.headers },
    }), env);
    const login = await call("/login");
    assert.match(await login.text(), /maxlength="64"/);
    env.DEVELOPER_PASSWORD = "p".repeat(11);
    assert.equal((await call("/login")).status, 503);
    env.DEVELOPER_PASSWORD = "p".repeat(12);
    const signedIn = await call("/login", {
      method: "POST", body: new URLSearchParams({ password: env.DEVELOPER_PASSWORD }),
    });
    assert.equal(signedIn.status, 303);
    assert.match(signedIn.headers.get("Set-Cookie"), /Max-Age=7200/);
    cookie = signedIn.headers.get("Set-Cookie").split(";")[0];
    const stale = await call("/api/drafts", {
      method: "POST", body: JSON.stringify({ ...config, frameCount: 200, packSize: 10 }),
    });
    assert.equal(stale.status, 409, "old editor must reload before uploading");
    const draft = await call("/api/drafts", { method: "POST", body: JSON.stringify(config) });
    assert.equal(draft.status, 201);
    const { id } = await draft.json();
    for (let i = 0; i < 10; i++) {
      const pack = packFrames(Array.from({ length: 12 }, (_, j) =>
        new Blob([new Uint8Array([255, 216, i * 12 + j, 255, 217])])));
      assert.equal((await call(`/api/drafts/${id}/packs/${i}`, { method: "PUT", body: pack })).status, 200);
    }
    assert.equal((await call(`/api/drafts/${id}/publish`, { method: "POST" })).status, 201);
    const last = await call(`/public/frames/${id}/120.jpg`);
    assert.equal(last.status, 200);
    assert.equal(new Uint8Array(await last.arrayBuffer())[2], 119);
    assert.equal((await call(`/public/frames/${id}/121.jpg`)).status, 404);
    // Old records lack packSize and must retain their original ten-frame layout.
    const legacyID = "custom-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    records.set(`published:${legacyID}`, JSON.stringify({ ...geometry, id: legacyID, frameCount: 200 }));
    const legacy = new Uint8Array(40 + 10 * 5);
    const header = new DataView(legacy.buffer);
    for (let i = 0; i < 10; i++) {
      header.setUint32(i * 4, 5, true);
      legacy.set([255, 216, 190 + i, 255, 217], 40 + i * 5);
    }
    records.set(`frames:${legacyID}:19`, legacy.buffer);
    const oldLast = await call(`/public/frames/${legacyID}/200.jpg`);
    assert.equal(oldLast.status, 200);
    assert.equal(new Uint8Array(await oldLast.arrayBuffer())[2], 199);
    const { loadCustomScans } = await load("src/custom/catalog.js");
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (url) => call(new URL(url).pathname);
      const catalog = await loadCustomScans(origin);
      assert.equal(catalog.find(scan => scan.id === id).frameCount, 120);
      assert.equal(catalog.find(scan => scan.id === legacyID).frameCount, 200);
      assert.equal(catalog.find(scan => scan.id === legacyID).packSize, 10);
    } finally { globalThis.fetch = originalFetch; }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
