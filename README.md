# 健身記錄 PWA

手機優先的健身記錄 App：記錄每次使用的器材、每組的次數與重量／坡度／速度等自訂項目，並可依「日期」、「器材」、「訓練部位」回顧。
純 HTML/CSS/JS，**無建置步驟**，以 GitHub Pages 發佈，資料存在 Firebase Firestore（離線可記，回到網路自動同步）。

## 功能
- **底部選單**：月曆｜歷史｜**記錄**（正中間凸出的圓形按鈕）｜器材｜設定。
- **月曆**：月檢視（週日開始），可切上下月、「今天」；有紀錄的日期有綠底與圓點（3 筆以上兩個點），點某天顯示當天紀錄，可「在這天新增紀錄」或分享。
- **記錄**：版面由上到下為 日期 →「這天已記錄」→ 記錄／編輯表單 → 器材選擇；選日期 → 選器材 → 每組一列填入該器材的詳細項目與次數；「＋ 新增一組」會沿用上一組的值；選器材時自動帶入上次的組數設定。
- **器材**：新增／編輯器材名稱、訓練部位（可多選、可自訂）、使用說明、詳細項目（名稱＋單位，例如 重量 kg、坡度 %、速度 km/h），可關閉「記錄次數」（例如跑步機）。
- **歷史**：依日期｜依器材｜依部位三種檢視，點任一筆可回到記錄頁修改或刪除。
- **分享今日訓練**：在「歷史 → 依日期」每一天、以及記錄頁「這天已記錄」都有「📤 分享今日訓練」按鈕，產生手機直式 9:16（1080×1920）圖片（日期、部位、總結數據、各器材每組明細、備註）；內容多時自動緊湊排版，仍放不下就分成多張（右上標 1/2…），分享時一次送出全部、預覽可左右滑動，可用手機的分享選單傳到 LINE／社群，或「下載圖片」；iPhone／Android 也可長按預覽圖存到相簿。
- **設定**：器材匯出／匯入 JSON（匯入前預覽筆數，同名器材可選略過或更新，永不刪除既有器材）、貼上 Firebase 設定、Google 登入／登出、示範模式（假資料）、匯出／匯入 JSON 備份。

## 檔案結構
```
web/                 ← GitHub Pages 發佈的資料夾
  index.html  styles.css
  app.js             啟動、分頁、記錄頁、設定頁
  calendar.js        月曆頁
  history.js         歷史頁（依日期／器材／部位）
  equipment.js       器材頁與器材編輯面板
  share.js           分享圖片（Canvas 繪製、預覽、分享／下載）
  logic.js           純邏輯函式（分組、彙總、格式化、驗證；測試對象）
  store.js           資料層：LocalStore（示範模式）／FirestoreStore（雲端）
  demo-data.js       示範假資料
  manifest.json  sw.js  icons/
tests/               node --test 單元測試
firestore.rules      Firestore 安全規則（只允許本人讀寫自己的資料）
.github/workflows/pages.yml   推上 master 後自動發佈 web/
```

## 資料結構（Firestore）
```
users/{uid}/equipment/{id}
  { name, bodyParts: ["胸","手臂"], instructions, trackReps: true,
    fields: [{ key: "f_xxx", name: "重量", unit: "kg" }], createdAt, updatedAt }

users/{uid}/logs/{id}            ← 一筆 = 某天某器材的全部組數
  { date: "2026-11-23", equipmentId, equipmentName, bodyParts, trackReps, fields,   ← 器材快照
    sets: [{ reps: 12, values: { f_xxx: 40 } }, ...], note, createdAt, updatedAt }
```
- 組數 = `sets.length`；各組內嵌在同一份文件，**存一筆只算 1 次寫入**，免費額度（每日 2 萬次寫入）非常夠用。
- 紀錄保存器材當下的名稱／部位／項目快照，器材之後改名或刪除，歷史仍可正確顯示。
- 詳細項目用固定 `key`，改項目名稱不影響舊資料。

## 分享圖片的總結數據
由 `logic.js` 的 `summarizeDay(logs)` 計算（有單元測試）：
- 器材數（不重複器材）、總組數、總次數（只算有「記錄次數」的器材）。
- 總訓練量 = Σ（重量 × 次數），**只計單位為 kg 的項目**（lb 等不算）。
- 有氧類：單位為 分／分鐘／min／秒／小時／km／公里／m／公尺 的項目，依「名稱＋單位」加總（例如「時間 30 分」）。

### 直式 9:16 排版與分頁規則（`logic.js` 的 `planSharePages`，有單元測試）
1. 一律單欄卡片。先試「一般排版」（每組一行完整文字，例「80 kg × 12 下」）；放得進第 1 張就用它。
2. 否則「緊湊排版」：只有一個有值欄位的器材每列 3 組、簡寫「80×12」，卡片右上標「kg × 下」；只填次數的器材標「次數」、顯示「20 下」；多欄位（如跑步機）每組一行並帶欄位名「速度 6 · 坡度 4 · 時間 15分」。
3. 仍放不下就分頁（總結只在第 1 張），並做頁面平衡，避免最後一頁只剩一張卡。
4. 字級固定（以 1080 寬為準：器材名 40–44px、組內容 32–34px），不自動放大；內容少時卡片由上往下排、下方留白，「健身記錄」固定在底部。單一器材組數多到整頁放不下時顯示「…另 N 組」。
版面尺寸常數在 `SHARE_METRICS`，`share.js` 完全依規劃結果的座標繪製。

圖片字型使用系統字型堆疊 `'PingFang TC','Noto Sans TC','Microsoft JhengHei',sans-serif`；「分享」按鈕只在瀏覽器支援分享檔案（`navigator.canShare({files})`）時出現，否則只有「下載圖片」。

## Firebase 設定方式：為什麼用「設定頁貼上」
Firebase 網頁設定（apiKey、projectId…）不是密碼，資料安全靠「Google 登入＋firestore.rules」。
本專案採 **App 設定頁貼上設定（存在瀏覽器 localStorage）**，好處是 repo 裡完全不放任何專案設定、不用改程式碼就能換專案；缺點是換手機／清除瀏覽器資料時要重新貼一次。
設定頁接受純 JSON，也接受 Firebase 主控台直接複製的 `const firebaseConfig = { ... };` 片段。

### 建立 Firebase 專案（摘要）
1. 到 Firebase 主控台建立專案（可不啟用 Google Analytics），方案維持免費的 Spark。
2. Build → Authentication → 開始使用 → 登入方式啟用「Google」。
3. Authentication → 設定 → 授權網域，加入 `a50206123.github.io`（本機測試另有 `localhost`）。
4. Build → Firestore Database → 建立資料庫（區域建議 `asia-east1` 台灣），以正式版模式建立。
5. Firestore → 規則，貼上本 repo 的 `firestore.rules` 內容並發布。
6. 專案設定 → 一般 → 你的應用程式 → 新增「網頁」應用程式，複製 `firebaseConfig`。
7. 打開 App → 設定 → 貼上 → 「儲存並使用雲端」→「用 Google 登入」。

## 本機測試
```bash
cd web && python3 -m http.server 8790     # 開 http://localhost:8790/?demo=1 為示範模式
npm test                                   # 等同 node --test tests/*.test.js
```
- 網址加 `?demo=1` 強制示範模式（資料存 localStorage），設定頁可「載入假資料」。
- 可用 hash 直接開到指定畫面：`#tab=history&view=equipment`、`#tab=equipment&edit=<器材id>`。

## ⚠️ 更新前端時務必進版
每次修改 `web/` 內任何檔案，都要把 `web/sw.js` 的 `const CACHE = 'fitness-v6'`（目前版本）的版本號加一（v7、v8…），
並同步更新 `app.js` 設定頁顯示的版本，否則手機上的 PWA 會一直讀到舊快取。新增前端檔案時也要加進 `sw.js` 的 `APP_SHELL`。

## 部署
推上 `master` 後，GitHub Actions（`.github/workflows/pages.yml`）會自動把 `web/` 發佈到 GitHub Pages。
第一次需在 repo → Settings → Pages → Source 選「GitHub Actions」。

## 版本紀錄
- v0.4.2（快取 fitness-v6）：分享圖取消自動放大，器材卡字級改為適中大小。
- v0.4.1（快取 fitness-v5）：月曆改為週日開始。
- v0.4.0（快取 fitness-v4）：月曆分頁、記錄按鈕置中凸出、器材匯出／匯入 JSON、記錄頁版面調整；分享圖改直式 9:16、單欄、標示欄位名與單位、頁面平衡與自動放大。
- v0.3.0（快取 fitness-v3）：分享圖改為 1:1 正方形，內容多時自動緊湊排版或分成多張。
- v0.2.0（快取 fitness-v2）：新增「分享今日訓練」圖片。
- v0.1.0（快取 fitness-v1）：初版，記錄／器材／三種歷史檢視／示範模式／Firebase。
