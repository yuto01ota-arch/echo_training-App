import { STORED_MEDIA } from "../../src/config.js";
import { useEffect, useRef, useState } from "react";
import { createFrameLoader } from "../../src/echo/frameLoader.js";
import { frameFile } from "../../src/echo/scans.js";
import { SCAN_PRESENTATION } from "../../src/echo/scanPresentation.js";

export default function ExistingPreview({ scan, publicURL, frame }) {
  const loader = useRef(null);
  const [loaded, setLoaded] = useState(null),
    [error, setError] = useState(false);
  useEffect(() => {
    setLoaded(null);
    setError(false);
    if (!publicURL) return;
    const base = publicURL.split("#")[0];
    loader.current = createFrameLoader({
      frameCount: scan.frameCount,
      urlForFrame: (n) =>
        scan.custom
          ? `${scan.frameBase}${n}.jpg`
          : new URL(frameFile(scan, n), base).href,
      onLoad: (value) => {
        setLoaded(value);
        setError(false);
      },
      onError: () => setError(true),
    });
    return () => {
      loader.current?.dispose();
      loader.current = null;
    };
  }, [scan.id, publicURL]);
  useEffect(() => {
    setError(false);
    loader.current?.request(frame);
  }, [scan.id, publicURL, frame]);
  const crop = SCAN_PRESENTATION[scan.id];
  return (
    <>
      {loaded &&
        (scan.custom ? (
          <img
            src={loaded.url}
            alt={`プレビュー画像 フレーム${loaded.frame}`}
          />
        ) : (
          <svg
            className="existing-echo-preview"
            viewBox={`0 ${(crop.cropTop ?? 0) * STORED_MEDIA.builtinHeight} ${STORED_MEDIA.builtinWidth * crop.crop} ${STORED_MEDIA.builtinHeight * (1 - (crop.cropTop ?? 0))}`}
            role="img"
            aria-label={`プレビュー画像 フレーム${loaded.frame}`}
          >
            <defs>
              <clipPath id="echo-preview-crop">
                <rect
                  x="0"
                  y={(crop.cropTop ?? 0) * STORED_MEDIA.builtinHeight}
                  width={STORED_MEDIA.builtinWidth * crop.crop}
                  height={STORED_MEDIA.builtinHeight * (1 - (crop.cropTop ?? 0))}
                />
              </clipPath>
            </defs>
            <image
              href={loaded.url}
              width={STORED_MEDIA.builtinWidth}
              height={STORED_MEDIA.builtinHeight}
              clipPath="url(#echo-preview-crop)"
            />
          </svg>
        ))}
      {!loaded && !error && <p role="status">エコー画像を読み込み中…</p>}
      {error && (
        <div className="existing-image-error" role="alert">
          エコー画像を読み込めませんでした。
          <button
            onClick={() => {
              setError(false);
              loader.current?.request(frame, true);
            }}
          >
            画像を再読み込み
          </button>
        </div>
      )}
    </>
  );
}
