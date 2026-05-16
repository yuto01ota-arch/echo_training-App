const CACHE_NAME = 'echo-v2';

// GitHub PagesのURL階層に合わせます
// ⚠️もしGitHub上のリポジトリ名が「echo_trainingApp」（スペースなし）なら、ここを '/echo_trainingApp' にしてください
const REPO_NAME = '/echo_training-App'; 

// キャッシュしたい基本のファイル
const urlsToCache = [
  `${REPO_NAME}/`,
  `${REPO_NAME}/index.html`,
  `${REPO_NAME}/manifest.json`
];

// 200枚のフレーム画像を自動で追加するループ処理
for (let i = 1; i <= 200; i++) {
  const frameNum = String(i).padStart(3, '0'); // 001, 002... を作成
  // 画像のパスをリストに追加
  urlsToCache.push(`${REPO_NAME}/images/frame_${frameNum}.jpg`); 
}

// インストールイベント（ここで200枚を一括ダウンロードして保存）
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('すべてのファイルをキャッシュ中...');
      return cache.addAll(urlsToCache);
    })
  );
});

// フェッチイベント（オフライン時はキャッシュから画像を出す）
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});