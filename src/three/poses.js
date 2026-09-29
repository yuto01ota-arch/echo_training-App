import { PropertyBinding, Quaternion, Vector3 } from "three";

export const POSES = [
  { id: "standing", label: "基本姿勢" },
  { id: "armsOpen", label: "腕を広げる" },
];

// Static rotations for the project's added FK rig. Imported GLBs may use an
// unrelated skeleton and intentionally do not receive these pose controls.
export function createPoseController(object) {
  const rest = [];
  object.traverse((child) => {
    if (child.isBone) rest.push([child, child.quaternion.clone()]);
  });
  const left = object.getObjectByName(
    PropertyBinding.sanitizeNodeName("upper_arm.L"),
  );
  const right = object.getObjectByName(
    PropertyBinding.sanitizeNodeName("upper_arm.R"),
  );
  if (!left?.isBone || !right?.isBone)
    throw new Error("人体モデルの骨格が見つかりませんでした。");
  return (pose) => {
    if (!POSES.some((item) => item.id === pose))
      throw new Error("Unknown pose");
    rest.forEach(([bone, quaternion]) => bone.quaternion.copy(quaternion));
    if (pose === "armsOpen") {
      const axis = new Vector3(0, 0, 1);
      left.quaternion.multiply(new Quaternion().setFromAxisAngle(axis, -1.15));
      right.quaternion.multiply(new Quaternion().setFromAxisAngle(axis, 1.15));
    }
    object.updateMatrixWorld(true);
    object.traverse((child) => {
      if (!child.isSkinnedMesh) return;
      child.skeleton.update();
      child.computeBoundingBox();
      child.computeBoundingSphere();
    });
  };
}
