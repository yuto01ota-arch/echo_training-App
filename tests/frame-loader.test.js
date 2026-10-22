import test from "node:test";
import assert from "node:assert/strict";
import { createFrameLoader } from "../src/echo/frameLoader.js";

function setup() {
  const images = [];
  const loaded = [];
  let errors = 0;
  globalThis.Image = class {
    constructor() {
      images.push(this);
    }
    removeAttribute() {
      this.src = "";
    }
    decode() {
      return Promise.resolve();
    }
  };
  const loader = createFrameLoader({
    frameCount: 200,
    urlForFrame: (frame) => `frame-${frame}`,
    onLoad: (value) => loaded.push(value.frame),
    onError: () => errors++,
  });
  return {
    loader,
    images,
    loaded,
    errors: () => errors,
    image: (frame) =>
      images.findLast((image) => image.src === `frame-${frame}`),
  };
}

test("nearby frames are decoded and reused, with bounded requests and retained images", async () => {
  const { loader, images, loaded, image } = setup();
  loader.request(1);
  assert.equal(images.length, 1, "selected frame takes priority");
  await image(1).onload();
  while (images.some((item) => item.onload)) {
    const pending = images.filter((item) => item.onload);
    assert.ok(pending.length <= 2);
    await pending[0].onload();
  }
  assert.equal(
    images.length,
    4,
    "only valid neighbours at the boundary are loaded",
  );
  const cached = image(2);
  loader.request(2);
  assert.equal(loaded.at(-1), 2, "cached frame is available synchronously");
  assert.equal(image(2), cached);
  for (const frame of [50, 51, 100, 150, 200]) {
    loader.request(frame);
    if (image(frame).onload) await image(frame).onload();
    while (images.some((item) => item.onload)) {
      assert.ok(images.filter((item) => item.onload).length <= 2);
      await images.find((item) => item.onload).onload();
    }
    assert.ok(images.filter((item) => item.src).length <= 7);
  }
  loader.dispose();
  assert.equal(images.filter((item) => item.src).length, 0);
});

test("obsolete decode completions cannot replace the selected frame or update after disposal", async () => {
  const { loader, loaded, image } = setup();
  loader.request(1);
  let finishDecode;
  image(1).decode = () =>
    new Promise((resolve) => {
      finishDecode = resolve;
    });
  const pending = image(1).onload();
  loader.request(200);
  await image(200).onload();
  finishDecode();
  await pending;
  assert.deepEqual(loaded, [200]);
  loader.request(100);
  image(100).decode = () =>
    new Promise((resolve) => {
      finishDecode = resolve;
    });
  const last = image(100).onload();
  loader.dispose();
  finishDecode();
  await last;
  assert.deepEqual(loaded, [200]);
});

test("speculative failures stay silent; selected failures can be retried", async () => {
  const { loader, loaded, image, errors } = setup();
  loader.request(1);
  await image(1).onload();
  image(2).onerror();
  assert.equal(errors(), 0);
  loader.request(2);
  assert.equal(errors(), 1);
  loader.request(2, true);
  await image(2).onload();
  assert.equal(loaded.at(-1), 2);
  loader.dispose();
});
