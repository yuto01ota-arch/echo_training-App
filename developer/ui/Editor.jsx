import ThemeToggle from "../../src/components/ThemeToggle.jsx";
import { preferredTheme, themeURL } from "../../src/theme.js";
import { API, EDITOR, VALIDATION, FRAME_COUNT, TILT } from "../../src/config.js";
import { editableMotion } from "../../src/echo/scanMotion.js";
import { loadCustomScans } from "../../src/custom/catalog.js";
import { editorScans, validateSettings } from "../../src/custom/settings.js";
import ExistingPreview from "./ExistingPreview.jsx";
import { useEffect, useRef, useState } from "react";
import { createModelEditor } from "./modelEditor.js";
import { extractFrames } from "./extractFrames.js";
import {
  validateScan,
  PACK_SIZE,
  PACK_COUNT,
} from "../../src/custom/schema.js";
import { packFrames } from "../../src/custom/framePack.js";

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    signal: AbortSignal.timeout(API.requestTimeoutMs),
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      body.error || "通信に失敗しました。時間をおいて再試行してください。",
    );
    error.status = response.status;
    throw error;
  }
  return body;
}
export default function Editor() {
  const canvas = useRef(null),
    editor = useRef(null),
    abort = useRef(null),
    attempt = useRef(null);
  const [status, setStatus] = useState({ loading: true, error: "" }),
    [geometry, setGeometry] = useState({
      path: {},
      markers: {},
      mode: "camera",
    });
  const [model, setModel] = useState("male"),
    [pose, setPose] = useState("standing"),
    [view, setView] = useState("front");
  const [category, setCategory] = useState("腹部"),
    [title, setTitle] = useState("");
  const [file, setFile] = useState(null),
    [crop, setCrop] = useState(100),
    [images, setImages] = useState(null);
  const [frame, setFrame] = useState(1),
    [rotate, setRotate] = useState(0),
    [imageURL, setImageURL] = useState("");
  const [busy, setBusy] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(null);
  const [motion, setMotion] = useState(editableMotion);
  const fixedTilt = motion.type === "tilt";
  const [theme, setTheme] = useState(preferredTheme);
  const [publicURL, setPublicURL] = useState("");
  const [step, setStep] = useState(0);
  const [intent, setIntent] = useState("create");
  const [editing, setEditing] = useState(null);
  const frameCount = editing?.frameCount ?? FRAME_COUNT;
  const [catalog, setCatalog] = useState([]);
  const [catalogError, setCatalogError] = useState("");
  async function refreshCatalog() {
    try {
      const scans = editorScans(await loadCustomScans(window.location.origin));
      setCatalog(scans);
      setCatalogError("");
      return scans;
    } catch (cause) {
      setCatalogError(cause.message);
      return null;
    }
  }
  async function openExisting(id, entries = catalog) {
    const scan = entries.find((item) => item.id === id);
    if (!scan) {
      newScan();
      setMessage("この部位は削除されています。一覧を更新しました。");
      return;
    }
    setIntent("edit");
    setEditing(scan);
    setSaved(null);
    setError("");
    setMessage("");
    setBusy("load");
    setFrame(1);
    setStep(1);
    try {
      const setting = await editor.current.loadScan(scan);
      if (!setting) return;
      setSaved(null);
      setModel(setting.model);
      setPose(setting.pose);
      setView(setting.view);
      setRotate(setting.rotate);
      setMotion(editableMotion(scan));
      setTitle(scan.title);
      setCategory(scan.category ?? "部位");
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy("");
    }
  }
  function newScan() {
    setIntent("create");
    setEditing(null);
    setSaved(null);
    setError("");
    setMessage("");
    setImages(null);
    setImageURL("");
    setFile(null);
    setTitle("");
    setCategory("腹部");
    setCrop(100);
    setFrame(1);
    setRotate(0);
    setMotion(editableMotion());
    setModel("male");
    setPose("standing");
    setView("front");
    setStep(0);
    attempt.current = null;
    editor.current?.newScan();
  }
  function selectStep(next) {
    setStep(next);
    editor.current?.setMode("camera");
  }
  useEffect(() => {
    let active = true;
    refreshCatalog();
    api("/api/settings")
      .then((data) => {
        if (active) setPublicURL(data.publicURL);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    try {
      editor.current = createModelEditor(
        canvas.current,
        setGeometry,
        setStatus,
      );
      editor.current.loadModel("male");
    } catch (cause) {
      setStatus({ loading: false, error: cause.message });
    }
    return () => {
      active = false;
      abort.current?.abort();
      editor.current?.dispose();
    };
  }, []);
  useEffect(() => {
    editor.current?.setPreview(frame, rotate);
  }, [frame, rotate]);
  useEffect(() => {
    editor.current?.setMotion(motion);
  }, [motion]);
  useEffect(() => {
    if (!images || editing) return;
    const url = URL.createObjectURL(images.frames[frame - 1]);
    setImageURL(url);
    return () => URL.revokeObjectURL(url);
  }, [images, frame, editing]);
  useEffect(() => {
    if (!busy) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  useEffect(() => {
    if (!editing || !saved || busy) return;
    const precision = 10 ** EDITOR.fingerprintDecimals;
    const point = (value) => value && { x: value.x, y: value.y };
    // Compare values in a stable order: source presets and saved JSON may
    // contain the same geometry with differently ordered object properties.
    const fingerprint = (value) =>
      JSON.stringify(
        {
          model: value.model,
          pose: value.pose,
          view: value.view,
          rotate: value.rotate,
          type: value.type ?? "linear",
          startAngle: value.type === "tilt" ? value.startAngle : undefined,
          endAngle: value.type === "tilt" ? value.endAngle : undefined,
          path: value.path && {
            start: point(value.path.start), end: point(value.path.end),
          },
          plane: value.plane && {
            right: value.plane.right, up: value.plane.up, normal: value.plane.normal,
          },
          camera: value.camera && {
            position: value.camera.position, target: value.camera.target,
            up: value.camera.up, span: value.camera.span,
          },
        },
        (_key, value) =>
          typeof value === "number" ? Math.round(value * precision) / precision : value,
      );
    if (
      fingerprint(saved) !==
      fingerprint({ ...geometry, model, pose, view, rotate, ...motion })
    ) {
      setSaved(null);
      setMessage("保存していない変更があります。");
    }
  }, [editing, saved, busy, geometry, model, pose, view, rotate, motion]);
  const locked = !!busy || (!!saved && !editing);
  async function extract() {
    setError("");
    setImages(null);
    setImageURL("");
    attempt.current = null;
    abort.current = new AbortController();
    setBusy("extract");
    try {
      const data = await extractFrames(
        file,
        crop / 100,
        (n) => setMessage(`画像を作成中：${n} / ${frameCount}`),
        abort.current.signal,
      );
      setFrame(1);
      setImages(data);
      setMessage(`${data.frames.length}枚の画像を作成しました。`);
    } catch (cause) {
      if (cause.name !== "AbortError") setError(cause.message);
      else setMessage("画像の作成を中止しました。");
    } finally {
      setBusy("");
    }
  }
  async function save() {
    setError("");
    setBusy("save");
    try {
      if (editing) {
        const settings = validateSettings(
          { ...geometry, model, pose, view, rotate, ...motion },
          editing,
        );
        await editor.current.validatePath((n) =>
          setMessage(`プローブの経路を確認中：${n} / ${frameCount}`),
        );
        const result = await api(`/api/scans/${editing.id}/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...settings,
            revision: editing.revision ?? null,
          }),
        });
        const updated = { ...editing, ...result };
        setEditing(updated);
        setCatalog((items) =>
          items.map((item) => (item.id === updated.id ? updated : item)),
        );
        setSaved(updated);
        setMessage("変更を保存しました。エコー画面を開き直すと反映されます。");
        return;
      }
      const config = validateScan({
        title,
        category,
        model,
        pose,
        view,
        rotate,
        ...geometry,
        ...motion,
        imageWidth: images.imageWidth,
        imageHeight: images.imageHeight,
      });
      setMessage("プローブの経路を確認しています…");
      await editor.current.validatePath((n) =>
        setMessage(`プローブの経路を確認中：${n} / ${frameCount}`),
      );
      const signature = JSON.stringify(config);
      if (
        attempt.current?.signature !== signature ||
        attempt.current?.images !== images
      ) {
        const { id } = await api("/api/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: signature,
        });
        attempt.current = { id, signature, images, next: 0 };
      }
      const draft = attempt.current;
      for (let i = draft.next; i < PACK_COUNT; i++) {
        setMessage(`画像を保存中：${i * PACK_SIZE} / ${frameCount}`);
        await api(`/api/drafts/${draft.id}/packs/${i}`, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: await packFrames(
            images.frames.slice(i * PACK_SIZE, (i + 1) * PACK_SIZE),
          ),
        });
        draft.next = i + 1;
      }
      setMessage("部位選択に追加しています…");
      const scan = await api(`/api/drafts/${draft.id}/publish`, {
        method: "POST",
      });
      setSaved(scan);
      setCatalog(items => [...items.filter(item => item.id !== scan.id), {
        ...scan, revision:scan.revision ?? null,
        frameBase:`${window.location.origin}/public/frames/${scan.id}/`,
      }]);
      setMessage("保存しました。部位選択画面から開けます。");
    } catch (cause) {
      if (cause.status === 404) attempt.current = null;
      setError(`${cause.message} 入力内容はこの画面に残っています。`);
    } finally {
      setBusy("");
    }
  }
  async function deleteScan() {
    if (!editing || busy) return;
    const target = editing;
    if (!window.confirm(
      `「${target.title}」を削除しますか？\n部位選択と編集一覧から削除され、未保存の変更は破棄されます。\n保存データは保持されますが、画面から復元する機能はありません。`,
    )) return;
    setBusy("delete");
    setError("");
    try {
      await api(`/api/scans/${target.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: target.revision ?? null }),
      });
      setCatalog(items => items.filter(scan => scan.id !== target.id));
      newScan();
      setMessage(`「${target.title}」を削除しました。通常画面を再読み込みすると反映されます。`);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy("");
    }
  }
  function modelChange(value) {
    setModel(value);
    setPose("standing");
    editor.current?.loadModel(value);
  }
  return (
    <>
      <header>
        <a href={publicURL ? themeURL(publicURL, theme) : "#"}>← 部位選択に戻る</a>
        <strong>開発者用ページ</strong>
        <div className="header-actions">
          <ThemeToggle onChange={setTheme} />
          <form method="post" action={themeURL("/logout", theme)}>
            <button>ログアウト</button>
          </form>
        </div>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <h1>{intent === "edit" ? "既存部位を編集" : "新しい部位を追加"}</h1>
            <p>
              {intent === "edit"
                ? "カメラとプローブの開始点・終了点を調整します。"
                : "動画と3Dモデルを使って、エコー画面を作成します。"}
            </p>
          </div>
        </div>
        <div className="editor-mode-bar">
          <div className="row" role="group" aria-label="編集モード">
            <button
              disabled={!!busy || status.loading}
              aria-pressed={intent === "create"}
              onClick={() => {
                if (intent !== "create") newScan();
              }}
            >
              新しい部位を追加
            </button>
            <button
              disabled={!!busy || status.loading || !catalog.length}
              aria-pressed={intent === "edit"}
              onClick={() => {
                if (intent !== "edit")
                  openExisting(editing?.id ?? catalog[0]?.id);
              }}
            >
              既存部位を編集
            </button>
          </div>
          {intent === "edit" && (
            <>
              <label className="existing-selector">
                部位
                <select
                  aria-label="編集する部位"
                  value={editing?.id ?? ""}
                  disabled={!!busy || status.loading}
                  onChange={(e) => openExisting(e.target.value)}
                >
                  <optgroup label="最初からある部位">
                    {catalog
                      .filter((scan) => !scan.custom)
                      .map((scan) => (
                        <option key={scan.id} value={scan.id}>
                          {scan.title}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="追加した部位">
                    {catalog
                      .filter((scan) => scan.custom)
                      .map((scan) => (
                        <option key={scan.id} value={scan.id}>
                          {scan.title}
                        </option>
                      ))}
                  </optgroup>
                </select>
              </label>
              <button
                disabled={!!busy}
                onClick={async () => {
                  const entries = await refreshCatalog();
                  if (entries) openExisting(editing.id, entries);
                }}
              >
                保存済みの設定を再読み込み
              </button>
              <button className="danger" disabled={!!busy} onClick={deleteScan}>
                {busy === "delete" ? "削除中…" : "この部位を削除"}
              </button>
            </>
          )}
          {!catalog.length && !catalogError && !status.loading && (
            <span className="hint">編集できる部位はありません。新しい部位を追加できます。</span>
          )}
          {catalogError && (
            <span role="alert">
              {catalogError}
              <button onClick={refreshCatalog}>再試行</button>
            </span>
          )}
        </div>
        <div className="editor-layout">
          <section className="settings" aria-label="部位の設定">
            <div
              className="setting-tabs"
              role="tablist"
              aria-label="設定の切り替え"
            >
              {[
                editing ? "1. 対象部位" : "1. 部位と動画",
                "2. 人体とカメラ",
                "3. プローブ",
              ].map((label, index) => (
                <button
                  key={index}
                  id={`step-${index}`}
                  role="tab"
                  aria-selected={step === index}
                  aria-controls={`panel-${index}`}
                  tabIndex={step === index ? 0 : -1}
                  onClick={() => selectStep(index)}
                  onKeyDown={(event) => {
                    let next;
                    if (event.key === "ArrowRight") next = (index + 1) % 3;
                    if (event.key === "ArrowLeft") next = (index + 2) % 3;
                    if (event.key === "Home") next = 0;
                    if (event.key === "End") next = 2;
                    if (next !== undefined) {
                      event.preventDefault();
                      selectStep(next);
                      document.getElementById(`step-${next}`)?.focus();
                    }
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <fieldset
              id="panel-0"
              role="tabpanel"
              aria-labelledby="step-0"
              hidden={step !== 0}
              disabled={locked}
            >
              <legend>{editing ? "1. 対象部位" : "1. 部位と動画"}</legend>
              {editing ? (
                <>
                  <h2>{editing.title}</h2>
                  <p>登録済みのエコー画像を使って設定を調整します。</p>
                  <p className="hint">
                    動画の再登録は不要です。画像・構造物の表示データは維持されます。走査方式は「3. プローブ」で変更できます。
                  </p>
                  <p className="hint">
                    部位を切り替える前に変更を保存してください。
                  </p>
                </>
              ) : (
                <div key="new-scan-fields">
                  <label>
                    カテゴリー
                    <input
                      value={category}
                      maxLength={VALIDATION.maxTextLength}
                      list="categories"
                      onChange={(e) => setCategory(e.target.value)}
                    />
                  </label>
                  <datalist id="categories">
                    <option>腹部</option>
                    <option>上肢</option>
                    <option>下肢</option>
                  </datalist>
                  <label>
                    部位名
                    <input
                      value={title}
                      maxLength={VALIDATION.maxTextLength}
                      placeholder="例：腹部：新しい走査"
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>
                  <label>
                    エコー動画（MP4）
                    <input
                      type="file"
                      accept="video/mp4,video/webm,video/quicktime"
                      onChange={(e) => {
                        setFile(e.target.files[0] ?? null);
                        setImages(null);
                        setImageURL("");
                        attempt.current = null;
                      }}
                    />
                  </label>
                  <label>
                    動画の左から使用する幅（%）
                    <input
                      type="number"
                      min={EDITOR.minCropPercent}
                      max="100"
                      value={crop}
                      onChange={(e) => {
                        setCrop(Number(e.target.value));
                        setImages(null);
                        setImageURL("");
                      }}
                    />
                  </label>
                  <p className="hint">
                    エコーだけの動画は100%。右側に人体写真がある場合は、写真が入らない幅に調整してください。動画全体から等間隔に{FRAME_COUNT}枚作成します。
                  </p>
                  <button
                    disabled={!file || crop < EDITOR.minCropPercent || crop > 100}
                    onClick={extract}
                  >
                    動画から{FRAME_COUNT}枚の画像を作成
                  </button>
                </div>
              )}
            </fieldset>
            <fieldset
              id="panel-1"
              role="tabpanel"
              aria-labelledby="step-1"
              hidden={step !== 1}
              disabled={locked || status.loading}
            >
              <legend>2. 人体とカメラ</legend>
              <div className="row">
                <label>
                  モデル
                  <select
                    aria-label="モデル"
                    value={model}
                    onChange={(e) => modelChange(e.target.value)}
                  >
                    <option value="male">男性モデル</option>
                    <option value="female">女性モデル</option>
                  </select>
                </label>
                <label>
                  ポーズ
                  <select
                    aria-label="ポーズ"
                    value={pose}
                    onChange={(e) => {
                      setPose(e.target.value);
                      editor.current?.setPose(e.target.value);
                    }}
                  >
                    <option value="standing">基本姿勢</option>
                    <option value="armsOpen">腕を広げる</option>
                  </select>
                </label>
              </div>
              <label>
                部位選択で表示する面
                <select
                  aria-label="部位選択で表示する面"
                  disabled={!!editing}
                  value={view}
                  onChange={(e) => setView(e.target.value)}
                >
                  <option value="front">正面</option>
                  <option value="right">右側面</option>
                  <option value="left">左側面</option>
                  <option value="back">背面</option>
                </select>
              </label>
              <div className="row wrap">
                {[
                  ["front", "正面"],
                  ["right", "右側面"],
                  ["left", "左側面"],
                  ["back", "背面"],
                ].map(([id, label]) => (
                  <button key={id} onClick={() => editor.current?.view(id)}>
                    {label}へ
                  </button>
                ))}
              </div>
              <p className="hint">
                ドラッグで回転、ホイールで拡大・縮小、右ドラッグで平行移動。表示中の視点を保存します。モデル・ポーズを変えると開始点と終了点はクリアされます。
              </p>
            </fieldset>
            <fieldset
              id="panel-2"
              className={fixedTilt ? "probe-settings--tilt" : undefined}
              role="tabpanel"
              aria-labelledby="step-2"
              hidden={step !== 2}
              disabled={locked || status.loading}
            >
              <legend>{fixedTilt ? "3. プローブの接触位置・角度" : "3. プローブの開始点・終了点"}</legend>
              <label className="motion-select">
                走査方式
                <select value={motion.type} onChange={(e) => setMotion({ ...motion, type: e.target.value })}>
                  <option value="linear">直線移動</option>
                  <option value="tilt">tilt（傾ける）</option>
                </select>
              </label>
              <div className="row wrap">
                {(fixedTilt ? [
                  ["camera", "カメラ操作"], ["start", "接触位置を指定"],
                ] : [
                  ["camera", "カメラ操作"],
                  ["start", "開始点を指定"],
                  ["end", "終了点を指定"],
                ]).map(([id, label]) => (
                  <button
                    key={id}
                    aria-pressed={geometry.mode === id}
                    onClick={() => editor.current?.setMode(id)}
                  >
                    {label}
                  </button>
                ))}
                {fixedTilt && <button onClick={() => editor.current?.resetPoints()}>点をクリア</button>}
              </div>
              <p className="hint">
                {fixedTilt
                  ? "「接触位置を指定」を押して人体を1回クリック。位置を固定し、等速で傾けます。"
                  : "開始点、終了点の順に人体をクリック。2点を結ぶ直線上を等速で移動します。"}
              </p>
              <div className="coordinates">
                {(fixedTilt ? [["start", "接触位置"]] : [
                  ["start", "開始点"],
                  ["end", "終了点"],
                ]).map(([name, label]) => (
                  <div key={name}>
                    <strong>{label}</strong>
                    {["x", "y"].map((axis) => (
                      <label key={axis}>
                        {axis}
                        <input
                          type="number"
                          step={EDITOR.coordinateStep}
                          min={-VALIDATION.maxPathCoordinate}
                          max={VALIDATION.maxPathCoordinate}
                          aria-label={`${label} ${axis}`}
                          disabled={!geometry.path[name]}
                          value={geometry.path[name]?.[axis] ?? ""}
                          onChange={(e) =>
                            editor.current?.setCoordinate(
                              name,
                              axis,
                              Number(e.target.value),
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                ))}
              </div>
              {!fixedTilt && <button onClick={() => editor.current?.resetPoints()}>
                点をクリア
              </button>}
              {fixedTilt && <>
                <div className="row">
                  {[["startAngle", "開始角度（度）"], ["endAngle", "終了角度（度）"]].map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input type="number" min={-TILT.maxAngle} max={TILT.maxAngle}
                        step={EDITOR.rotationStep} value={motion[key]}
                        onChange={(e) => setMotion({ ...motion, [key]: e.target.value === "" ? "" : Number(e.target.value) })} />
                    </label>
                  ))}
                </div>
                <p className="hint">0°は体表に垂直。±{TILT.maxAngle}°以内で設定します。向きで傾ける方向を調整し、プレビューで確認してください。</p>
              </>}
              <label>
                プローブの向き（度）
                <input
                  type="number"
                  min={-VALIDATION.maxRotationDegrees}
                  max={VALIDATION.maxRotationDegrees}
                  step={EDITOR.rotationStep}
                  value={rotate}
                  onChange={(e) => setRotate(Number(e.target.value))}
                />
              </label>
            </fieldset>
          </section>
          <section className="preview" aria-label="プレビュー">
            <div className="preview-heading">
              <h2>プレビュー</h2>
              <span>
                {geometry.mode === "camera"
                  ? "カメラを操作できます"
                  : geometry.mode === "start"
                    ? (fixedTilt ? "接触位置をクリック" : "開始点をクリック")
                    : "終了点をクリック"}
              </span>
            </div>
            <div className="preview-media">
              <div
                className="model-stage"
                style={{ pointerEvents: locked ? "none" : undefined }}
              >
                <canvas ref={canvas} aria-label="編集用人体モデル" />
                <svg aria-hidden="true">
                  {!fixedTilt && geometry.markers.start && geometry.markers.end && (
                    <line
                      x1={`${geometry.markers.start.x}%`}
                      y1={`${geometry.markers.start.y}%`}
                      x2={`${geometry.markers.end.x}%`}
                      y2={`${geometry.markers.end.y}%`}
                    />
                  )}{" "}
                  {Object.entries(geometry.markers).filter(([key]) => !fixedTilt || key === "start").map(([key, point]) => (
                    <g key={key}>
                      <circle cx={`${point.x}%`} cy={`${point.y}%`} r="6" />
                      <text
                        x={`${point.x}%`}
                        y={`${point.y}%`}
                        dx="10"
                        dy="-10"
                      >
                        {fixedTilt ? "接触位置" : key === "start" ? "開始" : "終了"}
                      </text>
                    </g>
                  ))}
                </svg>
                {status.loading && (
                  <div className="overlay" role="status">
                    人体モデルを読み込み中…
                  </div>
                )}
              </div>
              <div className="image-preview">
                {editing ? (
                  <ExistingPreview
                    scan={editing}
                    publicURL={publicURL}
                    frame={frame}
                  />
                ) : imageURL ? (
                  <img src={imageURL} alt={`プレビュー画像 フレーム${frame}`} />
                ) : (
                  <p>動画から作成したエコー画像を表示します。</p>
                )}
              </div>
            </div>
            {(status.error || geometry.error) && (
              <p role="alert">{status.error || geometry.error}</p>
            )}
            <label className="preview-slider">
              {motion.type === "tilt" ? "プローブの傾き" : "スキャン位置"} · {frame} / {frameCount}
              <input
                type="range"
                min="1"
                max={frameCount}
                value={frame}
                disabled={locked}
                onChange={(e) => setFrame(Number(e.target.value))}
              />
            </label>
          </section>
        </div>
        <div className="save-panel" aria-label="保存">
          <p className="hint">
            {editing
              ? "保存すると、この部位のモデル・カメラ・プローブの設定が通常のエコー画面に反映されます。"
              : "保存すると、部位名・エコー画像・モデルの設定が部位選択画面に公開されます。元の動画はアップロードしません。"}
          </p>
          <button
            className="primary"
            hidden={!!saved && !editing}
            disabled={
              locked ||
              (!editing && !images) ||
              !title.trim() ||
              !category.trim() ||
              !geometry.path.start ||
              !geometry.path.end ||
              !!geometry.error ||
              status.loading
            }
            onClick={save}
          >
            {editing ? "変更を保存" : "保存して部位選択に追加"}
          </button>
          {busy === "extract" && (
            <button onClick={() => abort.current?.abort()}>
              画像作成を中止
            </button>
          )}
          <p role="status">
            {message}
            {saved && editing && (
              <>
                {" "}
                <a href={themeURL(`${publicURL.split("#")[0]}#/echo/${editing.id}`, theme)}>
                  変更したエコーを開く
                </a>
              </>
            )}
          </p>
          {error && (
            <p role="alert">
              {error}{" "}
              <a href={themeURL("/login", theme)} target="_blank" rel="noreferrer">
                ログイン画面
              </a>
            </p>
          )}
          {saved && !editing && (
            <div className="row">
              <a
                className="button"
                href={themeURL(`${publicURL.split("#")[0]}#/echo/${saved.id}`, theme)}
              >
                保存したエコーを開く
              </a>
              <button onClick={() => window.location.reload()}>
                別の部位を追加
              </button>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
