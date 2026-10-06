import * as THREE from "three";
import { renderSnapshot } from "./renderSnapshot.js";

// Names, IDs and structures from main:src/frontend/menuConfig.js (11e6c5b).
// Coordinates are initial UI landmarks on the normalized 1.8 m body, not
// clinical probe coordinates. X < 0 is the subject's right; +Z is anterior.
// 表示番号はこの配列順：正面1〜7、側面8〜10、背面11。
export const REGIONS = [
  {
    id: "abs_long",
    title: "腹部：長軸",
    view: "front",
    point: [0.03, 1.02, 0.15],
    structures: [
      "下大静脈",
      "総腸骨静脈",
      "腹部大動脈",
      "総腸骨動脈",
      "脾静脈",
      "膵臓",
      "腹腔動脈",
      "上腸間膜動脈",
    ],
  },
  {
    id: "abs_short",
    title: "腹部：短軸",
    view: "front",
    point: [-0.04, 1.1, 0.16],
    structures: ["胃", "胆嚢", "総胆管", "下大静脈"],
  },
  {
    id: "abs_subcostal",
    title: "腹部：右肋弓下",
    view: "front",
    point: [-0.12, 1.18, 0.13],
    structures: [],
  },
  // main does not specify a side for the forearm; use the right as a UI example.
  {
    id: "median_nerve_200",
    title: "前腕：正中神経",
    view: "front",
    point: [-0.34, 1.03, 0.04],
    structures: ["正中神経"],
  },
  {
    id: "ulnar",
    title: "前腕：尺骨神経",
    view: "front",
    point: [-0.32, 0.96, 0.03],
    structures: ["尺骨神経", "尺骨動脈"],
  },
  {
    id: "radial",
    title: "前腕：橈骨神経",
    view: "front",
    point: [-0.39, 1.1, 0.04],
    structures: ["橈骨神経", "橈骨動脈"],
  },
  {
    id: "leg_upper",
    title: "下肢(右)：鼠径",
    view: "front",
    point: [-0.11, 0.87, 0.1],
    structures: ["総大腿動脈", "浅大腿動脈", "深大腿動脈", "総大腿静脈"],
  },
  {
    id: "abs_intercostal",
    title: "腹部：右肋間",
    view: "right",
    point: [-0.17, 1.26, 0.05],
    structures: ["門脈", "右肝静脈"],
  },
  {
    id: "abs_right_flank",
    title: "腹部：右側腹部",
    view: "right",
    point: [-0.17, 1.06, 0],
    structures: ["右腎", "肝臓"],
  },
  {
    id: "abs_left_flank",
    title: "腹部：左側腹部",
    view: "left",
    point: [0.17, 1.06, 0],
    structures: ["左腎", "脾臓"],
  },
  {
    id: "leg_lower",
    title: "下肢(右)：膝裏",
    view: "back",
    point: [-0.11, 0.5, -0.08],
    structures: ["膝窩動脈"],
  },
];

// Attach each landmark to an actual skin vertex so it follows static poses.
export function createRegionAnchors(object) {
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
  if (!body) return [];
  object.updateMatrixWorld(true);
  body.skeleton.update();
  const targets = REGIONS.map((region) => new THREE.Vector3(...region.point));
  const nearest = targets.map(() => ({ distance: Infinity, index: 0 }));
  const point = new THREE.Vector3();
  for (let i = 0; i < body.geometry.attributes.position.count; i++) {
    body.getVertexPosition(i, point).applyMatrix4(body.matrixWorld);
    targets.forEach((target, j) => {
      const distance = point.distanceToSquared(target);
      if (distance < nearest[j].distance) nearest[j] = { distance, index: i };
    });
  }
  return REGIONS.map((region, i) => ({
    ...region,
    position() {
      body.skeleton.update();
      return body
        .getVertexPosition(nearest[i].index, new THREE.Vector3())
        .applyMatrix4(body.matrixWorld);
    },
  }));
}

export function renderRegionViews({
  renderer,
  scene,
  object,
  anchors,
  canvases,
  side,
}) {
  const bounds = new THREE.Box3().setFromObject(object);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const views = {
    front: [0, 0, 4],
    side: [side === "right" ? -4 : 4, 0, 0],
    back: [0, 0, -4],
  };
  const output = {};
  for (const [view, canvas] of Object.entries(canvases)) {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) continue;
    const aspect = width / height;
    const span = Math.max(
      size.y * 1.12,
      ((view === "side" ? size.z : size.x) * 1.25) / aspect,
    );
    const camera = new THREE.OrthographicCamera(
      (-span * aspect) / 2,
      (span * aspect) / 2,
      span / 2,
      -span / 2,
      0.01,
      20,
    );
    camera.position.copy(center).add(new THREE.Vector3(...views[view]));
    camera.lookAt(center);
    camera.updateMatrixWorld();
    renderSnapshot(renderer, scene, camera, canvas, width, height);
    output[view] = anchors
      .filter((anchor) => anchor.view === (view === "side" ? side : view))
      .map((anchor) => {
        const point = anchor.position().project(camera);
        return {
          id: anchor.id,
          x: (point.x + 1) * 50,
          y: (1 - point.y) * 50,
        };
      });
  }
  return output;
}
