import { validateSettings, editorScans } from "../src/custom/settings.js";
import { loadCustomScans } from "../src/custom/catalog.js";
import { SCANS, scanFromHash } from "../src/echo/scans.js";
import { settingsProbeOrientation } from "../src/three/customScan.js";
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../developer/worker.js";
import { validateScan } from "../src/custom/schema.js";
import { packFrames, unpackFrames } from "../src/custom/framePack.js";
import {
  cameraFromSetting,
  cameraSetting,
  planeFromCamera,
  pointInPlane,
} from "../src/three/customScan.js";
import { Vector3 } from "three";

const origin = "https://developer.example";
const config = {
  title: "腹部：テスト",
  category: "腹部",
  model: "male",
  pose: "standing",
  view: "front",
  rotate: 0,
  camera: {
    position: [0, 1, 3],
    target: [0, 1, 0],
    up: [0, 1, 0],
    span: 1,
    aspect: 1,
  },
  plane: { right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1] },
  path: { start: { x: 0, y: 1.2 }, end: { x: 0, y: 1 } },
  imageWidth: 320,
  imageHeight: 240,
};
function memoryKV() {
  const values = new Map();
  return {
    async put(key, value) {
      assert.ok(
        !key.startsWith("frames:") || !values.has(key),
        `Normal publication must not rewrite a KV key: ${key}`,
      );
      values.set(
        key,
        typeof value === "string"
          ? new TextEncoder().encode(value).buffer
          : value.slice(0),
      );
    },
    async get(key, type) {
      const value = values.get(key);
      if (!value) return null;
      if (type === "arrayBuffer") return value.slice(0);
      const text = new TextDecoder().decode(value);
      return type === "json" ? JSON.parse(text) : text;
    },
    async delete(key) {
      values.delete(key);
    },
    async list({ prefix }) {
      return {
        keys: [...values.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((name) => ({ name })),
        list_complete: true,
      };
    },
  };
}
const jpeg = (n) => new Blob([new Uint8Array([255, 216, n, 255, 217])]);

test("custom camera framing survives resize and plane coordinates remain independent of camera changes", () => {
  const camera = cameraFromSetting(config.camera, 1);
  const plane = planeFromCamera(camera);
  const point = new Vector3(0.12, 1.2, 0.17);
  assert.deepEqual(pointInPlane(point, plane), { x: 0.12, y: 1.2 });
  assert.deepEqual(cameraSetting(camera, new Vector3(0, 1, 0)), config.camera);
  const narrow = cameraFromSetting(config.camera, 0.5);
  assert.equal(narrow.right - narrow.left, 0.5);
  assert.equal(narrow.top - narrow.bottom, 1);
  assert.equal(
    point.clone().project(narrow).y,
    point.clone().project(camera).y,
  );
  camera.position.set(3, 1, 0);
  camera.lookAt(0, 1, 0);
  assert.deepEqual(pointInPlane(point, plane), { x: 0.12, y: 1.2 });
});

test("scan validation rejects invalid geometry and discards arbitrary fields", () => {
  assert.equal(
    validateScan({ ...config, password: "secret", frameBase: "javascript:bad" })
      .password,
    undefined,
  );
  for (const invalid of [
    { ...config, path: { start: { x: 0, y: 1 }, end: { x: 0, y: 1 } } },
    { ...config, camera: { ...config.camera, position: [0, 1, 0] } },
    { ...config, plane: { ...config.plane, right: [2, 0, 0] } },
    { ...config, path: { ...config.path, end: { x: NaN, y: 1 } } },
    { ...config, imageWidth: 99999 },
  ])
    assert.throws(() => validateScan(invalid));
});

test("frame pack round trips all frames and rejects truncated or non-JPEG data", async () => {
  const pack = await (
    await packFrames(Array.from({ length: 10 }, (_, i) => jpeg(i)))
  ).arrayBuffer();
  const frames = unpackFrames(pack);
  assert.equal(frames.length, 10);
  assert.equal(frames[9][2], 9);
  assert.throws(() => unpackFrames(pack.slice(0, -1)));
  const corrupt = pack.slice(0);
  new Uint8Array(corrupt)[40] = 0;
  assert.throws(() => unpackFrames(corrupt));
});

test("private editor and writes require authentication; only complete publications become public and persist", async () => {
  let assetsRead = 0;
  const env = {
    DEVELOPER_PASSWORD: "test-password-at-least-16",
    SESSION_SECRET: "test-session-secret-at-least-32-characters",
    LOGIN_LIMITER: { limit: async () => ({ success: true }) },
    SCANS: memoryKV(),
    ASSETS: {
      fetch: async () => {
        assetsRead++;
        return new Response("private editor");
      },
    },
  };
  const call = (path, options = {}) =>
    worker.fetch(new Request(origin + path, options), env);
  assert.equal((await call("/assets/editor.js")).status, 303);
  assert.equal(assetsRead, 0);
  assert.equal(
    (await call("/api/drafts", { method: "POST", body: "{}" })).status,
    401,
  );
  const login = await call("/login", {
    method: "POST",
    headers: { Origin: origin },
    body: new URLSearchParams({ password: env.DEVELOPER_PASSWORD }),
  });
  const cookie = login.headers.get("Set-Cookie").split(";")[0];
  const headers = { Origin: origin, Cookie: cookie };
  const privateAsset = await call("/assets/editor.js", { headers });
  assert.equal(privateAsset.status, 200);
  assert.equal(assetsRead, 1);
  assert.equal(privateAsset.headers.get("Cache-Control"), "no-store");
  assert.equal(
    (
      await call("/api/drafts", {
        method: "POST",
        headers: { ...headers, Origin: "https://other.example" },
        body: JSON.stringify(config),
      })
    ).status,
    403,
  );
  const draft = await call("/api/drafts", {
    method: "POST",
    headers,
    body: JSON.stringify(config),
  });
  assert.equal(draft.status, 201);
  const { id } = await draft.json();
  assert.deepEqual((await (await call("/public/scans")).json()).scans, []);
  assert.equal((await call(`/public/frames/${id}/1.jpg`)).status, 404);
  assert.equal(
    (await call(`/api/drafts/${id}/publish`, { method: "POST", headers }))
      .status,
    409,
  );
  assert.equal(
    (
      await call(`/api/drafts/${id}/packs/0`, {
        method: "PUT",
        headers,
        body: "bad data",
      })
    ).status,
    400,
  );
  for (let i = 0; i < 20; i++) {
    const result = await call(`/api/drafts/${id}/packs/${i}`, {
      method: "PUT",
      headers,
      body: await packFrames(
        Array.from({ length: 10 }, (_, n) => jpeg(i * 10 + n)),
      ),
    });
    assert.equal(result.status, 200);
  }
  assert.equal(
    (await call(`/api/drafts/${id}/publish`, { method: "POST", headers }))
      .status,
    201,
  );
  const list = await call("/public/scans");
  assert.equal(list.headers.get("Access-Control-Allow-Origin"), "*");
  const scans = (await list.json()).scans;
  assert.equal(scans.length, 1);
  assert.deepEqual(scans[0].camera, config.camera);
  assert.deepEqual(scans[0].path, config.path);
  const last = await call(`/public/frames/${id}/200.jpg`);
  assert.equal(last.headers.get("Content-Type"), "image/jpeg");
  assert.equal(new Uint8Array(await last.arrayBuffer())[2], 199);
  assert.equal((await call(`/public/frames/${id}/201.jpg`)).status, 404);
  assert.equal(
    (await call(`/api/drafts/${id}/publish`, { method: "POST", headers }))
      .status,
    200,
  );
  assert.equal(
    (
      await call(`/api/drafts/${id}/packs/0`, {
        method: "PUT",
        headers,
        body: "changed",
      })
    ).status,
    409,
  );
  assert.equal(await env.SCANS.get(`draft:${id}`), null);
});

test("editing preserves source media and annotations, validates stationary tilt paths, and rejects stale or unauthenticated changes", async (t) => {
  const env = {
    DEVELOPER_PASSWORD: "test-password-at-least-16",
    SESSION_SECRET: "test-session-secret-at-least-32-characters",
    LOGIN_LIMITER: { limit: async () => ({ success: true }) },
    SCANS: memoryKV(),
  };
  const call = (path, options = {}) =>
    worker.fetch(new Request(origin + path, options), env);
  const login = await call("/login", {
    method: "POST",
    headers: { Origin: origin },
    body: new URLSearchParams({ password: env.DEVELOPER_PASSWORD }),
  });
  const headers = {
    Origin: origin,
    Cookie: login.headers.get("Set-Cookie").split(";")[0],
  };
  const update = (id, body, auth = headers) =>
    call(`/api/scans/${id}/settings`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify(body),
    });
  const data = {
    ...config,
    revision: null,
    title: "do not rename",
    imageWidth: 12,
    structures: ["do not replace"],
  };
  assert.equal((await update("abs_long", data, {})).status, 401);
  assert.equal(
    (
      await update("abs_long", data, {
        ...headers,
        Origin: "https://other.example",
      })
    ).status,
    403,
  );
  assert.equal((await update("nonexistent", data)).status, 404);
  assert.equal(
    (
      await update("abs_long", {
        ...data,
        camera: { ...config.camera, span: 0 },
      })
    ).status,
    400,
  );
  const result = await update("abs_long", data);
  assert.equal(result.status, 200);
  const record = await result.json();
  assert.equal(record.title, "腹部：長軸");
  assert.equal(record.custom, false);
  assert.equal((await update("abs_long", data)).status, 409);
  assert.equal(
    (
      await update("abs_long", {
        ...data,
        revision: record.revision,
        path: { ...config.path, end: { x: 0, y: 0.99 } },
      })
    ).status,
    200,
  );
  const stationary = { ...config.path, end: { ...config.path.start } };
  assert.throws(() =>
    validateSettings(
      { ...config, path: stationary },
      SCANS.find((s) => s.id === "abs_long"),
    ),
  );
  const tilt = SCANS.find((s) => s.id === "abs_intercostal");
  assert.deepEqual(
    validateSettings({ ...config, path: stationary }, tilt).path,
    stationary,
  );
  assert.equal(
    (await update(tilt.id, { ...data, path: stationary })).status,
    200,
  );
  assert.ok(settingsProbeOrientation({ ...tilt, rotate: 0 }, 0).tilt > 0);
  assert.ok(settingsProbeOrientation({ ...tilt, rotate: 0 }, 1).tilt < 0);
  const id = "custom-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  await env.SCANS.put(
    `published:${id}`,
    JSON.stringify({ ...validateScan(config), id, createdAt: "original" }),
  );
  const pack = await (
    await packFrames(Array.from({ length: 10 }, (_, i) => jpeg(i)))
  ).arrayBuffer();
  await env.SCANS.put(`frames:${id}:0`, pack);
  const custom = await update(id, { ...data, model: "female" });
  assert.equal(custom.status, 200);
  const edited = await custom.json();
  assert.equal(edited.title, config.title);
  assert.equal(edited.imageWidth, 320);
  assert.equal(edited.frameCount, 200);
  assert.equal(edited.createdAt, "original");
  assert.equal(edited.model, "female");
  assert.deepEqual(await env.SCANS.get(`frames:${id}:0`, "arrayBuffer"), pack);
  t.mock.method(globalThis, "fetch", async (url) =>
    call(new URL(url).pathname),
  );
  const overrides = await loadCustomScans(origin);
  const resolved = scanFromHash("#/echo/abs_long", overrides);
  const original = SCANS.find((s) => s.id === "abs_long");
  assert.deepEqual(resolved.structures, original.structures);
  assert.equal(resolved.directory, original.directory);
  assert.equal(resolved.folder, original.folder);
  assert.equal(resolved.path.end.y, 0.99);
  assert.equal(resolved.custom, false);
  assert.equal(
    editorScans(overrides).filter((s) => s.id === "abs_long").length,
    1,
  );
  assert.ok(
    overrides
      .find((s) => s.id === id)
      .frameBase.endsWith(`/public/frames/${id}/`),
  );
});

test("custom tilt uses literal endpoint angles, rejects moving anchors and preserves old straight scans", () => {
  const tilt = {
    ...config, type: "tilt", startAngle: 20, endAngle: 50,
    path: { start: { x: 0.02, y: 1.2 }, end: { x: 0.02, y: 1.2 } },
  };
  const scan = validateScan(tilt);
  assert.equal(scan.type, "tilt");
  assert.equal(scan.axis, "x");
  for (const [progress, degrees] of [[0, 20], [0.25, 27.5], [0.5, 35], [1, 50]]) {
    assert.ok(Math.abs(settingsProbeOrientation(scan, progress).tilt - degrees * Math.PI / 180) < 1e-12);
  }
  const reverse = validateScan({ ...tilt, startAngle: 50, endAngle: -10 });
  assert.ok(Math.abs(settingsProbeOrientation(reverse, 0.25).tilt - 35 * Math.PI / 180) < 1e-12);
  assert.equal(validateScan(config).type, "linear");
  for (const invalid of [
    { type: "unknown" }, { startAngle: NaN }, { endAngle: Infinity },
    { startAngle: "20" }, { startAngle: null }, { startAngle: -81 }, { endAngle: 81 },
    { startAngle: 50 }, { path: config.path },
  ]) assert.throws(() => validateScan({ ...tilt, ...invalid }));
  const edited = validateSettings({ ...tilt, startAngle: -20, endAngle: 40 }, scan);
  assert.throws(() => validateSettings({ ...tilt, startAngle: null }, scan));
  assert.equal(edited.startAngle, -20);
  assert.equal(edited.endAngle, 40);
  assert.equal(validateSettings(config, validateScan(config)).type, "linear");
  // Existing recorded-image angles still describe +30 to -30 in the 3D renderer.
  const builtin = SCANS.find(scan => scan.id === "abs_intercostal");
  assert.ok(Math.abs(settingsProbeOrientation(builtin, 0).tilt - Math.PI / 6) < 1e-12);
});

test("new tilt survives API publication, catalog loading and geometry-only edits", async t => {
  const env = {
    DEVELOPER_PASSWORD: "test-password-at-least-16",
    SESSION_SECRET: "test-session-secret-at-least-32-characters",
    LOGIN_LIMITER: { limit: async () => ({ success: true }) }, SCANS: memoryKV(),
  };
  const call = (path, options = {}) => worker.fetch(new Request(origin + path, options), env);
  const login = await call("/login", { method: "POST", headers: { Origin: origin },
    body: new URLSearchParams({ password: env.DEVELOPER_PASSWORD }) });
  const headers = { Origin: origin, Cookie: login.headers.get("Set-Cookie").split(";")[0] };
  const tilt = { ...config, type: "tilt", startAngle: -15, endAngle: 45,
    path: { start: config.path.start, end: config.path.start } };
  const draft = await call("/api/drafts", { method: "POST", headers, body: JSON.stringify(tilt) });
  assert.equal(draft.status, 201);
  const { id } = await draft.json();
  for (let i = 0; i < 20; i++) {
    const response = await call(`/api/drafts/${id}/packs/${i}`, { method: "PUT", headers,
      body: await packFrames(Array.from({ length: 10 }, (_, j) => jpeg(i * 10 + j))) });
    assert.equal(response.status, 200);
  }
  assert.equal((await call(`/api/drafts/${id}/publish`, { method: "POST", headers })).status, 201);
  t.mock.method(globalThis, "fetch", url => call(new URL(url).pathname));
  const [published] = await loadCustomScans(origin);
  assert.equal(published.type, "tilt");
  assert.equal(published.startAngle, -15);
  assert.equal(published.endAngle, 45);
  assert.deepEqual(published.path.start, published.path.end);
  const edited = await call(`/api/scans/${id}/settings`, { method: "PUT", headers,
    body: JSON.stringify({ ...tilt, startAngle: 40, endAngle: -20, revision: published.revision }) });
  assert.equal(edited.status, 200);
  const [reloaded] = await loadCustomScans(origin);
  assert.equal(reloaded.startAngle, 40);
  assert.equal(reloaded.endAngle, -20);
  assert.equal(reloaded.type, "tilt");
  assert.equal(new Uint8Array(await (await call(`/public/frames/${id}/200.jpg`)).arrayBuffer())[2], 199);
  const invalid = await call(`/api/scans/${id}/settings`, { method: "PUT", headers,
    body: JSON.stringify({ ...tilt, startAngle: 100, revision: reloaded.revision }) });
  assert.equal(invalid.status, 400);
  assert.equal((await loadCustomScans(origin))[0].startAngle, 40);
});

test("builtin and uploaded scans switch motion both ways without changing source media", async t => {
  const { editableMotion } = await import("../src/echo/scanMotion.js");
  const env = {
    DEVELOPER_PASSWORD: "test-password-at-least-16",
    SESSION_SECRET: "test-session-secret-at-least-32-characters",
    LOGIN_LIMITER: { limit: async () => ({ success: true }) }, SCANS: memoryKV(),
  };
  const call = (path, options = {}) => worker.fetch(new Request(origin + path, options), env);
  const login = await call("/login", { method: "POST", headers: { Origin: origin },
    body: new URLSearchParams({ password: env.DEVELOPER_PASSWORD }) });
  const headers = { Origin: origin, Cookie: login.headers.get("Set-Cookie").split(";")[0] };
  t.mock.method(globalThis, "fetch", url => call(new URL(url).pathname));
  const anchor = { start: config.path.start, end: config.path.start };
  const customID = "custom-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  await env.SCANS.put(`published:${customID}`, JSON.stringify({ ...validateScan(config), id: customID }));
  const pack = await (await packFrames(Array.from({ length: 10 }, (_, i) => jpeg(i)))).arrayBuffer();
  await env.SCANS.put(`frames:${customID}:0`, pack);
  for (const id of ["abs_long", "abs_left_flank", customID]) {
    const builtin = SCANS.find(scan => scan.id === id);
    if (builtin?.type === "tilt") {
      const motion = editableMotion(builtin);
      assert.equal(motion.startAngle, 30);
      assert.equal(motion.endAngle, -30);
      for (const t of [0, 0.25, 1])
        assert.equal(settingsProbeOrientation(motion, t).tilt, settingsProbeOrientation(builtin, t).tilt);
    }
    const update = (data) => call(`/api/scans/${id}/settings`, {
      method: "PUT", headers, body: JSON.stringify(data),
    });
    const result = await update({ ...config, type: "tilt", startAngle: 15, endAngle: 45,
      path: anchor, revision: null });
    assert.equal(result.status, 200);
    let record = (await loadCustomScans(origin)).find(scan => scan.id === id);
    assert.equal(record.type, "tilt");
    assert.equal(record.angleReference, "surface");
    assert.equal(record.custom, !builtin);
    assert.equal(editableMotion(record).startAngle, 15, "saved angles must not be centered a second time");
    assert.ok(Math.abs(settingsProbeOrientation(record, 0).tilt - Math.PI / 12) < 1e-12);
    if (builtin) {
      assert.equal(record.folder, builtin.folder);
      assert.equal(record.directory, builtin.directory);
      assert.deepEqual(record.structures, builtin.structures);
    }
    // Older geometry-only clients must retain the current override, not the builtin kind.
    assert.equal((await update({ ...config, path: anchor, revision: record.revision })).status, 200);
    record = (await loadCustomScans(origin)).find(scan => scan.id === id);
    assert.equal(record.type, "tilt");
    assert.equal(record.startAngle, 15);
    assert.equal((await update({ ...config, type: "linear", path: anchor, revision: record.revision })).status, 400);
    assert.equal((await update({ ...config, type: "tilt", startAngle: null, revision: record.revision })).status, 400);
    assert.equal((await update({ ...config, type: "linear", revision: record.revision })).status, 200);
    record = (await loadCustomScans(origin)).find(scan => scan.id === id);
    assert.equal(record.type, "linear");
    assert.deepEqual(record.path, config.path);
    assert.equal(settingsProbeOrientation(record, 0.5).tilt, 0);
    const stored = await env.SCANS.get(`published:${id}`, "json");
    for (const key of ["angleReference", "startAngle", "endAngle", "axis"])
      assert.equal(stored[key], undefined);
  }
  assert.deepEqual(await env.SCANS.get(`frames:${customID}:0`, "arrayBuffer"), pack);
});

test("deletion requires authorization and current revision; tombstones block lists, direct routes, frames and stale writes", async t => {
  const env = {
    DEVELOPER_PASSWORD: "test-password-at-least-16", SESSION_SECRET: "test-session-secret-at-least-32-characters",
    LOGIN_LIMITER: { limit: async () => ({ success: true }) }, SCANS: memoryKV(),
  };
  const call = (path, options = {}) => worker.fetch(new Request(origin + path, options), env);
  const login = await call("/login", { method: "POST", headers: { Origin: origin },
    body: new URLSearchParams({ password: env.DEVELOPER_PASSWORD }) });
  const headers = { Origin: origin, Cookie: login.headers.get("Set-Cookie").split(";")[0] };
  const remove = (id, revision = null, auth = headers) => call(`/api/scans/${id}`, {
    method: "DELETE", headers: auth, body: JSON.stringify({ revision }),
  });
  assert.equal((await remove("abs_short", null, {})).status, 401);
  assert.equal((await remove("abs_short", null, { ...headers, Origin: "https://elsewhere.example" })).status, 403);
  assert.equal((await remove("abs_short", "stale")).status, 409);
  assert.equal((await call("/api/scans/abs_short", { method: "POST", headers })).status, 405);
  assert.equal((await remove("nonexistent")).status, 404);
  assert.equal(await env.SCANS.get("deleted:abs_short"), null);
  const customID = "custom-cccccccc-cccc-cccc-cccc-cccccccccccc";
  const original = { ...validateScan(config), id: customID, revision: "current" };
  await env.SCANS.put(`published:${customID}`, JSON.stringify(original));
  const pack = await (await packFrames(Array.from({ length: 10 }, (_, i) => jpeg(i)))).arrayBuffer();
  await env.SCANS.put(`frames:${customID}:0`, pack);
  assert.equal((await remove(customID)).status, 409);
  t.mock.method(globalThis, "fetch", url => call(new URL(url).pathname));
  for (const [id, revision] of [["abs_short", null], [customID, "current"]]) {
    assert.equal((await remove(id, revision)).status, 200);
    const deletion = await env.SCANS.get(`deleted:${id}`, "json");
    assert.equal((await remove(id, revision)).status, 200, "retrying deletion is safe");
    assert.deepEqual(await env.SCANS.get(`deleted:${id}`, "json"), deletion);
    const catalog = await loadCustomScans(origin);
    assert.ok(catalog.some(scan => scan.id === id && scan.deleted));
    assert.ok(!editorScans(catalog).some(scan => scan.id === id));
    assert.deepEqual(scanFromHash(`#/echo/${id}`, catalog), { invalid: true });
    assert.equal((await call(`/api/scans/${id}/settings`, {
      method: "PUT", headers, body: JSON.stringify({ ...config, revision }),
    })).status, 410);
  }
  assert.equal((await call(`/public/frames/${customID}/1.jpg`)).status, 404);
  assert.equal((await call(`/api/drafts/${customID}/publish`, { method: "POST", headers })).status, 410);
  assert.equal((await call(`/api/drafts/${customID}/packs/0`, { method: "PUT", headers, body: pack })).status, 410);
  assert.deepEqual(await env.SCANS.get(`frames:${customID}:0`, "arrayBuffer"), pack, "deletion retains stored media");
  // A write that started before deletion cannot resurrect the catalog entry.
  await env.SCANS.put(`published:${customID}`, JSON.stringify(original));
  assert.equal((await call(`/public/frames/${customID}/1.jpg`)).status, 404);
  const publicData = (await (await call("/public/scans")).json()).scans.find(scan => scan.id === customID);
  assert.deepEqual(Object.keys(publicData).sort(), ["deleted", "id", "revision"]);
  assert.equal(publicData.deleted, true);
  assert.deepEqual(scanFromHash(`#/echo/${customID}`, await loadCustomScans(origin)), { invalid: true });
  // Retrying repairs a request interrupted between tombstone and catalog writes.
  await env.SCANS.put("deleted:abs_long", JSON.stringify({ id: "abs_long", deleted: true, revision: "deleted" }));
  assert.equal((await remove("abs_long")).status, 200);
  assert.ok((await loadCustomScans(origin)).some(scan => scan.id === "abs_long" && scan.deleted));
  assert.equal(editorScans(SCANS.map(scan => ({ id: scan.id, deleted: true }))).length, 0);
});
