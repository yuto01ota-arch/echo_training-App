import { CAMERA } from "../config.js";
import * as THREE from "three";
import { placeProbe, probeHitSize } from "./probe.js";
import { renderSnapshot } from "./renderSnapshot.js";

export function bodyMesh(object) {
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
  if (!body) throw new Error("人体モデルを読み込んでください。");
  body.skeleton.update();
  return body;
}
export function cameraFromSetting(setting, aspect) {
  // Keep the chosen vertical framing when moving from the wide editor to
  // the narrower echo panel. Only the horizontal field of view changes.
  const span = setting.span;
  const camera = new THREE.OrthographicCamera(
    (-span * aspect) / 2,
    (span * aspect) / 2,
    span / 2,
    -span / 2,
    CAMERA.near,
    CAMERA.far,
  );
  camera.position.fromArray(setting.position);
  camera.up.fromArray(setting.up);
  camera.lookAt(new THREE.Vector3(...setting.target));
  camera.updateMatrixWorld();
  return camera;
}
export function cameraSetting(camera, target) {
  return {
    position: camera.position.toArray(),
    target: target.toArray(),
    up: camera.up.toArray(),
    span: (camera.top - camera.bottom) / camera.zoom,
    aspect: (camera.right - camera.left) / (camera.top - camera.bottom),
  };
}
export function planeFromCamera(camera) {
  camera.updateMatrixWorld();
  return {
    right: new THREE.Vector3()
      .setFromMatrixColumn(camera.matrixWorld, 0)
      .toArray(),
    up: new THREE.Vector3()
      .setFromMatrixColumn(camera.matrixWorld, 1)
      .toArray(),
    normal: new THREE.Vector3()
      .setFromMatrixColumn(camera.matrixWorld, 2)
      .toArray(),
  };
}
export function pointInPlane(point, plane) {
  return {
    x: point.dot(new THREE.Vector3(...plane.right)),
    y: point.dot(new THREE.Vector3(...plane.up)),
  };
}
function contactFromHit(hit, body, normal) {
  const smooth = new THREE.Vector3();
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
    smooth.addScaledVector(offset.sub(vertex), hit.barycoord.getComponent(i));
  });
  smooth.transformDirection(body.matrixWorld);
  if (smooth.dot(normal) < 0) smooth.negate();
  return { point: hit.point, normal: smooth };
}
// Bake the current pose once for repeated editor raycasts. The renderer keeps
// using the rigged model; only this CPU-only mesh is used to query its surface.
export function createSurfaceSnapshot(body) {
  const positions = new Float32Array(
    body.geometry.attributes.position.count * 3,
  );
  const vertex = new THREE.Vector3();
  for (let i = 0; i < positions.length / 3; i++) {
    body.getVertexPosition(i, vertex).toArray(positions, i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(body.geometry.index);
  geometry.groups = body.geometry.groups.map((group) => ({ ...group }));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, body.material);
  mesh.matrixAutoUpdate = false;
  mesh.matrixWorld.copy(body.matrixWorld);
  return mesh;
}
export function surfaceContact(body, plane, point, surface = body) {
  const normal = new THREE.Vector3(...plane.normal);
  const origin = new THREE.Vector3(...plane.right)
    .multiplyScalar(point.x)
    .addScaledVector(new THREE.Vector3(...plane.up), point.y)
    .addScaledVector(normal, 4);
  const hit = new THREE.Raycaster(
    origin,
    normal.clone().negate(),
  ).intersectObject(surface, false)[0];
  if (!hit)
    throw new Error(
      "走査線が体表から外れています。開始点・終了点を調整してください。",
    );
  return contactFromHit(hit, body, normal);
}
export function settingsProbeOrientation(scan, progress) {
  return {
    roll: THREE.MathUtils.degToRad(scan.rotate),
    tilt:
      scan.type === "tilt"
        ? THREE.MathUtils.degToRad(
            scan.custom || scan.angleReference === "surface"
              ? THREE.MathUtils.lerp(scan.startAngle, scan.endAngle, THREE.MathUtils.clamp(progress, 0, 1))
              : (scan.endAngle - scan.startAngle) * (progress - 0.5),
          )
        : 0,
  };
}
export function renderCustomScan({
  renderer,
  scene,
  object,
  probe,
  canvas,
  scan,
  progress,
  cache,
}) {
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return null;
  const camera = cameraFromSetting(scan.camera, width / height);
  const body = bodyMesh(object);
  function contact(t) {
    if (
      scan.path.start.x === scan.path.end.x &&
      scan.path.start.y === scan.path.end.y
    )
      t = 0;
    const key = `${scan.id}:${scan.revision ?? "base"}:${t}`;
    if (!cache.has(key))
      cache.set(
        key,
        surfaceContact(body, scan.plane, {
          x: scan.path.start.x + (scan.path.end.x - scan.path.start.x) * t,
          y: scan.path.start.y + (scan.path.end.y - scan.path.start.y) * t,
        }),
      );
    return cache.get(key);
  }
  const hit = contact(progress);
  placeProbe(probe, hit, settingsProbeOrientation(scan, progress));
  probe.visible = true;
  try {
    renderSnapshot(renderer, scene, camera, canvas, width, height);
  } finally {
    probe.visible = false;
  }
  const project = (p) => {
    const v = p.clone().project(camera);
    return { x: (v.x + 1) * 50, y: (1 - v.y) * 50 };
  };
  return {
    path: [contact(0), contact(1)].map((c) => project(c.point)),
    point: project(hit.point),
    probe: probeHitSize(probe, camera, hit.point, width, height),
  };
}
