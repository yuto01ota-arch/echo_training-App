# 人体モデルの編集用データ

- `human-male.blend`：男性の人体メッシュ・眼球・19本のボーン・スキニング。
- `human-female.blend`：女性の同データ。
- `export-report.json`：骨格生成時（テクスチャ追加前）の頂点数・三角形数・骨格数などの記録。テクスチャ追加後の容量は `assets/textures/bake-report.json` を参照。

Blender 4.2以降で開けます。元のHuman Base Meshesには骨格がないため、このプロジェクトで基本的なFK骨格を追加しました。元のメッシュのライセンスはCC0です。後から加えた肌画像を含む出典は [`public/models/NOTICE.txt`](../../public/models/NOTICE.txt) を参照してください。

## ポーズを編集する

1. `.blend`を開き、必要に応じてHomeキーで全体を表示します。
2. `male-rig` または `female-rig` を選択してPose Modeにします。
3. 肩・肘・股関節・膝などのボーンを回転します。
4. 編集結果を別の`.blend`として保存します。

これは基本的な骨格です。指1本ごと・表情の操作、筋肉の補正、極端な姿勢の変形調整は含んでいません。新しいポーズを追加する際は肩・股関節の形状を確認し、必要ならウェイトを調整してください。

Webの既存2ポーズは `src/three/poses.js` に静的な回転として定義してあります。同じ骨格を維持したGLBに差し替えれば、この仕組みを利用できます。Blenderの制御用IKやドライバーはGLBにそのまま移行する仕組みではありません。

## 公式素材から再生成する

1. [公式アーカイブ](https://download.blender.org/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip) をダウンロードして展開。
2. リポジトリのルートで次を実行します（パスは環境に合わせて変更）。

```sh
/Applications/Blender.app/Contents/MacOS/Blender \
  --background --factory-startup --disable-autoexec --python-exit-code 1 \
  --python scripts/prepare-human-models.py -- \
  --source /path/to/human_base_meshes_bundle.blend \
  --output "$PWD"
```

この処理は既存の `public/models/human-*.glb` と、このディレクトリの編集用データを上書きします。手動編集後に再実行する際は別途保存してください。サイトの起動や通常のビルドにBlenderは不要です。

処理の流れは、低解像度の元メッシュに自動ウェイトを設定し、Multiresを1段階適用、最大4ボーンの影響に整理し、アニメーションなしのGLBに出力するものです。

この再生成の直後は単色マテリアルです。肌テクスチャを復元するには、続けて [`assets/textures/README.md`](../textures/README.md) のベイク手順を実行してください。
