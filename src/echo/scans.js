import { STORED_MEDIA } from "../config.js";
import { menuConfig } from "./source/menuConfig.js";

const directories = {
  ABDOMEN: "abdomen",
  "UPPER LIMB": "upperLimb",
  "LOWER LIMB": "lowerLimb",
};
export const SCANS = menuConfig.flatMap((category) =>
  category.items.map((item) => ({
    ...item,
    id: item.folder,
    frameCount: item.frameCount ?? STORED_MEDIA.builtinFrameCount,
    directory: directories[category.category],
  })),
);

export function scanFromHash(hash, extraScans = []) {
  if (!hash || hash === "#" || hash === "#/") return null;
  return (
    [...extraScans, ...SCANS].find((scan) => hash === `#/echo/${scan.id}`) ?? {
      invalid: true,
    }
  );
}

export function frameFile(scan, frame) {
  return `echo/data/${scan.folder}/frame_${String(frame).padStart(STORED_MEDIA.filenameDigits, "0")}.jpg`;
}

// main's keyframe interpolation, including structures with multiple segments.
export function annotationPolygons(structure, frame) {
  const points = structure?.points;
  if (!points?.length || frame < points[0].frame || frame > points.at(-1).frame)
    return [];
  let start = points[0],
    end = points.at(-1);
  for (let i = 0; i < points.length - 1; i++) {
    if (frame >= points[i].frame && frame <= points[i + 1].frame) {
      start = points[i];
      end = points[i + 1];
      break;
    }
  }
  const ratio = (frame - start.frame) / (end.frame - start.frame || 1);
  const from = start.segments ?? [{ p: start.p }];
  const to = end.segments ?? [{ p: end.p }];
  return Array.from(
    { length: Math.max(from.length, to.length) },
    (_, index) => {
      const a = from[index] ?? from[0],
        b = to[index] ?? to[0];
      if (!a?.p || !b?.p) return null;
      return {
        border: a.border ?? structure.border ?? "#00d1ff",
        color: a.color ?? structure.color ?? "rgba(0,209,255,.2)",
        points: a.p.map((p, i) => ({
          x: p.x + ((b.p[i] ?? p).x - p.x) * ratio,
          y: p.y + ((b.p[i] ?? p).y - p.y) * ratio,
        })),
      };
    },
  ).filter(Boolean);
}
