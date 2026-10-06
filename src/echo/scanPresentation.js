// Camera/cropping settings only. Probe coordinates belong in scanPaths.js.
// Crops use the original combined 1920x1080 image coordinates (0..1).
export const SCAN_PRESENTATION = {
  abs_long: { view: "front", crop: 0.595, span: 0.9, rotate: 180 },
  abs_short: { view: "front", crop: 0.595, span: 0.9, rotate: 270 },
  abs_subcostal: { view: "front", crop: 0.595, span: 0.9, rotate: 220 },
  abs_intercostal: {
    view: "right",
    pose: "armsOpen",
    crop: 0.595,
    span: 0.9,
    rotate: 210,
  },
  abs_right_flank: {
    view: "right",
    pose: "armsOpen",
    crop: 0.585,
    videoCrop: 0.57,
    span: 0.9,
    rotate: 90,
  },
  abs_left_flank: {
    view: "left",
    pose: "armsOpen",
    crop: 0.632,
    videoCrop: 0.585,
    cropTop: 0.055,
    span: 0.9,
    rotate: 270,
  },
  median_nerve_200: { view: "front", crop: 0.658, span: 0.55, rotate: 0 },
  ulnar: { view: "front", crop: 0.617, span: 0.55, rotate: 0 },
  radial: { view: "front", crop: 0.626, span: 0.55, rotate: 0 },
  leg_upper: { view: "front", crop: 0.647, span: 0.65, rotate: 10 },
  leg_lower: { view: "back", crop: 0.623, span: 0.65, rotate: 0 },
};
