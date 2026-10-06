import { useEffect, useRef, useState } from "react";
import { pointOnSegment, dragProgress } from "../echo/probeMotion.js";

export default function EchoBodyModel({
  scan,
  disabled,
  viewer,
  model,
  pose,
  loading,
  error,
  onRetry,
  frame,
  frameCount,
  onFrame,
}) {
  const canvas = useRef(null);
  const host = useRef(null);
  const drag = useRef(null);
  const progress = (frame - 1) / Math.max(1, frameCount - 1);
  const latestFrame = useRef({ frame, progress });
  latestFrame.current = { frame, progress };
  const requestRender = useRef(null);
  const [rendered, setRendered] = useState(null);
  const path = rendered?.path;
  const [renderError, setRenderError] = useState("");
  useEffect(() => {
    setRendered(null);
    setRenderError("");
    if (loading || error || model.kind !== "builtin") return;
    let pending;
    const update = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        try {
          const result = scan.camera
            ? viewer.current?.renderCustomScan(
                canvas.current,
                scan,
                latestFrame.current.progress,
              )
            : viewer.current?.renderScanBody(
                canvas.current,
                scan.id,
                latestFrame.current.progress,
              );
          setRendered(
            result ? { ...result, frame: latestFrame.current.frame } : null,
          );
          setRenderError("");
        } catch (error) {
          setRenderError(error.message || "人体モデルを表示できませんでした。");
        }
      });
    };
    requestRender.current = update;
    const observer = new ResizeObserver(update);
    observer.observe(canvas.current);
    update();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(pending);
      requestRender.current = null;
    };
  }, [viewer, model, pose, loading, error, scan]);
  useEffect(() => {
    requestRender.current?.();
  }, [frame]);

  const segment = path && { start: path[0], end: path.at(-1) };
  const point =
    segment &&
    (rendered?.point ??
      pointOnSegment(segment, (frame - 1) / Math.max(1, frameCount - 1)));
  const unavailable = loading || error || renderError || !point;

  function move(event) {
    if (disabled || !drag.current || drag.current.id !== event.pointerId)
      return;
    const { width, height } = host.current.getBoundingClientRect();
    const toPixels = (point) => ({
      x: (point.x / 100) * width,
      y: (point.y / 100) * height,
    });
    const progress =
      scan.type === "tilt"
        ? scan.axis === "x"
          ? (event.clientX - drag.current.x) / (width * 0.5)
          : (event.clientY - drag.current.y) / (height * 0.5)
        : dragProgress(
            { start: toPixels(segment.start), end: toPixels(segment.end) },
            {
              x: event.clientX - drag.current.x,
              y: event.clientY - drag.current.y,
            },
          );
    onFrame(drag.current.frame + progress * (frameCount - 1));
  }

  return (
    <div
      className="echo-body-model"
      ref={host}
      aria-label={`${scan.title}の人体モデル`}
    >
      <canvas
        ref={canvas}
        className="scan-body-canvas"
        data-probe-frame={rendered?.frame}
        aria-label={`${model.name}の${scan.title}`}
      />
      {!unavailable && (
        <>
          <svg className="scan-body-path" aria-hidden="true">
            <line
              x1={`${segment.start.x}%`}
              y1={`${segment.start.y}%`}
              x2={`${segment.end.x}%`}
              y2={`${segment.end.y}%`}
            />
            <circle
              cx={`${segment.start.x}%`}
              cy={`${segment.start.y}%`}
              r="5"
            />
            <circle cx={`${segment.end.x}%`} cy={`${segment.end.y}%`} r="5" />
          </svg>
          <button
            className="echo-probe model-probe echo-probe--3d"
            aria-label="プローブを動かす"
            disabled={disabled}
            title={
              scan.type === "tilt"
                ? `${scan.axis === "x" ? "左右" : "上下"}にドラッグまたは矢印キーで傾きを変更`
                : "走査線に沿ってドラッグまたは矢印キーで移動"
            }
            style={{
              left: `${point.x}%`,
              top: `${point.y}%`,
              transform: "translate(-50%, -50%)",
              ...(rendered?.probe ?? {}),
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              drag.current = {
                id: event.pointerId,
                frame,
                x: event.clientX,
                y: event.clientY,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={move}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
            onKeyDown={(event) => {
              if (
                [
                  "ArrowUp",
                  "ArrowRight",
                  "ArrowDown",
                  "ArrowLeft",
                  "Home",
                  "End",
                ].includes(event.key)
              ) {
                event.preventDefault();
                onFrame(
                  event.key === "Home"
                    ? 1
                    : event.key === "End"
                      ? frameCount
                      : frame +
                        (["ArrowDown", "ArrowRight"].includes(event.key)
                          ? 1
                          : -1),
                );
              }
            }}
          ></button>
        </>
      )}
      {unavailable && (
        <div
          className="scan-body-status"
          role={error || renderError ? "alert" : "status"}
        >
          {error || renderError || "人体モデルを読み込み中…"}
          {(error || renderError) && onRetry && (
            <button onClick={onRetry}>人体モデルを再読み込み</button>
          )}
        </div>
      )}
    </div>
  );
}
