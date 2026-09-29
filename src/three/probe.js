import * as THREE from "three";
import { SCAN_PRESENTATION } from "../echo/scanPresentation.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// Original, procedural prototype. Local Z points out of the body; the
// contact face is centered at the origin and its long axis follows local Y.
export function createProbe() {
  const probe = new THREE.Group();
  probe.name = "UltrasoundProbe";
  const shell = new THREE.MeshStandardMaterial({
    color: "#f3f4ef",
    roughness: 0.38,
  });
  const lens = new THREE.MeshStandardMaterial({
    color: "#394f58",
    roughness: 0.65,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: "#378d87",
    roughness: 0.42,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: "#738084",
    roughness: 0.9,
  });
  function box(size, radius, material, position, parent = probe) {
    const mesh = new THREE.Mesh(
      new RoundedBoxGeometry(...size, 3, radius),
      material,
    );
    mesh.position.set(...position);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  box([0.03, 0.068, 0.012], 0.005, lens, [0, 0, 0.006]);
  box([0.042, 0.078, 0.036], 0.012, shell, [0, 0, 0.03]);
  const grip = new THREE.Group();
  grip.position.set(0, 0, 0.033);
  grip.rotation.x = 0.48;
  probe.add(grip);
  box([0.029, 0.043, 0.104], 0.013, shell, [0, 0, 0.052], grip);
  box([0.03, 0.044, 0.009], 0.004, accent, [0, 0, 0.078], grip);
  box([0.011, 0.018, 0.008], 0.004, accent, [0, 0, 0.106], grip);
  const cablePath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0.11),
    new THREE.Vector3(0.008, -0.018, 0.13),
    new THREE.Vector3(0.028, -0.045, 0.135),
    new THREE.Vector3(0.04, -0.082, 0.125),
  ]);
  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(cablePath, 24, 0.0035, 8, false),
    rubber,
  );
  cable.castShadow = true;
  grip.add(cable);
  probe.visible = false;
  return probe;
}

// Use the existing in-plane orientation; tilt scans rock around the local
// contact axis, centered on the midpoint of the recorded angle range.
export function probeOrientation(scan, progress) {
  const roll = THREE.MathUtils.degToRad(
    180 - SCAN_PRESENTATION[scan.id].rotate,
  );
  const tilt =
    scan.type === "tilt"
      ? THREE.MathUtils.degToRad(
          (scan.endAngle - scan.startAngle) *
            (THREE.MathUtils.clamp(progress, 0, 1) - 0.5),
        )
      : 0;
  return { roll, tilt };
}

export function placeProbe(
  probe,
  { point, normal },
  { roll = 0, tilt = 0 } = {},
) {
  const outward = normal.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0).addScaledVector(outward, -outward.y);
  if (up.lengthSq() < 1e-10)
    up.set(0, 0, 1).addScaledVector(outward, -outward.z);
  up.normalize();
  const right = new THREE.Vector3().crossVectors(up, outward).normalize();
  probe.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(right, up, outward),
  );
  probe.rotateZ(roll);
  probe.rotateX(tilt);
  // Rock onto the edge of the contact face instead of tilting it through
  // the local skin plane. The x/y scan anchor remains fixed for tilt scans.
  const clearance = 0.034 * Math.abs(Math.sin(tilt));
  probe.position.copy(point).addScaledVector(outward, clearance + 0.0005);
  probe.updateMatrixWorld(true);
}

// Transparent DOM hit target surrounds the rendered mesh, centered on the
// contact point so dragging still follows the configured straight x/y path.
export function probeHitSize(probe, camera, contact, width, height) {
  const bounds = new THREE.Box3().setFromObject(probe);
  const center = contact.clone().project(camera);
  let x = 0,
    y = 0;
  for (const px of [bounds.min.x, bounds.max.x]) {
    for (const py of [bounds.min.y, bounds.max.y]) {
      for (const pz of [bounds.min.z, bounds.max.z]) {
        const projected = new THREE.Vector3(px, py, pz).project(camera);
        x = Math.max(x, (Math.abs(projected.x - center.x) * width) / 2);
        y = Math.max(y, (Math.abs(projected.y - center.y) * height) / 2);
      }
    }
  }
  return { width: Math.max(44, x * 2 + 8), height: Math.max(44, y * 2 + 8) };
}
