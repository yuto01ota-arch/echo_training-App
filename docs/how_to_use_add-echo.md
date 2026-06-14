# /src/backend/add-echo.py の使用方法
1. `git pull` をターミナルにコピーして実行する
2. `python3 src/backend/add-echo.py` をターミナルにコピーして実行する
3. 大項目、小項目、動画の名前を記入し、動画ファイルをデバイスから選択して `作成してフレーム分割` をクリック
4. 正しく作成できたことを確認、ターミナルで Ctrl + C を入力して操作を終了する
5. （テストの場合）確認が終わったら `git clean -fd`, `git restore .` をそれぞれターミナルにコピーして実行して作ったものを消す

作成・更新されるもの

- `src/frontend/大項目/小項目.js`
- `src/frontend/大項目Data.js`
- `src/frontend/menuConfig.js`
- `src/frontend/allData.js`
- `data/動画の名前/frame_001.jpg` から始まるフレーム画像
