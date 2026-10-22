import test from "node:test";
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import {
  SCANS,
  annotationPolygons,
  frameFile,
  scanFromHash,
} from "../src/echo/scans.js";
import { REGIONS } from "../src/three/regions.js";

test("every clickable region has all frames and its original main annotation module", async () => {
  assert.equal(SCANS.length, REGIONS.length);
  for (const region of REGIONS) {
    const scan = scanFromHash(`#/echo/${region.id}`);
    assert.equal(scan?.title, region.title);
    assert.deepEqual(scan.structures, region.structures);
    const module = await import(
      `../src/echo/source/${scan.directory}/${scan.id}.js`
    );
    if (scan.structures.length) assert.ok(module.default);
    await Promise.all(
      Array.from({ length: scan.frameCount }, async (_, index) => {
        const file = new URL(
          `../public/${frameFile(scan, index + 1)}`,
          import.meta.url,
        );
        assert.ok((await stat(file)).size > 1000, `missing image: ${file}`);
      }),
    );
  }
  assert.equal(scanFromHash(""), null);
  assert.equal(scanFromHash("#/echo/does-not-exist").invalid, true);
});

test("annotations interpolate between keyframes without leaking outside their range", () => {
  const structure = {
    border: "red",
    points: [
      { frame: 10, p: [{ x: 0, y: 0.2 }] },
      { frame: 20, p: [{ x: 1, y: 0.6 }] },
    ],
  };
  assert.deepEqual(annotationPolygons(structure, 15)[0].points, [
    { x: 0.5, y: 0.4 },
  ]);
  assert.equal(annotationPolygons(structure, 9).length, 0);
  assert.equal(annotationPolygons(structure, 21).length, 0);
  assert.deepEqual(annotationPolygons(structure, 20)[0].points, [
    { x: 1, y: 0.6 },
  ]);
  assert.equal(
    annotationPolygons(
      {
        points: [
          {
            frame: 1,
            segments: [{ p: [{ x: 0, y: 0 }] }, { p: [{ x: 1, y: 1 }] }],
          },
        ],
      },
      1,
    ).length,
    2,
  );
});
