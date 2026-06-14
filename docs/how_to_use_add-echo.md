# /src/backend/add-echo.py の使用方法
1. `git pull` をターミナルにコピーして実行する
2. `python3 src/backend/add-echo.py` をターミナルにコピーして実行する
3. 大項目、小項目、動画の名前、画像の名前を記入し、動画ファイルと人体画像ファイルをデバイスから選択して `作成してフレーム分割` をクリック
4. プレビュー画面で人体画像をクリックして、エコー開始点とエコー終了点を指定する
5. `開始点と終了点を保存` をクリックする
6. 正しく作成できたことを確認、ターミナルで Ctrl + C を入力して操作を終了する
7. （テストの場合）確認が終わったら `git clean -fd`, `git restore .` をそれぞれターミナルにコピーして実行して作ったものを消す

作成・更新されるもの

- `src/frontend/大項目/小項目.js`
- `src/frontend/大項目Data.js`
- `src/frontend/menuConfig.js`
- `src/frontend/allData.js`
- `data/動画の名前/frame_001.jpg` から `frame_200.jpg` までのエコーフレーム画像
- `data/動画の名前/画像の名前.jpg`
