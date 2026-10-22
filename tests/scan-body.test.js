import {
  bodyMesh,
  createSurfaceSnapshot,
  surfaceContact,
} from "../src/three/customScan.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Box3, Group, Texture, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  createProbe,
  placeProbe,
  probeOrientation,
} from "../src/three/probe.js";
import { disposeObject } from "../src/three/viewer.js";
import { createScanAnchors } from "../src/three/scanBody.js";
import { createPoseController } from "../src/three/poses.js";
import { SCAN_PRESENTATION } from "../src/echo/scanPresentation.js";
import { MODEL_SCAN_PATHS } from "../src/echo/scanPaths.js";
import { SCANS } from "../src/echo/scans.js";

for (const sex of ["male", "female"]) {
  test(`${sex}: every scan endpoint lies on the body and follows its pose`, async () => {
    const buffer = await readFile(
      new URL(`../public/models/human-${sex}.glb`, import.meta.url),
    );
    const loader = new GLTFLoader().register(() => ({
      name: "TestTextureDecoder",
      loadTexture: () => Promise.resolve(new Texture()),
    }));
    const gltf = await loader.parseAsync(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ),
      "",
    );
    const object = new Group();
    object.add(gltf.scene);
    const bounds = new Box3().setFromObject(object);
    const scale = 1.8 / bounds.getSize(new Vector3()).y;
    const center = bounds.getCenter(new Vector3());
    object.scale.setScalar(scale);
    object.position.set(
      -center.x * scale,
      -bounds.min.y * scale,
      -center.z * scale,
    );
    const pose = createPoseController(object);
    const anchors = createScanAnchors(object);
    assert.deepEqual(
      Object.keys(MODEL_SCAN_PATHS).sort(),
      SCANS.map((scan) => scan.id).sort(),
    );
    const initial = {};
    for (const id of Object.keys(MODEL_SCAN_PATHS)) {
      initial[id] = anchors.positions(id);
      initial[id].forEach((point, index) => {
        const expected =
          index === 0 ? MODEL_SCAN_PATHS[id].start : MODEL_SCAN_PATHS[id].end;
        const view = SCAN_PRESENTATION[id].view;
        const x = {
          front: point.x,
          back: -point.x,
          right: point.z,
          left: -point.z,
        }[view];
        assert.ok(
          Math.abs(x - expected.x) < 1e-6,
          `${id}: configured x is preserved`,
        );
        assert.ok(
          Math.abs(point.y - expected.y) < 1e-6,
          `${id}: configured y is preserved`,
        );
      });
    }
    pose("armsOpen");
    assert.ok(
      anchors
        .positions("median_nerve_200")[0]
        .distanceTo(initial.median_nerve_200[0]) > 0.1,
    );
    for (const id of Object.keys(MODEL_SCAN_PATHS)) {
      for (const point of anchors.positions(id))
        assert.ok(point.toArray().every(Number.isFinite), id);
    }
    // A real probe must contact the curved skin between endpoints, rather
    // than cutting a straight chord through the abdomen in 3D.
    const probe = createProbe();
    assert.ok(Math.abs(new Box3().setFromObject(probe).min.z) < 1e-6);
    for (const poseId of ["standing", "armsOpen"]) {
      pose(poseId);
      const path = anchors.positions("abs_long");
      const depths = [];
      const body = bodyMesh(object);
      const surface = createSurfaceSnapshot(body);
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        const contact = anchors.contact("abs_long", progress);
        const expected = path[0].clone().lerp(path[1], progress);
        const baked = surfaceContact(
          body,
          { right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1] },
          { x: expected.x, y: expected.y },
          surface,
        );
        assert.ok(
          baked.point.distanceTo(contact.point) < 2e-6,
          "cached surface retains posed skin contact",
        );
        assert.ok(
          baked.normal.dot(contact.normal) > 0.99999,
          "cached surface retains skin normals",
        );
        assert.ok(Math.abs(contact.point.x - expected.x) < 1e-6);
        assert.ok(Math.abs(contact.point.y - expected.y) < 1e-6);
        assert.ok(contact.normal.z > 0.5, "probe faces outward from the torso");
        assert.ok(Math.abs(contact.normal.length() - 1) < 1e-6);
        placeProbe(probe, contact);
        const direction = new Vector3(0, 0, 1).applyQuaternion(
          probe.quaternion,
        );
        assert.ok(direction.dot(contact.normal) > 0.99999);
        assert.ok(
          Math.abs(probe.position.distanceTo(contact.point) - 0.0005) < 1e-6,
        );
        depths.push(contact.point.z);
      }
      surface.geometry.dispose();
      assert.ok(
        Math.max(...depths) - Math.min(...depths) > 0.005,
        "contact follows body depth",
      );
    }
    const views = {
      front: new Vector3(0, 0, 1),
      back: new Vector3(0, 0, -1),
      right: new Vector3(-1, 0, 0),
      left: new Vector3(1, 0, 0),
    };
    for (const selectedPose of ["standing", "armsOpen"]) {
      for (const scan of SCANS) {
        pose(SCAN_PRESENTATION[scan.id].pose ?? selectedPose);
        const normal = views[SCAN_PRESENTATION[scan.id].view];
        const path = anchors.positions(scan.id);
        let firstContact;
        let firstRotation;
        for (const progress of [0, 0.5, 1]) {
          const label = `${sex}/${selectedPose}/${scan.id}/${progress}`;
          const contact = anchors.contact(scan.id, progress);
          const expected = path[0].clone().lerp(path[1], progress);
          const horizontal = new Vector3(normal.z, 0, -normal.x);
          assert.ok(
            Math.abs(contact.point.clone().sub(expected).dot(horizontal)) <
              1e-6,
            label,
          );
          assert.ok(Math.abs(contact.point.y - expected.y) < 1e-6, label);
          assert.ok(
            contact.point.distanceTo(expected) < 0.15,
            `${label}: contacts the intended body part`,
          );
          assert.ok(contact.normal.dot(normal) > 0, label);
          const orientation = probeOrientation(scan, progress);
          placeProbe(probe, contact, orientation);
          const axis = new Vector3(0, 0, 1).applyQuaternion(probe.quaternion);
          assert.ok(
            Math.abs(axis.dot(contact.normal) - Math.cos(orientation.tilt)) <
              1e-6,
            label,
          );
          if (scan.type === "tilt") {
            if (progress === 0) {
              firstContact = contact.point;
              firstRotation = probe.quaternion.clone();
            } else
              assert.ok(
                contact.point.distanceTo(firstContact) < 1e-6,
                `${label}: tilt retains its anchor`,
              );
            if (progress === 1)
              assert.ok(
                probe.quaternion.angleTo(firstRotation) > 0.9,
                `${label}: probe rocks in 3D`,
              );
          }
        }
      }
    }
    disposeObject(probe);
    pose("standing");
    for (const id of Object.keys(MODEL_SCAN_PATHS)) {
      anchors
        .positions(id)
        .forEach((point, index) =>
          assert.ok(point.distanceTo(initial[id][index]) < 1e-6, id),
        );
    }
  });
}
