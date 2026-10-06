import { STORED_MEDIA } from "../config.js";
import { builtinScan, validateSettings } from "./settings.js";
import { CUSTOM_ID, validateScan } from "./schema.js";

export async function loadCustomScans(developerURL, signal) {
  const origin = new URL(developerURL).origin;
  const scans = [],
    seen = new Set();
  let cursor = "";
  do {
    const url = new URL("/public/scans", origin);
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, {
      signal,
      credentials: "omit",
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(
        "部位の設定を読み込めませんでした。開発者ページの接続を確認してください。",
      );
    const data = await response.json();
    for (const record of data.scans) {
      const builtin = builtinScan(record.id);
      if ((!builtin && !CUSTOM_ID.test(record.id)) || seen.has(record.id))
        continue;
      if (record.deleted === true) {
        scans.push({ id: record.id, deleted: true, revision: record.revision ?? null });
        seen.add(record.id);
        continue;
      }
      scans.push(
        builtin
          ? {
              ...builtin,
              ...validateSettings(record, builtin),
              custom: false,
              revision: record.revision ?? null,
            }
          : {
              ...validateScan(record, {
                frameCount: record.frameCount,
                packSize: record.packSize ?? STORED_MEDIA.legacyPackSize,
              }),
              id: record.id,
              revision: record.revision ?? null,
              frameBase: `${origin}/public/frames/${record.id}/`,
            },
      );
      seen.add(record.id);
    }
    cursor = data.cursor || "";
  } while (cursor);
  return scans.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "", "ja"));
}
