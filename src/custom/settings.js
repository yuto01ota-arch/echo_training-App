import { SCANS } from "../echo/scans.js";
import { editableMotion } from "../echo/scanMotion.js";
import { validateScan } from "./schema.js";

export const builtinScan = (id) => SCANS.find((scan) => scan.id === id);

// Editing changes only the 3D presentation, never the images or annotations.
export function validateSettings(input, scan) {
  const motion = editableMotion(scan);
  // Read old builtin overrides without changing their motion before the user saves.
  const legacyTilt = input.type === undefined && scan.type === "tilt" &&
    !scan.custom && scan.angleReference !== "surface";
  const config = validateScan(
    {
      ...input,
      type: legacyTilt ? "linear" : input.type === undefined ? motion.type : input.type,
      startAngle: input.startAngle === undefined ? motion.startAngle : input.startAngle,
      endAngle: input.endAngle === undefined ? motion.endAngle : input.endAngle,
      title: scan.title,
      category: "部位",
      // Geometry-only validation: no replacement image is being uploaded.
      imageWidth: 1,
      imageHeight: 1,
    },
    { allowStationary: legacyTilt },
  );
  const { model, pose, view, rotate, camera, plane, path } = config;
  return { model, pose, view, rotate, camera, plane, path,
    ...(!legacyTilt ? {
      type: config.type,
      ...(config.type === "tilt" ? {
        startAngle: config.startAngle, endAngle: config.endAngle, axis: config.axis,
        angleReference: config.angleReference,
      } : {}),
    } : {}),
  };
}

export function editorScans(overrides) {
  return [
    ...SCANS.map(
      (scan) => overrides.find((item) => item.id === scan.id) ?? scan,
    ),
    ...overrides.filter((scan) => scan.custom),
  ].filter(scan => !scan.deleted);
}
