import test from "node:test";
import assert from "node:assert/strict";
import { pointOnSegment, dragProgress } from "../src/echo/probeMotion.js";

test("diagonal and reverse paths have equal distances for equal frame increments", () => {
  for (const path of [
    { start: { x: -2, y: 1 }, end: { x: 1, y: 5 } },
    { start: { x: 1, y: 5 }, end: { x: -2, y: 1 } },
  ]) {
    assert.deepEqual(pointOnSegment(path, 0), path.start);
    assert.deepEqual(pointOnSegment(path, 1), path.end);
    let previous = path.start;
    for (let frame = 2; frame <= 200; frame++) {
      const point = pointOnSegment(path, (frame - 1) / 199);
      assert.ok(
        Math.abs(
          Math.hypot(point.x - previous.x, point.y - previous.y) - 5 / 199,
        ) < 1e-10,
      );
      previous = point;
    }
    assert.deepEqual(pointOnSegment(path, -1), path.start);
    assert.deepEqual(pointOnSegment(path, 2), path.end);
  }
});

test("dragging projects onto horizontal, vertical and diagonal screen paths", () => {
  const start = { x: 10, y: 20 };
  assert.equal(
    dragProgress({ start, end: { x: 110, y: 20 } }, { x: 25, y: 100 }),
    0.25,
  );
  assert.equal(
    dragProgress({ start, end: { x: 10, y: -80 } }, { x: 100, y: -50 }),
    0.5,
  );
  const diagonal = { start, end: { x: 310, y: 420 } };
  assert.equal(dragProgress(diagonal, { x: 150, y: 200 }), 0.5);
  assert.equal(dragProgress(diagonal, { x: 400, y: -300 }), 0);
  assert.equal(dragProgress(diagonal, { x: -150, y: -200 }), -0.5);
  assert.equal(dragProgress({ start, end: start }, { x: 1, y: 1 }), 0);
});
