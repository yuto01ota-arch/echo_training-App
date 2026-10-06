import { TILT } from "../config.js";

// The original two tilt presets used image angles around a midpoint.
// The editor and saved overrides use degrees relative to the skin normal.
export function editableMotion(scan = {}) {
  const type = scan.type ?? "linear";
  const legacyTilt = type === "tilt" && !scan.custom && scan.angleReference !== "surface";
  return {
    type,
    angleReference: "surface",
    startAngle: type !== "tilt" ? TILT.startAngle
      : legacyTilt ? (scan.startAngle - scan.endAngle) / 2 : scan.startAngle,
    endAngle: type !== "tilt" ? TILT.endAngle
      : legacyTilt ? (scan.endAngle - scan.startAngle) / 2 : scan.endAngle,
    axis: scan.axis ?? TILT.dragAxis,
  };
}
