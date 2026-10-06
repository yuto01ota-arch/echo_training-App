import { FRAME_COUNT, IMAGE } from "../../src/config.js";

function waitFor(video, event, signal, action) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener(event, done);
      video.removeEventListener("error", fail);
      signal.removeEventListener("abort", cancel);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(
        new Error(
          "動画を読み込めません。ブラウザーで再生できるMP4（H.264）を選んでください。",
        ),
      );
    };
    const cancel = () => {
      cleanup();
      reject(new DOMException("中止しました。", "AbortError"));
    };
    const timer = setTimeout(fail, IMAGE.videoWaitMs);
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", fail, { once: true });
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    else action();
  });
}
export async function extractFrames(file, crop, onProgress, signal) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const url = URL.createObjectURL(file);
  try {
    await waitFor(video, "loadeddata", signal, () => {
      video.src = url;
      video.load();
    });
    if (!Number.isFinite(video.duration) || video.duration <= 0)
      throw new Error("動画の長さを取得できませんでした。");
    const sourceWidth = Math.max(1, Math.round(video.videoWidth * crop));
    const scale = Math.min(1, IMAGE.maxExtractedDimension / Math.max(sourceWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    const frames = [];
    for (let i = 0; i < FRAME_COUNT; i++) {
      signal.throwIfAborted();
      const time =
        ((video.duration - Math.min(IMAGE.endMarginSeconds, video.duration / FRAME_COUNT)) * i) / (FRAME_COUNT - 1);
      if (Math.abs(video.currentTime - time) > IMAGE.seekToleranceSeconds)
        await waitFor(video, "seeked", signal, () => {
          video.currentTime = time;
        });
      context.drawImage(
        video,
        0,
        0,
        sourceWidth,
        video.videoHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", IMAGE.jpegQuality),
      );
      if (!blob) throw new Error("画像の作成に失敗しました。");
      frames.push(blob);
      onProgress(i + 1);
    }
    return { frames, imageWidth: canvas.width, imageHeight: canvas.height };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
