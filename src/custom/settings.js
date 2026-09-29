import { SCANS } from "../echo/scans.js";
import { validateScan } from "./schema.js";

export const builtinScan = (id) => SCANS.find((scan) => scan.id === id);

// Editing changes only the 3D presentation, never the images or annotations.
export function validateSettings(input, scan) {
  const config = validateScan(
    {
      ...input,
      title: scan.title,
      category: "部位",
      // Geometry-only validation: no replacement image is being uploaded.
      imageWidth: 1,
      imageHeight: 1,
    },
    { allowStationary: scan.type === "tilt" },
  );
  const { model, pose, view, rotate, camera, plane, path } = config;
  return { model, pose, view, rotate, camera, plane, path };
}

export function editorScans(overrides) {
  return [
    ...SCANS.map(
      (scan) => overrides.find((item) => item.id === scan.id) ?? scan,
    ),
    ...overrides.filter((scan) => scan.custom),
  ];
}
