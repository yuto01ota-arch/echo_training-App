import * as THREE from "three";
import { MODEL_SCAN_PATHS } from "../echo/scanPaths.js";
import { probeHitSize } from "./probe.js";
import { SCAN_PRESENTATION } from "../echo/scanPresentation.js";
import { renderSnapshot } from "./renderSnapshot.js";

const directions = {
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1),
  right: new THREE.Vector3(-1, 0, 0),
  left: new THREE.Vector3(1, 0, 0),
};

// Capture points in the rest pose, then follow their skin triangles in any pose.
export function createScanAnchors(object) {
  object.updateMatrixWorld(true);
  let body;
  object.traverse((child) => {
    if (
      child.isSkinnedMesh &&
      (!body ||
        child.geometry.attributes.position.count >
          body.geometry.attributes.position.count)
    )
      body = child;
  });
  if (!body) throw new Error("人体の体表が見つかりませんでした。");
  body.skeleton.update();
  const anchors = {};
  for (const [id, path] of Object.entries(MODEL_SCAN_PATHS)) {
    const view = SCAN_PRESENTATION[id].view;
    const normal = directions[view];
    const horizontal = new THREE.Vector3(normal.z, 0, -normal.x);
    anchors[id] = [path.start, path.end].map(({ x, y }) => {
      const origin = horizontal
        .clone()
        .multiplyScalar(x)
        .addScaledVector(normal, 2);
      origin.y = y;
      const ray = new THREE.Raycaster(origin, normal.clone().negate());
      // Side scans target the torso, beyond the resting arm in front of it.
      const hit = ray
        .intersectObject(body, false)
        .find(
          (item) =>
            !["right", "left"].includes(view) || Math.abs(item.point.x) < 0.23,
        );
      if (!hit) return null;
      const indices = [hit.face.a, hit.face.b, hit.face.c];
      const triangle = indices.map((index) =>
        body.getVertexPosition(index, new THREE.Vector3()),
      );
      const weights = THREE.Triangle.getBarycoord(
        body.worldToLocal(hit.point.clone()),
        ...triangle,
        new THREE.Vector3(),
      );
      return { indices, weights };
    });
  }
  return {
    // Keep x/y linear, but find actual skin depth at every requested frame.
    contact(id, progress) {
      const path = this.positions(id);
      const position = path[0]
        .clone()
        .lerp(path[1], THREE.MathUtils.clamp(progress, 0, 1));
      const normal = directions[SCAN_PRESENTATION[id].view];
      const ray = new THREE.Raycaster(
        position.clone().addScaledVector(normal, 2),
        normal.clone().negate(),
      );
      const sideView = ["right", "left"].includes(SCAN_PRESENTATION[id].view);
      const hit = ray
        .intersectObject(body, false)
        .find((item) => !sideView || Math.abs(item.point.x) < 0.23);
      if (!hit) throw new Error("プローブの接触位置が体表の外にあります。");
      // Pose the vertex normals as directions, then interpolate them at the hit.
      const smoothNormal = new THREE.Vector3();
      [hit.face.a, hit.face.b, hit.face.c].forEach((index, i) => {
        const vertex = new THREE.Vector3().fromBufferAttribute(
          body.geometry.attributes.position,
          index,
        );
        const offset = vertex
          .clone()
          .add(
            new THREE.Vector3().fromBufferAttribute(
              body.geometry.attributes.normal,
              index,
            ),
          );
        body.applyBoneTransform(index, vertex);
        body.applyBoneTransform(index, offset);
        smoothNormal.addScaledVector(
          offset.sub(vertex),
          hit.barycoord.getComponent(i),
        );
      });
      smoothNormal.transformDirection(body.matrixWorld);
      if (smoothNormal.dot(normal) < 0) smoothNormal.negate();
      return { point: hit.point, normal: smoothNormal };
    },
    positions(id) {
      body.skeleton.update();
      return anchors[id].map((anchor) => {
        if (!anchor)
          throw new Error(
            `${id}: 開始点または終了点が体表の外にあります。scanPaths.jsを確認してください。`,
          );
        const { indices, weights } = anchor;
        return indices
          .reduce(
            (position, index, i) =>
              position.addScaledVector(
                body.getVertexPosition(index, new THREE.Vector3()),
                weights.getComponent(i),
              ),
            new THREE.Vector3(),
          )
          .applyMatrix4(body.matrixWorld);
      });
    },
  };
}

export function renderScanBody({
  renderer,
  scene,
  canvas,
  path,
  scanId,
  probe,
  contact,
}) {
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return null;
  const presentation = SCAN_PRESENTATION[scanId];
  const aspect = width / height;
  const span = Math.max(presentation.span, (presentation.span * 0.72) / aspect);
  const camera = new THREE.OrthographicCamera(
    (-span * aspect) / 2,
    (span * aspect) / 2,
    span / 2,
    -span / 2,
    0.01,
    10,
  );
  const center = scanId.startsWith("abs_")
    ? new THREE.Vector3(0, 1.1, 0)
    : path[0].clone().lerp(path[1], 0.5);
  camera.position
    .copy(center)
    .addScaledVector(directions[presentation.view], 3);
  camera.lookAt(center);
  camera.updateMatrixWorld();
  renderSnapshot(renderer, scene, camera, canvas, width, height);
  const projectedPath = path.map((position) => {
    const point = position.clone().project(camera);
    return { x: (point.x + 1) * 50, y: (1 - point.y) * 50 };
  });
  return {
    path: projectedPath,
    probe: probe
      ? probeHitSize(probe, camera, contact.point, width, height)
      : null,
  };
}
