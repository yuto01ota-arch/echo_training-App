/**
 * アプリの仕様・制限・調整値はここで管理します（ブラウザー・Worker・Node 共通）。
 * パスワードや Secret の実値は絶対に書かないでください。
 * 座標・ポーズ・部位別カメラは既存の scanPaths / scanPresentation 等で管理します。
 */

// 認証：文字数、秒、バイト。文字数を変えても既存の秘密情報は変更しません。
export const AUTH = Object.freeze({
  minPasswordLength: 4,
  maxPasswordLength: 256,
  minSessionSecretLength: 32,
  sessionSeconds: 4 * 60 * 60,
  maxFormBytes: 4096,
  nonceBytes: 16,
  generatedPasswordBytes: 24, // ローカル初期パスワード生成用の乱数
  generatedSecretBytes: 32,
});

// 新規部位の画像枚数と、一度に保存する枚数。割り切れる組み合わせにします。
// 公開後の変更は、公開アプリと開発者用 Worker の両方を更新してください。
export const FRAME_COUNT = 200;
export const PACK_SIZE = 10;
export const PACK_COUNT = FRAME_COUNT / PACK_SIZE;

// 既存素材・旧保存形式の仕様。新規作成の調整値ではありません。
// 変更には素材の差し替え・既存データの移行が必要です。
export const STORED_MEDIA = Object.freeze({
  builtinFrameCount: 200,
  builtinWidth: 1920,
  builtinHeight: 1080,
  filenameDigits: 3,
  legacyPackSize: 10, // packSize を持たない保存済みレコード
});

// 動画からの画像作成：px、JPEG品質（0～1）、ミリ秒／秒。
export const IMAGE = Object.freeze({
  maxExtractedDimension: 960,
  maxAcceptedDimension: 1280,
  jpegQuality: 0.86,
  videoWaitMs: 30_000,
  endMarginSeconds: 0.03, // 動画の終端そのものをシークしない
  seekToleranceSeconds: 0.00001,
  maxFrameBytes: 1024 * 1024,
  maxPackBytes: 12 * 1024 * 1024,
});

// 画像読み込み：選択フレームの前後に保持する枚数と先読み同時数。
export const PREFETCH = Object.freeze({ radius: 3, concurrency: 2 });

// 入力検証：座標・距離は正規化したモデル空間の単位、角度は度。
export const VALIDATION = Object.freeze({
  maxTextLength: 80,
  maxVectorCoordinate: 20,
  maxPathCoordinate: 3,
  maxRotationDegrees: 360,
  minCameraSpan: 0.05,
  maxCameraSpan: 10,
  minCameraAspect: 0.1,
  maxCameraAspect: 10,
  minCameraDistanceSquared: 0.01,
  minCameraCrossSquared: 0.001,
  basisTolerance: 0.001,
  minPathDistance: 0.005,
});

// API：バイト、件数、秒、ミリ秒。同じ値でも用途が異なる設定は独立させます。
export const API = Object.freeze({
  maxSettingsBytes: 16 * 1024,
  catalogPageSize: 20,
  draftTtlSeconds: 24 * 60 * 60,
  frameCacheSeconds: 24 * 60 * 60,
  requestTimeoutMs: 120_000,
});

// 開発者GUI：%・座標単位・度・件数。
export const EDITOR = Object.freeze({
  minCropPercent: 10,
  coordinateStep: 0.001,
  rotationStep: 1,
  fingerprintDecimals: 7,
  validationYieldEvery: 10,
  surfacePickTolerance: 0.012,
  cameraSpan: 2.1,
  minZoom: 0.3,
  maxZoom: 12,
});

// 新規部位のtilt：体表に垂直な姿勢を0度とする。皮膚側への反転を防ぐ。
export const TILT = Object.freeze({
  startAngle: -30,
  endAngle: 30,
  maxAngle: 80,
  minAngleRange: 1,
  dragAxis: "x",
});

// カメラのクリップ面（モデル空間）。表示位置自体は各部位の設定を使います。
export const CAMERA = Object.freeze({ near: 0.01, far: 30 });

// ローカルのポート番号と管理処理の待ち時間（ミリ秒）。
export const DEV_SERVER = Object.freeze({
  appPort: 5173,
  developerPort: 8787,
  controlTimeoutMs: 1500,
  stopTimeoutMs: 8000,
  secretReloadDelayMs: 300,
  controlMaxBytes: 8192,
  healthTimeoutMs: 700,
  startupTimeoutMs: 30_000,
  pollIntervalMs: 250,
});

// 不整合は設定モジュールの読み込み時に検出します。
if (
  !Number.isSafeInteger(FRAME_COUNT) || FRAME_COUNT < 2 ||
  !Number.isSafeInteger(PACK_SIZE) || PACK_SIZE < 1 ||
  !Number.isInteger(PACK_COUNT)
) {
  throw new Error("config.js: FRAME_COUNT は2以上で、PACK_SIZE で割り切れる整数にしてください。");
}
if (IMAGE.maxExtractedDimension > IMAGE.maxAcceptedDimension) {
  throw new Error("config.js: 生成画像の最大辺は受け入れ上限以下にしてください。");
}
if (AUTH.minPasswordLength < 1 || AUTH.minPasswordLength > AUTH.maxPasswordLength) {
  throw new Error("config.js: パスワードの最低文字数は1以上・最大文字数以下にしてください。");
}
