import { useEffect, useRef, useState } from "react";
import { REGIONS } from "../three/regions.js";

const VIEWS = [
  ["front", "正面"],
  ["side", "側面"],
  ["back", "背面"],
];
const CALLOUTS = {
  abs_long: [83, 54],
  abs_short: [83, 44],
  abs_subcostal: [83, 34],
  median_nerve_200: [14, 46],
  ulnar: [14, 56],
  radial: [14, 36],
  leg_upper: [83, 66],
  leg_lower: [80, 72],
  abs_intercostal: [80, 34],
  abs_right_flank: [80, 48],
  abs_left_flank: [80, 48],
};

export default function BodyRegions({
  viewer,
  model,
  pose,
  disabled,
  onSelect,
  customScans = [],
}) {
  const root = useRef(null);
  const canvases = useRef({});
  const [side, setSide] = useState("right");
  const [points, setPoints] = useState({});
  const [selected, setSelected] = useState(null);
  const available = model.kind === "builtin" && !disabled;
  useEffect(() => {
    if (!available) {
      setPoints({});
      return;
    }
    const update = () => {
      if (!canvases.current.front?.clientWidth) return;
      setPoints(viewer.current?.renderRegions(canvases.current, side) ?? {});
    };
    const observer = new ResizeObserver(update);
    Object.values(canvases.current).forEach((canvas) =>
      observer.observe(canvas),
    );
    update();
    return () => observer.disconnect();
  }, [viewer, model, pose, side, available]);
  useEffect(() => {
    setSelected(null);
  }, [model]);
  useEffect(() => {
    if (!selected) return;
    function clearOutsideSelection(event) {
      const element = root.current;
      // The home screen stays mounted while an echo screen is open.
      if (!element || element.closest("[hidden]")) return;
      const regionControl = event.target.closest?.(
        ".region-marker, .region-list button, .region-surface-hit",
      );
      if (regionControl && element.contains(regionControl)) return;
      setSelected(null);
      const focused = document.activeElement;
      if (
        element.contains(focused) &&
        focused.matches(".region-marker, .region-list button")
      )
        focused.blur();
    }
    document.addEventListener("click", clearOutsideSelection, true);
    return () =>
      document.removeEventListener("click", clearOutsideSelection, true);
  }, [selected]);

  function select(region) {
    setSelected(region);
    onSelect(region);
  }

  return (
    <section className="body-regions" ref={root} aria-label="部位を選択">
      <div className="region-views">
        {VIEWS.map(([view, title]) => (
          <section
            className="region-view"
            key={view}
            aria-label={`${title}の部位`}
          >
            <div className="region-view-heading">
              <h3>{title}</h3>
              {view === "side" ? (
                <div
                  className="side-selector"
                  role="group"
                  aria-label="側面の左右"
                >
                  {[
                    ["right", "右側"],
                    ["left", "左側"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      aria-pressed={side === id}
                      onClick={() => setSide(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : (
                <span>
                  {view === "front" ? "← 右　｜　左 →" : "← 左　｜　右 →"}
                </span>
              )}
            </div>
            <div className="region-canvas">
              <canvas
                ref={(element) => {
                  if (element) canvases.current[view] = element;
                }}
                aria-label={`${title}の人体モデル`}
              />
              {available && (
                <svg className="region-lines" aria-hidden="true">
                  {(points[view] ?? []).map((point) => (
                    <g
                      key={point.id}
                      className={selected?.id === point.id ? "is-selected" : ""}
                    >
                      <line
                        x1={`${point.x}%`}
                        y1={`${point.y}%`}
                        x2={`${CALLOUTS[point.id][0]}%`}
                        y2={`${CALLOUTS[point.id][1]}%`}
                      />
                      <circle cx={`${point.x}%`} cy={`${point.y}%`} r="4" />
                      <circle
                        className="region-surface-hit"
                        cx={`${point.x}%`}
                        cy={`${point.y}%`}
                        r="10"
                        onClick={() =>
                          select(
                            REGIONS.find((region) => region.id === point.id),
                          )
                        }
                      />
                    </g>
                  ))}
                </svg>
              )}
              {available &&
                (points[view] ?? []).map((point) => {
                  const index = REGIONS.findIndex(
                    (region) => region.id === point.id,
                  );
                  const region = REGIONS[index];
                  return (
                    <button
                      key={point.id}
                      className="region-marker"
                      data-region={point.id}
                      aria-label={region.title}
                      title={region.title}
                      aria-pressed={selected?.id === point.id}
                      style={{
                        left: `${CALLOUTS[point.id][0]}%`,
                        top: `${CALLOUTS[point.id][1]}%`,
                      }}
                      onClick={() => select(region)}
                    >
                      <span>{index + 1}</span>
                    </button>
                  );
                })}
              {!available && (
                <div className="region-unavailable">
                  {disabled
                    ? "モデルの表示を準備しています"
                    : "部位の選択には男性・女性モデルを選んでください"}
                </div>
              )}
            </div>
            <div className="region-list">
              {REGIONS.map(
                (region, index) =>
                  region.view === (view === "side" ? side : view) && (
                    <button
                      key={region.id}
                      disabled={!available}
                      aria-pressed={selected?.id === region.id}
                      onClick={() => select(region)}
                    >
                      <b>{index + 1}</b>
                      {region.title}
                    </button>
                  ),
              )}
              {customScans
                .filter(
                  (region) => region.view === (view === "side" ? side : view),
                )
                .map((region) => (
                  <button
                    key={region.id}
                    data-region={region.id}
                    disabled={!available}
                    aria-pressed={selected?.id === region.id}
                    onClick={() => select(region)}
                  >
                    <b>＋</b>
                    {region.title}
                  </button>
                ))}
            </div>
          </section>
        ))}
      </div>
      <div className="region-detail" aria-live="polite" aria-atomic="true">
        {selected && available ? (
          <>
            <p>選択中の部位</p>
            <h3>{selected.title}</h3>
            <p>
              対象構造：
              {selected.structures.length
                ? selected.structures.join("・")
                : "登録なし"}
            </p>
          </>
        ) : (
          <p>部位を選ぶと、対応するエコー画像を操作できます。</p>
        )}
      </div>
    </section>
  );
}
