import { STORED_MEDIA } from "../config.js";
import { useEffect, useRef, useState } from "react";
import { annotationPolygons, frameFile } from "../echo/scans.js";
import { SCAN_PRESENTATION } from "../echo/scanPresentation.js";
import { createFrameLoader } from "../echo/frameLoader.js";
import EchoBodyModel from "./EchoBodyModel.jsx";

const annotationModules = import.meta.glob("../echo/source/*/*.js");
const base = import.meta.env.BASE_URL;

export default function EchoScanner({
  scan,
  onBack,
  viewer,
  model,
  pose,
  modelLoading,
  modelError,
  onRetryModel,
}) {
  const presentation = scan.custom ? { crop: 1 } : SCAN_PRESENTATION[scan.id];
  const [frame, setFrame] = useState(1);
  const [loaded, setLoaded] = useState(null);
  const [imageError, setImageError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState({});
  const [dataError, setDataError] = useState(false);
  const [enabled, setEnabled] = useState({});
  const [breathing, setBreathing] = useState(false);
  const crop = breathing ? presentation.videoCrop : presentation.crop;
  const cropTop = breathing ? 0 : (presentation.cropTop ?? 0);
  const [videoError, setVideoError] = useState(false);
  const title = useRef(null);
  const video = useRef(null);
  const frameLoader = useRef(null);
  const ready = loaded?.frame === frame && !imageError;
  const hasBreath = ["abs_left_flank", "abs_right_flank"].includes(scan.id);

  useEffect(() => {
    title.current?.focus();
  }, []);
  useEffect(() => {
    if (scan.custom) return;
    let active = true;
    annotationModules[`../echo/source/${scan.directory}/${scan.folder}.js`]()
      .then((module) => {
        if (active) setData((module.default ?? module)[scan.title] ?? {});
      })
      .catch(() => {
        if (active) setDataError(true);
      });
    return () => {
      active = false;
    };
  }, [scan]);

  useEffect(() => {
    const loader = createFrameLoader({
      frameCount: scan.frameCount,
      urlForFrame: (value) =>
        scan.custom
          ? `${scan.frameBase}${value}.jpg`
          : `${base}${frameFile(scan, value)}`,
      onLoad: setLoaded,
      onError: () => setImageError(true),
    });
    frameLoader.current = loader;
    return () => loader.dispose();
  }, [scan]);

  useEffect(() => {
    setImageError(false);
    frameLoader.current.request(frame, retry > 0);
  }, [scan, frame, retry]);

  function changeFrame(value) {
    const next = Number(value);
    if (Number.isFinite(next))
      setFrame(Math.max(1, Math.min(scan.frameCount, Math.round(next))));
  }

  async function startBreathing() {
    setVideoError(false);
    setBreathing(true);
    try {
      await video.current.play();
    } catch {
      setBreathing(false);
      setVideoError(true);
    }
  }

  return (
    <section className="echo-screen" aria-label="エコー画面">
      <div className="echo-heading">
        <button className="echo-back" onClick={onBack}>
          ← 部位選択に戻る
        </button>
        <div>
          <h1 tabIndex={-1} ref={title}>
            {scan.title}
          </h1>
        </div>
      </div>
      <p className="echo-structures">
        対象構造：{scan.structures.join("・") || "登録なし"}
      </p>
      <div className="echo-workspace">
        <div
          className="echo-monitor echo-monitor--model"
          style={{
            "--echo-crop": crop,
            "--echo-crop-top": `${(-cropTop / (1 - cropTop)) * 100}%`,
            "--echo-crop-aspect":
              ((scan.imageWidth ?? STORED_MEDIA.builtinWidth) * crop) /
              ((scan.imageHeight ?? STORED_MEDIA.builtinHeight) * (1 - cropTop)),
          }}
        >
          <div className="echo-image-panel">
            <div className="echo-image-clip" aria-busy={!ready && !imageError}>
              <div className="echo-image-stage">
                {loaded && (
                  <img
                    className="echo-frame"
                    src={loaded.url}
                    alt={`${scan.title} エコー画像 フレーム${loaded.frame}`}
                    draggable={false}
                  />
                )}
                {!loaded && <div className="echo-placeholder" />}
                {loaded && !breathing && (
                  <>
                    <svg
                      className="echo-annotations"
                      viewBox="0 0 1000 1000"
                      preserveAspectRatio="none"
                      aria-label="構造物の表示"
                    >
                      {scan.structures
                        .filter((name) => enabled[name])
                        .flatMap((name) =>
                          annotationPolygons(data[name], loaded.frame).map(
                            (polygon, index) => (
                              <polygon
                                key={`${name}-${index}`}
                                data-structure={name}
                                points={polygon.points
                                  .map((p) => `${p.x * 1000},${p.y * 1000}`)
                                  .join(" ")}
                                fill={polygon.color}
                                stroke={polygon.border}
                                strokeWidth="2"
                                vectorEffect="non-scaling-stroke"
                              >
                                <title>{name}</title>
                              </polygon>
                            ),
                          ),
                        )}
                    </svg>
                  </>
                )}
                {(!loaded || imageError) && (
                  <div
                    className="echo-image-status"
                    role={imageError ? "alert" : "status"}
                  >
                    {imageError ? (
                      <>
                        <span>
                          フレーム{frame}の画像を読み込めませんでした。
                        </span>
                        <button onClick={() => setRetry((value) => value + 1)}>
                          画像を再読み込み
                        </button>
                      </>
                    ) : (
                      "画像を読み込み中…"
                    )}
                  </div>
                )}
                {hasBreath && (
                  <video
                    ref={video}
                    className="echo-breath-video"
                    hidden={!breathing}
                    src={`${base}echo/${scan.id}_inhale.mp4`}
                    preload="none"
                    playsInline
                    muted
                    onEnded={() => setBreathing(false)}
                    onError={() => {
                      setBreathing(false);
                      setVideoError(true);
                    }}
                  />
                )}
              </div>
            </div>
          </div>
          <EchoBodyModel
            scan={scan}
            disabled={breathing}
            viewer={viewer}
            model={model}
            pose={pose}
            loading={modelLoading}
            error={modelError}
            onRetry={onRetryModel}
            frame={frame}
            frameCount={scan.frameCount}
            onFrame={changeFrame}
          />
        </div>
        <div className="echo-controls">
          <label htmlFor="echo-frame-slider">
            {scan.type === "tilt" ? "プローブの傾き" : "スキャン位置"} · {frame}{" "}
            / {scan.frameCount}
            {loaded && !ready && (
              <span className="echo-displayed-frame">
                （表示画像：{loaded.frame}）
              </span>
            )}
          </label>
          <input
            id="echo-frame-slider"
            type="range"
            min="1"
            max={scan.frameCount}
            value={frame}
            disabled={breathing}
            onChange={(event) => changeFrame(event.target.value)}
          />
          <div className="echo-frame-controls">
            <button
              disabled={breathing || frame === 1}
              onClick={() => changeFrame(frame - 1)}
            >
              前のフレーム
            </button>
            <label>
              フレーム番号{" "}
              <input
                type="number"
                min="1"
                max={scan.frameCount}
                value={frame}
                disabled={breathing}
                onChange={(event) => changeFrame(event.target.value)}
              />
            </label>
            <button
              disabled={breathing || frame === scan.frameCount}
              onClick={() => changeFrame(frame + 1)}
            >
              次のフレーム
            </button>
          </div>
          <p className="echo-hint">
            プローブをドラッグするか、スライダーで画像を切り替えられます。
          </p>
          <h2>構造物を表示</h2>
          {scan.structures.length > 0 && (
            <p className="echo-hint">
              灰色の項目は、このフレームに表示データがありません。
            </p>
          )}
          <div className="echo-structure-buttons">
            {scan.structures.map((name) => {
              const available =
                annotationPolygons(data[name], loaded?.frame ?? frame).length >
                0;
              return (
                <button
                  key={name}
                  aria-pressed={!!enabled[name]}
                  disabled={!available || !ready || breathing}
                  title={
                    available ? name : "このフレームには表示データがありません"
                  }
                  onClick={() =>
                    setEnabled((previous) => ({
                      ...previous,
                      [name]: !previous[name],
                    }))
                  }
                >
                  {name}
                </button>
              );
            })}
            {!scan.structures.length && (
              <p>この部位には構造物の表示データが登録されていません。</p>
            )}
          </div>
          {dataError && (
            <p role="alert">
              構造物の表示データを読み込めませんでした。画面を再読み込みしてください。
            </p>
          )}
          {hasBreath && (
            <button
              className="echo-breath-button"
              disabled={frame !== 1 || !ready || breathing}
              onClick={startBreathing}
            >
              息を吸う{frame !== 1 ? "（フレーム1で利用できます）" : ""}
            </button>
          )}
          {videoError && (
            <p role="alert">
              呼吸動画を再生できませんでした。もう一度お試しください。
            </p>
          )}
        </div>
      </div>
      <p className="echo-credit">
        画像は被験者のご厚意により作られています。無断転用はしないでください。
      </p>
    </section>
  );
}
