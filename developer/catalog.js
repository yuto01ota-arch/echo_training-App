import { API, STORED_MEDIA, FRAME_COUNT, PACK_SIZE } from "../src/config.js";
import { builtinScan, validateSettings } from "../src/custom/settings.js";
import {
  validateScan,
  CUSTOM_ID,
} from "../src/custom/schema.js";
import { MAX_PACK_BYTES, unpackFrames } from "../src/custom/framePack.js";

export const json = (value, status = 200, publicRead = false) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(publicRead ? { "Access-Control-Allow-Origin": "*" } : {}),
    },
  });
async function bytes(request, limit) {
  if (!request.body) return new ArrayBuffer(0);
  const chunks = [];
  let total = 0;
  const reader = request.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("アップロードするデータが大きすぎます。");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result.buffer;
}
const packKey = (id, index) => `frames:${id}:${index}`;
// A separate, permanent tombstone prevents an in-flight settings write from restoring a deleted scan.
const deletionFor = (env, id) => env.SCANS.get(`deleted:${id}`, "json");
const deletedResponse = () => json({ error: "この部位は削除されています。一覧を再読み込みしてください。" }, 410);
const draftPackKey = (id, index) => `draft-frames:${id}:${index}`;

export async function publicCatalog(request, env) {
  const url = new URL(request.url);
  if (request.method !== "GET")
    return json({ error: "Method Not Allowed" }, 405, true);
  if (!env.SCANS)
    return json({ error: "部位の保存先が未設定です。" }, 503, true);
  if (url.pathname === "/public/scans") {
    const list = await env.SCANS.list({
      prefix: "published:",
      limit: API.catalogPageSize,
      ...(url.searchParams.get("cursor")
        ? { cursor: url.searchParams.get("cursor") }
        : {}),
    });
    const scans = (
      await Promise.all(list.keys.map(async (key) => {
        const record = await env.SCANS.get(key.name, "json");
        if (!record) return null;
        const deletion = await deletionFor(env, record.id);
        return deletion || record.deleted
          ? { id: record.id, deleted: true, revision: deletion?.revision ?? record.revision }
          : record;
      }))
    ).filter(Boolean);
    return json(
      { scans, cursor: list.list_complete ? null : list.cursor },
      200,
      true,
    );
  }
  const match = url.pathname.match(
    /^\/public\/frames\/(custom-[a-f0-9-]{36})\/(\d+)\.jpg$/,
  );
  if (match && CUSTOM_ID.test(match[1])) {
    const id = match[1],
      frame = Number(match[2]);
    const record = await env.SCANS.get(`published:${id}`, "json");
    if (!record || record.deleted || await deletionFor(env, id) || !Number.isInteger(frame) || frame < 1 || frame > record.frameCount)
      return json({ error: "Not Found" }, 404, true);
    const packSize = record.packSize ?? STORED_MEDIA.legacyPackSize;
    const buffer = await env.SCANS.get(
      packKey(id, Math.floor((frame - 1) / packSize)),
      "arrayBuffer",
    );
    if (!buffer)
      return json(
        { error: "画像の反映を待っています。再試行してください。" },
        503,
        true,
      );
    const image = unpackFrames(buffer, packSize)[(frame - 1) % packSize];
    return new Response(image, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": `public, max-age=${API.frameCacheSeconds}`,
        "Access-Control-Allow-Origin": "*",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  return json({ error: "Not Found" }, 404, true);
}

// Called only after cookie authentication and same-origin checks by the Worker.
export async function editorAPI(request, env) {
  if (!env.SCANS) return json({ error: "部位の保存先が未設定です。" }, 503);
  const url = new URL(request.url);
  try {
    if (request.method === "POST" && url.pathname === "/api/drafts") {
      const input = JSON.parse(
        new TextDecoder().decode(await bytes(request, API.maxSettingsBytes)),
      );
      if ((input.frameCount !== undefined && input.frameCount !== FRAME_COUNT) ||
          (input.packSize !== undefined && input.packSize !== PACK_SIZE)) {
        return json({ error: "画像の保存設定が更新されました。ページを再読み込みして画像を作り直してください。" }, 409);
      }
      const config = validateScan(input);
      const id = `custom-${crypto.randomUUID()}`;
      await env.SCANS.put(`draft:${id}`, JSON.stringify({ ...config, id }), {
        expirationTtl: API.draftTtlSeconds,
      });
      return json({ id }, 201);
    }
    const deleteMatch = url.pathname.match(/^\/api\/scans\/([a-zA-Z0-9_-]+)$/);
    if (deleteMatch) {
      if (request.method !== "DELETE") return json({ error: "Method Not Allowed" }, 405);
      const id = deleteMatch[1];
      const builtin = builtinScan(id);
      if (!builtin && !CUSTOM_ID.test(id)) return json({ error: "Not Found" }, 404);
      const previous = await env.SCANS.get(`published:${id}`, "json");
      const existingDeletion = await deletionFor(env, id);
      if (existingDeletion) {
        // Repair the catalog entry if the first request stopped after writing the tombstone.
        if (!previous) await env.SCANS.put(`published:${id}`, JSON.stringify(existingDeletion));
        return json(existingDeletion);
      }
      if (!builtin && !previous) return json({ error: "部位が見つかりません。" }, 404);
      const input = JSON.parse(new TextDecoder().decode(await bytes(request, API.maxSettingsBytes)));
      if (input?.revision !== (previous?.revision ?? null))
        return json({ error: "この部位は更新されています。設定を再読み込みしてから削除してください。" }, 409);
      const record = {
        id, deleted: true, revision: crypto.randomUUID(), deletedAt: new Date().toISOString(),
      };
      await env.SCANS.put(`deleted:${id}`, JSON.stringify(record));
      // Keep stored settings/media intact. Only publish a small deletion marker to clients.
      await env.SCANS.put(`published:${id}`, JSON.stringify({ ...(previous ?? {}), ...record }));
      return json(record);
    }
    const settingsMatch = url.pathname.match(
      /^\/api\/scans\/([a-zA-Z0-9_-]+)\/settings$/,
    );
    if (settingsMatch) {
      if (request.method !== "PUT")
        return json({ error: "Method Not Allowed" }, 405);
      const id = settingsMatch[1];
      const builtin = builtinScan(id);
      if (!builtin && !CUSTOM_ID.test(id))
        return json({ error: "Not Found" }, 404);
      const previous = await env.SCANS.get(`published:${id}`, "json");
      if (previous?.deleted || await deletionFor(env, id)) return deletedResponse();
      if (!builtin && !previous)
        return json({ error: "部位が見つかりません。" }, 404);
      const input = JSON.parse(
        new TextDecoder().decode(await bytes(request, API.maxSettingsBytes)),
      );
      if (input.revision !== (previous?.revision ?? null))
        return json(
          {
            error:
              "この部位は更新されています。部位を読み込み直してから変更してください。",
          },
          409,
        );
      const settings = validateSettings(input, builtin ? { ...builtin, ...previous, custom: false } : previous);
      const record = {
        ...(previous ?? {
          id,
          title: builtin.title,
          builtin: true,
          custom: false,
        }),
        ...settings,
        revision: crypto.randomUUID(),
        updatedAt: new Date().toISOString(),
      };
      if (settings.type === "linear") {
        for (const field of ["startAngle", "endAngle", "angleReference", "axis"]) delete record[field];
      }
      await env.SCANS.put(`published:${id}`, JSON.stringify(record));
      if (await deletionFor(env, id)) return deletedResponse();
      return json(record);
    }
    const match = url.pathname.match(
      /^\/api\/drafts\/(custom-[a-f0-9-]{36})\/(?:packs\/(\d+)|(publish))$/,
    );
    if (!match || !CUSTOM_ID.test(match[1]))
      return json({ error: "Not Found" }, 404);
    const [, id, index, publish] = match;
    const existing = await env.SCANS.get(`published:${id}`, "json");
    if (existing?.deleted || await deletionFor(env, id)) return deletedResponse();
    if (existing)
      return publish && request.method === "POST"
        ? json(existing)
        : json({ error: "保存済みの部位は上書きできません。" }, 409);
    const draft = await env.SCANS.get(`draft:${id}`, "json");
    if (!draft)
      return json(
        { error: "一時保存の期限が切れました。もう一度保存してください。" },
        404,
      );
    const packSize = draft.packSize ?? STORED_MEDIA.legacyPackSize;
    const packCount = draft.frameCount / packSize;
    if (request.method === "PUT" && index !== undefined) {
      const n = Number(index);
      if (!Number.isInteger(n) || n < 0 || n >= packCount)
        return json({ error: "画像番号が正しくありません。" }, 400);
      const buffer = await bytes(request, MAX_PACK_BYTES);
      unpackFrames(buffer, packSize);
      await env.SCANS.put(draftPackKey(id, n), buffer, {
        expirationTtl: API.draftTtlSeconds,
      });
      return json({ saved: true });
    }
    if (request.method === "POST" && publish) {
      // Check the complete set first, then copy one pack at a time.
      // Avoid holding all JPEGs in Worker memory at once.
      const listed = await env.SCANS.list({
        prefix: `draft-frames:${id}:`,
        limit: packCount + 1,
      });
      const keys = new Set(listed.keys.map((key) => key.name));
      if (
        Array.from({ length: packCount }, (_, i) => draftPackKey(id, i)).some(
          (key) => !keys.has(key),
        )
      )
        return json(
          {
            error:
              "画像が揃っていません。しばらく待って保存を再試行してください。",
          },
          409,
        );
      const finalList = await env.SCANS.list({
        prefix: `frames:${id}:`,
        limit: packCount + 1,
      });
      const finalKeys = new Set(finalList.keys.map((key) => key.name));
      for (let i = 0; i < packCount; i++) {
        const pack = await env.SCANS.get(draftPackKey(id, i), "arrayBuffer");
        if (!pack)
          return json(
            { error: "画像の反映を待っています。保存を再試行してください。" },
            409,
          );
        // Separate final keys avoid rewriting a just-uploaded KV key within
        // its one-write-per-second limit. Existing final keys belong to a
        // previous interrupted publication and are immutable, so reuse them.
        if (!finalKeys.has(packKey(id, i)))
          await env.SCANS.put(packKey(id, i), pack);
      }
      const record = { ...draft, createdAt: new Date().toISOString() };
      await env.SCANS.put(`published:${id}`, JSON.stringify(record));
      await env.SCANS.delete(`draft:${id}`);
      if (await deletionFor(env, id)) return deletedResponse();
      return json(record, 201);
    }
    return json({ error: "Method Not Allowed" }, 405);
  } catch (error) {
    return json(
      { error: error.message || "保存に失敗しました。再試行してください。" },
      400,
    );
  }
}
