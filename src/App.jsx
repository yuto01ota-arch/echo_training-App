import { themeURL } from "./theme.js";
import { DEV_SERVER } from "./config.js";
import { useEffect, useRef, useState } from "react";
import { createViewer } from "./three/viewer.js";
import { POSES } from "./three/poses.js";
import { DEFAULT_MODEL, MODELS } from "./three/models.js";
import BodyRegions from "./components/BodyRegions.jsx";
import EchoScanner from "./components/EchoScanner.jsx";
import { loadCustomScans } from "./custom/catalog.js";
import { scanFromHash } from "./echo/scans.js";
import ThemeToggle from "./components/ThemeToggle.jsx";

const developerURL =
  import.meta.env.VITE_DEVELOPER_URL ||
  (import.meta.env.DEV ? `http://localhost:${DEV_SERVER.developerPort}/` : "");

function Icon({ name, size = 20 }) {
  const paths = {
    cube: (
      <>
        <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
        <path d="m4 7.5 8 4.5 8-4.5M12 12v9M8 5.3l8 4.5" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export default function App() {
  const viewer = useRef(null);
  const [route, setRoute] = useState(() => window.location.hash);
  const developer = route === "#/developer";
  const [customScans, setCustomScans] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(!!developerURL);
  const [catalogError, setCatalogError] = useState("");
  const scan = developer ? null : scanFromHash(route, customScans);
  const returnPosition = useRef(null);
  const [model, setModel] = useState({
    name: "人体モデル",
    kind: "empty",
    rigged: false,
  });
  const [pose, setPose] = useState("standing");
  const [{ loading, error }, setStatus] = useState({
    loading: true,
    error: "",
  });
  const [fatal, setFatal] = useState("");

  useEffect(() => {
    const updateRoute = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", updateRoute);
    window.addEventListener("popstate", updateRoute);
    return () => {
      window.removeEventListener("hashchange", updateRoute);
      window.removeEventListener("popstate", updateRoute);
    };
  }, []);

  useEffect(() => {
    if (developer && developerURL) {
      window.location.replace(themeURL(developerURL));
      return;
    }
    document.title = developer
      ? "開発者用ページ | ECHO TRAINING"
      : scan && !scan.invalid
        ? `${scan.title} | ECHO TRAINING`
        : "ECHO TRAINING — 人体3Dビューアー";
    if (developer || scan) window.scrollTo(0, 0);
    else if (returnPosition.current) {
      const saved = returnPosition.current;
      const task = requestAnimationFrame(() => {
        document
          .querySelector(`[data-region="${saved.id}"]`)
          ?.focus({ preventScroll: true });
        window.scrollTo(0, saved.y);
      });
      return () => cancelAnimationFrame(task);
    }
  }, [scan, developer]);

  function openScan(region) {
    returnPosition.current = { y: window.scrollY, id: region.id };
    const hash = `#/echo/${region.id}`;
    window.history.pushState({ fromBodyMap: true }, "", hash);
    setRoute(hash);
  }

  function backToRegions() {
    if (window.history.state?.fromBodyMap) window.history.back();
    else {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
      setRoute("");
    }
  }

  useEffect(() => {
    try {
      viewer.current = createViewer((nextModel) => {
        setModel(nextModel);
        setPose("standing");
      }, setStatus);
      viewer.current.loadBuiltin(DEFAULT_MODEL.id);
    } catch (cause) {
      console.error(cause);
      setFatal(
        "3D表示を開始できませんでした。WebGL 2 対応ブラウザーで、ハードウェアアクセラレーションを有効にしてください。",
      );
      setStatus({ loading: false, error: "" });
    }
    return () => {
      viewer.current?.dispose();
      viewer.current = null;
    };
  }, []);

  useEffect(() => {
    if (!developerURL) return;
    const controller = new AbortController();
    loadCustomScans(developerURL, controller.signal)
      .then(setCustomScans)
      .catch((cause) => {
        if (cause.name !== "AbortError") setCatalogError(cause.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCatalogLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (scan?.camera && model.id !== scan.model)
      viewer.current?.loadBuiltin(scan.model);
  }, [scan?.id, scan?.model, scan?.revision]);

  return (
    <div
      className={`app-shell${developer ? " app-shell--developer" : scan && !scan.invalid ? " app-shell--echo" : !scan ? " app-shell--home" : ""}`}
    >
      <header className="header">
        <a
          className="brand"
          href={import.meta.env.BASE_URL}
          aria-label="ECHO TRAINING ホーム"
        >
          <span className="brand-icon">
            <Icon name="cube" size={23} />
          </span>
          <span>
            ECHO<span className="brand-light"> TRAINING</span>
          </span>
        </a>
        <span className="header-divider" />
        <span className="header-caption">
          {developer
            ? "開発者用ページ"
            : scan
              ? "エコートレーニング"
              : "部位選択"}
        </span>
        <ThemeToggle />
      </header>

      <main>
        {developer && (
          <section className="developer-screen">
            <button className="echo-back" onClick={backToRegions}>
              ← 部位選択に戻る
            </button>
            <h1>開発者用ページ</h1>
            <p role="status">開発者用ページは接続準備中です。</p>
          </section>
        )}
        {scan &&
          (scan.invalid ? (
            <section className="echo-screen">
              <h1>
                {catalogLoading && route.startsWith("#/echo/custom-")
                  ? "部位を読み込み中…"
                  : "部位が見つかりません"}
              </h1>
              {catalogError && <p role="alert">{catalogError}</p>}
              <button className="echo-back" onClick={backToRegions}>
                部位選択に戻る
              </button>
            </section>
          ) : (
            <EchoScanner
              key={scan.id}
              scan={scan}
              onBack={backToRegions}
              viewer={viewer}
              model={model}
              pose={pose}
              modelLoading={loading || (scan.camera && model.id !== scan.model)}
              modelError={fatal || error}
              onRetryModel={
                fatal
                  ? undefined
                  : () =>
                      viewer.current?.loadBuiltin(
                        scan.camera
                          ? scan.model
                          : (model.id ?? DEFAULT_MODEL.id),
                      )
              }
            />
          ))}
        <div className="home-screen" hidden={!!scan || developer}>
          <div className="home-toolbar">
            <div className="page-title">
              <div>
                <h1>3つの面から、部位を選ぶ</h1>
                <p className="subtitle">
                  番号または部位名を選ぶと、エコー画面が開きます。
                </p>
              </div>
            </div>
            <div className="body-settings">
              <div
                className="model-selector"
                role="group"
                aria-label="人体モデルを選択"
              >
                {MODELS.map((item) => (
                  <button
                    key={item.id}
                    disabled={loading || !!fatal}
                    aria-pressed={model.id === item.id}
                    onClick={() => viewer.current?.loadBuiltin(item.id)}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
              <div className="body-pose">
                <label htmlFor="pose">ポーズ</label>
                <select
                  id="pose"
                  value={pose}
                  disabled={loading || !!fatal || model.kind === "empty"}
                  onChange={(event) => {
                    setPose(event.target.value);
                    viewer.current?.setPose(event.target.value);
                  }}
                >
                  {POSES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              className="developer-page-button"
              type="button"
              onClick={() => {
                if (developerURL) {
                  window.location.assign(themeURL(developerURL));
                  return;
                }
                returnPosition.current = null;
                window.history.pushState(
                  { fromBodyMap: true },
                  "",
                  "#/developer",
                );
                setRoute("#/developer");
              }}
            >
              開発者用ページ
            </button>
          </div>
          {loading && <p role="status">モデルを読み込み中…</p>}
          {(fatal || error) && (
            <p className="inline-error" role="alert">
              {fatal || error}
            </p>
          )}
          {catalogError && (
            <p className="inline-error" role="alert">
              {catalogError}
            </p>
          )}
          <BodyRegions
            customScans={customScans.filter((item) => item.custom)}
            viewer={viewer}
            model={model}
            pose={pose}
            disabled={loading || !!fatal}
            onSelect={openScan}
          />
        </div>
        <footer>
          <span>
            ECHO TRAINING <span className="footer-dot">/</span> HUMAN BODY
            VIEWER
          </span>
        </footer>
      </main>
    </div>
  );
}
