# 肌テクスチャ

`skin-albedo-source.png` は、組み込みの image_gen ツールで作成した肌の色テクスチャです。実在人物の写真・スキャンではありません。画像生成の依頼文は `generation-prompt.txt` に保存しています。

この画像をBlenderで立体に投影し、身体のUVに焼き込んでいます。頬・唇の控えめな色調、細かな凹凸、表面の粗さを加えています。眼球は別マテリアルで白目・虹彩・瞳孔を設定しています。

- `male-skin-*` / `female-skin-*`：各モデル専用の色・接線空間ノーマル・粗さマップ（2048 × 2048）。
- `*-eye-*`：眼球の色マップ（256 × 256）。
- `bake-report.json`：最終的なGLBの容量とマップの記録。

全テクスチャは `public/models/human-male.glb` / `human-female.glb` に内包されています。公開時にこのディレクトリを個別配信する必要はありません。編集用 `.blend` にも画像をパックしています。

## 再生成

骨格付きモデルを用意したあと、リポジトリのルートで実行します。

```sh
/Applications/Blender.app/Contents/MacOS/Blender \
  --background --factory-startup --disable-autoexec --python-exit-code 1 \
  --python scripts/texture-human-models.py -- --root "$PWD"
```

この処理はモデルの形状と骨格を保ちながら、UV・マテリアル・GLB・編集用 `.blend` を更新します。手動でポーズを編集したファイルではなく、基本姿勢のモデルを使用してください。再び画像生成を実行する必要はありません。

Human Base MeshesのCC0素材と、このプロジェクトで生成・ベイクしたテクスチャは、出典を区別して [`public/models/NOTICE.txt`](../../public/models/NOTICE.txt) に記載しています。
