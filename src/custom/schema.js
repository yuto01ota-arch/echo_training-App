import { FRAME_COUNT, PACK_SIZE, VALIDATION, IMAGE } from "../config.js";
// 既存の呼び出し元向け再エクスポート。値の定義は config.js のみ。
export { FRAME_COUNT, PACK_SIZE, PACK_COUNT } from "../config.js";
export const CUSTOM_ID = /^custom-[a-f0-9-]{36}$/;

export function validateScan(input, {
  allowStationary = false,
  frameCount = FRAME_COUNT,
  packSize = PACK_SIZE,
} = {}) {
  const fail = () => {
    throw new Error(
      "部位の設定が正しくありません。名前・カメラ・開始点と終了点を確認してください。",
    );
  };
  const number = (n, min, max) =>
    typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
  const vector = (value) =>
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) =>
      number(n, -VALIDATION.maxVectorCoordinate, VALIDATION.maxVectorCoordinate),
    );
  const text = (value) =>
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= VALIDATION.maxTextLength;
  const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
  if (
    !Number.isSafeInteger(frameCount) || frameCount < 2 ||
    !Number.isSafeInteger(packSize) || packSize < 1 || frameCount % packSize !== 0 ||
    !input ||
    !text(input.title) ||
    !text(input.category) ||
    !["male", "female"].includes(input.model) ||
    !["standing", "armsOpen"].includes(input.pose) ||
    !["front", "right", "left", "back"].includes(input.view) ||
    !number(input.rotate,
      -VALIDATION.maxRotationDegrees, VALIDATION.maxRotationDegrees,
    )
  )
    fail();
  const { camera, plane, path } = input;
  if (
    !camera ||
    !vector(camera.position) ||
    !vector(camera.target) ||
    !vector(camera.up) ||
    !number(camera.span, VALIDATION.minCameraSpan, VALIDATION.maxCameraSpan) ||
    !number(camera.aspect, VALIDATION.minCameraAspect, VALIDATION.maxCameraAspect)
  )
    fail();
  const direction = camera.position.map((n, i) => n - camera.target[i]);
  const cross = direction.map(
    (_, i) =>
      direction[(i + 1) % 3] * camera.up[(i + 2) % 3] -
      direction[(i + 2) % 3] * camera.up[(i + 1) % 3],
  );
  if (
    dot(direction, direction) < VALIDATION.minCameraDistanceSquared ||
    dot(cross, cross) < VALIDATION.minCameraCrossSquared
  ) fail();
  if (
    !plane ||
    !["right", "up", "normal"].every(
      (k) => vector(plane[k]) &&
        Math.abs(dot(plane[k], plane[k]) - 1) < VALIDATION.basisTolerance,
    ) ||
    Math.abs(dot(plane.right, plane.up)) > VALIDATION.basisTolerance ||
    Math.abs(dot(plane.right, plane.normal)) > VALIDATION.basisTolerance ||
    Math.abs(dot(plane.up, plane.normal)) > VALIDATION.basisTolerance
  )
    fail();
  if (
    !path ||
    !["start", "end"].every(
      (k) => path[k] &&
        number(path[k].x, -VALIDATION.maxPathCoordinate, VALIDATION.maxPathCoordinate) &&
        number(path[k].y, -VALIDATION.maxPathCoordinate, VALIDATION.maxPathCoordinate),
    )
  )
    fail();
  if (
    !allowStationary &&
    Math.hypot(path.start.x - path.end.x, path.start.y - path.end.y) <
      VALIDATION.minPathDistance
  )
    throw new Error("開始点と終了点は少し離して指定してください。");
  if (
    !Number.isInteger(input.imageWidth) ||
    !Number.isInteger(input.imageHeight) ||
    !number(input.imageWidth, 1, IMAGE.maxAcceptedDimension) ||
    !number(input.imageHeight, 1, IMAGE.maxAcceptedDimension)
  )
    fail();
  // Copy only the supported fields. Never persist arbitrary URLs or HTML.
  return {
    version: 1,
    custom: true,
    title: input.title.trim(),
    category: input.category.trim(),
    model: input.model,
    pose: input.pose,
    view: input.view,
    rotate: input.rotate,
    camera: {
      position: [...camera.position],
      target: [...camera.target],
      up: [...camera.up],
      span: camera.span,
      aspect: camera.aspect,
    },
    plane: {
      right: [...plane.right],
      up: [...plane.up],
      normal: [...plane.normal],
    },
    path: {
      start: { x: path.start.x, y: path.start.y },
      end: { x: path.end.x, y: path.end.y },
    },
    imageWidth: input.imageWidth,
    imageHeight: input.imageHeight,
    frameCount,
    packSize,
    structures: [],
  };
}
