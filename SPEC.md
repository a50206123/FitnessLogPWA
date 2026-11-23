# 健身記錄 PWA 規格（給程式產生工具看的共同規格）

## 總原則
- 純 HTML/CSS/JS，**無建置步驟**、無 npm 相依（瀏覽器直接用 ES module）。根目錄 package.json 已設 "type":"module"。
- 所有 UI 文字、程式註解一律**正體中文**（台灣用語）。
- 以手機為主（390x844），大按鈕（最小點擊高度 48px）、主要操作放畫面下半部，單手好按。深色系或淺色系擇一，對比清楚，使用系統字型（含 "Noto Sans TC","Microsoft JhengHei"）。
- 檔案：
  - web/index.html、web/styles.css
  - web/logic.js：**純邏輯函式**（不碰 DOM、不碰 localStorage），供 app 與 tests 共用
  - web/store.js：資料層（示範模式 LocalStore、Firebase 模式 FirestoreStore）
  - web/demo-data.js：產生假資料
  - web/app.js：UI 與流程（type="module" 載入）
  - web/manifest.json、web/sw.js、web/icons/icon-192.png、icon-512.png
  - firestore.rules、.github/workflows/pages.yml、README.md、tests/*.test.js

## 資料結構
器材 Equipment（Firestore：users/{uid}/equipment/{id}）
```
{ id: string, name: "胸推機", bodyParts: ["胸","手臂"], instructions: "座椅調到...",
  trackReps: true,            // 是否記錄次數（跑步機等有氧可關閉）
  fields: [ { key: "f_ab12cd", name: "重量", unit: "kg" } ],   // 使用者自訂詳細項目
  createdAt: ISO字串, updatedAt: ISO字串 }
```
訓練紀錄 Log（Firestore：users/{uid}/logs/{id}）——**一筆 = 某天做某器材的全部組數**（各組內嵌，1 筆只算 1 次寫入）
```
{ id, date: "2026-11-23",     // 本地日期 YYYY-MM-DD
  equipmentId, equipmentName, bodyParts: [...], trackReps, fields: [...],   // 記錄當下的器材快照，器材改名/刪除後歷史仍可讀
  sets: [ { reps: 12, values: { f_ab12cd: 40 } } ],   // 組數 = sets.length，組次 = 陣列順序
  note: "", createdAt, updatedAt }
```
預設訓練部位（依此排序）：胸、背、肩、手臂、腿、臀、核心、有氧、全身；可自訂其他部位（排在後面）。

## logic.js 匯出函式（全部純函式）
- `BODY_PARTS`：預設部位陣列
- `makeId(prefix='')`：產生唯一 id（時間+亂數）
- `toDateStr(date=new Date())`：本地日期 'YYYY-MM-DD'
- `formatDateLabel('2026-11-23')` → '11/23（一）'；若是今年以外加年份 '2025/11/23（日）'
- `newSetFrom(prevSet, fields)`：新增下一組，沿用上一組 reps 與 values（深拷貝）；沒有上一組則 reps 為 '' 、各 field 值為 ''
- `cleanSets(sets, fields, trackReps)`：把字串轉數字、移除全空的組，回傳新陣列
- `summarizeLog(log)` → `{ setCount, totalReps, maxByField: {key: 最大值}, volume }`；volume = Σ(重量×次數)，重量取第一個 unit 為 kg 或 lb 的欄位，沒有則 0
- `formatLogSummary(log)` → 例 '3 組 · 共 30 下 · 重量最高 40 kg'；trackReps=false 時不顯示次數，改列各欄位最高值，例 '1 組 · 速度最高 8 km/h · 坡度最高 3 %'
- `formatSet(set, fields, trackReps)` → 例 '40 kg × 12 下'、'8 km/h · 3 % · 20 分'
- `groupByDate(logs)` → `[{ date, logs }]` 日期新到舊，同日依 createdAt 舊到新
- `groupByEquipment(logs, equipmentList)` → `[{ equipmentId, name, bodyParts, count, lastDate, logs(新到舊) }]`，依 lastDate 新到舊；器材已刪除則用紀錄快照名稱；沒紀錄的器材也列出（count 0）排最後
- `groupByBodyPart(logs)` → `[{ part, count, days, logs(新到舊) }]`，一筆紀錄有多部位則出現在每個部位；依 BODY_PARTS 順序，自訂部位排後；days = 不重複日期數
- `lastLogForEquipment(logs, equipmentId, beforeDate?)`：該器材最近一筆（若給 beforeDate 則取該日期之前）
- `validateEquipment(eq)` → 錯誤訊息陣列（名稱必填、至少一個部位、欄位名稱不可空白或重複）
- `parseFirebaseConfig(text)`：接受純 JSON，或 Firebase 主控台複製的 `const firebaseConfig = { apiKey: "...", ... };` 片段（未加引號的 key、單引號、結尾逗號）；回傳物件；缺 apiKey/authDomain/projectId/appId 時丟出 Error（正體中文訊息）

## store.js
共同介面（class，兩種實作）：
```
subscribe(cb)  // cb({ equipment:[], logs:[] })，資料變動時呼叫；回傳取消函式
saveEquipment(eq) / deleteEquipment(id) / saveLog(log) / deleteLog(id)   // 回傳 Promise
exportAll() → { equipment, logs }；importAll(data)（同 id 覆蓋）
```
- `LocalStore`：存 localStorage 鍵 `fitness.demo.equipment`、`fitness.demo.logs`；有 `loadDemoData()`、`clearAll()`。
- `FirestoreStore`：`static async create(config)` 用 CDN `https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js`、`firebase-auth.js`、`firebase-firestore.js` 動態 import。`initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })` 開離線持久快取。Google 登入：`signInWithPopup`，若錯誤碼為 auth/popup-blocked、auth/operation-not-supported-in-environment、auth/cancelled-popup-request 等則改 `signInWithRedirect`；啟動時呼叫 `getRedirectResult`。`onAuth(cb)`、`signIn()`、`signOut()`、`user`。登入後用 `onSnapshot` 監聽 users/{uid}/equipment 與 users/{uid}/logs。寫入用 `setDoc(doc(...,id), 物件)`（離線時 Promise 要等連線才 resolve，所以 UI 不要 await 它擋畫面）。
- localStorage 鍵 `fitness.firebaseConfig` 有值 → Firebase 模式；否則示範模式。

## 畫面（app.js + index.html）
底部固定分頁列 4 個：**記錄**、**歷史**、**器材**、**設定**。頂部顯示 App 名「健身記錄」與模式標籤（示範模式／雲端：使用者名稱）。
1. 記錄：日期選擇（預設今天，可前後一天快速按鈕）→ 部位篩選 chips → 器材卡片格（2 欄大卡）→ 選了器材後顯示：使用說明（可折疊）、「上次：日期＋摘要」、組數表（每組一列：組次、各詳細項目輸入框附單位、次數（trackReps 才有）、刪除鈕；輸入框 inputmode="decimal"）、大按鈕「＋ 新增一組（沿用上一組）」、備註、「儲存紀錄」主按鈕。下方列「這天已記錄」清單，點一筆可載入編輯（可刪除）。
2. 歷史：分段切換「依日期｜依器材｜依部位」。依日期＝日期卡片，內含各器材摘要；依器材＝器材卡片（名稱、部位、次數、最近日期），點開展開各日期與每組明細；依部位＝部位卡片（筆數、天數），點開展開該部位紀錄。展開用 <details>。點紀錄可跳回記錄頁編輯。
3. 器材：清單（名稱、部位 chips、詳細項目）＋「＋ 新增器材」。編輯表單（全螢幕面板或對話框）：器材名稱、訓練部位（多選 chips＋自訂輸入）、使用說明（textarea）、記錄次數開關、詳細項目列表（名稱＋單位，可新增/刪除，快速加入按鈕：重量 kg、坡度 %、速度 km/h、時間 分、距離 km、阻力 段）、儲存/刪除。
4. 設定：目前模式；Firebase 設定 textarea（貼上 JSON 或 firebaseConfig 片段）＋「儲存並使用雲端」；「Google 登入」/「登出」；「改回示範模式」；示範模式下「載入假資料」「清除示範資料」；「匯出 JSON 備份」「匯入 JSON」；版本號顯示。
- 支援網址參數 `?demo=1` 強制示範模式、`#tab=history&view=equipment` 這類 hash 直接開到指定分頁/檢視（方便截圖）。
- Toast 提示「已儲存」等。註冊 service worker（./sw.js）。

## sw.js
`const CACHE = 'fitness-v1'`；install 預快取 app shell（./、index.html、styles.css、app.js、logic.js、store.js、demo-data.js、manifest.json、icons）；activate 刪除舊快取；同源 GET 用 cache-first 並背景更新；gstatic firebasejs 用 stale-while-revalidate；其他（googleapis/firestore）不攔截。

## UI 模組分工（app.js 拆成三個檔，皆為 ES module）
- web/app.js：啟動、選擇資料層（store.js）、分頁切換、模式標籤、toast、sheet、hash 路由、**記錄頁**、**設定頁**、註冊 sw。
- web/history.js：`export function renderHistory(container, ctx)` —— 歷史頁（依日期｜依器材｜依部位）。
- web/equipment.js：`export function renderEquipment(container, ctx)` —— 器材頁與器材編輯面板。

共用 ctx 物件（由 app.js 建立並傳入；每次資料變動 app.js 會重新呼叫 render）：
```
ctx = {
  data: { equipment: [], logs: [] },     // 目前資料（唯讀）
  store,                                 // LocalStore 或 FirestoreStore
  view: { historyView: 'date'|'equipment'|'part' },   // 可變的 UI 狀態，改完呼叫 ctx.rerender()
  rerender(),                            // 重新繪製目前分頁
  toast(msg),                            // 顯示提示
  go(tab, opts),                         // 切換分頁，例 go('record', { editLogId }) 或 go('record', { equipmentId })
  openSheet(title, bodyEl, footerEl),    // 打開全螢幕面板（#sheet，內含 .sheet-header/.sheet-title/.sheet-body/.sheet-footer 與關閉鈕）
  closeSheet(),
  confirm(msg) → boolean,                // 包裝 window.confirm
  esc(str),                              // HTML 跳脫
}
```
- 一律用 logic.js 的函式做資料整理（groupBy*、formatLogSummary、formatSet、formatDateLabel、validateEquipment、BODY_PARTS、makeId…），不要重寫。
- 寫入：呼叫 `ctx.store.saveX(...)` 不要 await 擋畫面，改 `.catch(e => ctx.toast('儲存失敗：' + e.message))`，並立即 `ctx.toast('已儲存')`。
- 可用的 CSS class（web/styles.css 已定義，請沿用，必要時可在 JS 用少量 inline style）：.btn .btn-primary .btn-ghost .btn-danger .btn-block .btn-icon .card .card-title .card-sub .chip .chip.active .chips .chips-scroll .date-bar .empty-state .equip-card .equip-card.active .grid2 .hidden .log-item .muted .row .row-between .section-title .seg .set-row（內含 .set-num、.set-fields、.input-unit>input+.unit、.set-del）.sets-list .stack .tag .badge

## v2 新功能：分享今日訓練（圖片）
### logic.js 新增（純函式，加測試）
- `summarizeDay(logs)`：傳入「同一天」的紀錄陣列，回傳
```
{ date,                       // 第一筆的 date（空陣列則 ''）
  logs,                       // 依 createdAt 舊到新排序的新陣列
  bodyParts,                  // 不重複部位，依 BODY_PARTS 順序，自訂部位排後
  equipmentCount,             // 不重複 equipmentId 數
  totalSets,                  // 所有 sets 數
  totalReps,                  // 只加 trackReps !== false 的紀錄
  totalVolumeKg,              // Σ(值 × 次數)，只算 unit 為 'kg'（不分大小寫、去空白）的欄位，且該筆 trackReps 才算；四捨五入到小數 1 位
  cardio: [ { name, unit, total } ]   // 時間／距離類欄位加總：unit 屬於 分、分鐘、min、秒、sec、s、小時、hr、h、km、公里、m、公尺 的欄位，依 name+unit 合併，依首次出現順序；total 四捨五入到小數 2 位
}
```
- `formatNumber(n)`：千分位、最多 1 位小數、去掉多餘的 .0，例 12345.0 → '12,345'、1234.56 → '1,234.6'。
### web/share.js（新檔）
- `export function buildShareCanvas(daySummary, { width = 1080, createCanvas } = {})`：用 Canvas 2D 畫直式分享圖，寬 1080，高度依內容自適應（先量測再畫：第一輪只計算高度，第二輪實際繪製）。`createCanvas(w,h)` 預設用 `document.createElement('canvas')`。
- `export async function openSharePreview(ctx, date)`：從 ctx.data.logs 取該日紀錄 → summarizeDay → 等 `document.fonts.ready` → buildShareCanvas → `canvas.toBlob` 轉 PNG → 用 ctx.openSheet('分享今日訓練', body, footer) 顯示預覽 `<img class="share-preview">`（寬 100%，可長按存圖）＋提示文字「iPhone／Android 可長按圖片存到相簿」；footer 有「分享」（`navigator.canShare?.({files:[file]})` 為真才顯示，呼叫 `navigator.share({ files:[file], title:'今日訓練' })`，使用者取消（AbortError）不顯示錯誤）與「下載圖片」（a[download] 下載 `fitness-YYYY-MM-DD.png`）。當日無紀錄時 ctx.toast('這天還沒有紀錄')。
- 圖片設計：深色背景（#0f172a→#111827 漸層）、強調色 #22c55e、字型 `'PingFang TC','Noto Sans TC','Microsoft JhengHei',sans-serif`、左右邊距 64。由上到下：
  1. 小字「今日訓練」＋大字日期「11/23（一）」＋右側年份「2026」（用 formatDateLabel 與 date 字串）
  2. 訓練部位圓角標籤（自動換行）
  3. 總結數據卡片（2×2 格）：器材數「N 項」、總組數「N 組」、總次數「N 下」、總訓練量「N kg」（formatNumber）；若 cardio 有資料，下方再一列「時間 40 分 · 距離 5 km」
  4. 各器材卡片依順序：序號圓圈＋器材名稱＋部位小字；每組一行「第 1 組」＋ formatSet(set, fields, trackReps) 的內容（右側可放該組小計）；備註（有才畫，灰色，自動換行，前綴「📝」或「備註：」）
  5. 底部置中小字「健身記錄」。
  - 中文自動換行用逐字量測（measureText）。圓角矩形自己畫（不要依賴 roundRect 是否存在）。

## v3：分享圖改為 1:1 正方形（1080×1080），放不下自動緊湊或分頁
### logic.js 新增（純函式，加測試 tests/share-pages.test.js）
```
export const SHARE_METRICS = Object.freeze({
  size: 1080, pad: 56, gap: 20, footerH: 56,
  headerOtherH: 92,          // 第 2 張以後的頁首（日期小字＋右上「2/3」）
  // 第 1 張頁首 = dateH + gap + tagsH(標籤列數 × tagRowH) + gap + statsH + (有 cardio ? cardioH : 0) + gap
  dateH: 100, tagRowH: 52, tagCharW: 28, tagPadW: 44, tagGap: 12, statsH: 120, cardioH: 44,
  normal:  { cols: 1, padY: 22, titleH: 50, rowH: 44, noteLineH: 36, noteMaxLines: 2, noteCharsPerLine: 34, setsPerRow: 1 },
  compact: { cols: 2, padY: 16, titleH: 44, rowH: 38, noteLineH: 32, noteMaxLines: 1, noteCharsPerLine: 16, setsPerRow: 2 },
})
```
- `compactSetText(set, fields, trackReps)`：只有 1 個欄位且 trackReps → `'80×12'`；否則各欄位 `值+單位` 以空白連接（例 `'6km/h 1% 5分'`），trackReps 再加 `' ×12'`；空值略過。
- `shareTagRows(bodyParts, metrics)`：估計標籤列數（每個標籤寬 = 字數 × tagCharW + tagPadW，加 tagGap，可用寬 = size − 2×pad，超過換列；無部位回 0）。
- `firstHeaderHeight(daySummary, metrics)`：依上方公式。
- `estimateCardHeight(log, mode, metrics)`：`2×padY + titleH + 列數×rowH + 備註列數×noteLineH`。列數 = ceil(組數 / 每列組數)；每列組數：compact 且 fields.length ≤ 1 時為 setsPerRow(2)，否則 1；normal 恆為 1。備註列數 = 無備註 0，否則 min(noteMaxLines, ceil(字數 / noteCharsPerLine))。
- `planSharePages(daySummary, metrics = SHARE_METRICS)` 回傳
```
{ mode: 'normal' | 'compact',
  pages: [ { pageNo: 1, total: N, hasSummary: true|false, bodyTop, bodyH,
             cards: [ { logIndex, col, x, y, w, h, rowsShown, totalRows, hiddenSets } ] } ] }
```
  規則：
  1. 內容區：x 從 pad 起、寬 W = size − 2×pad；bodyTop = pad + 頁首高（第 1 張用 firstHeaderHeight，其他用 headerOtherH）；bodyH = size − pad − footerH − bodyTop。y 以整張圖座標表示（從 bodyTop 往下排）。
  2. 先試 normal：單欄（x=pad、w=W），卡片依序排、卡片間 gap；全部放得進第 1 張 → mode 'normal'、1 張。
  3. 否則 compact：兩欄，欄寬 cw = (W − gap)/2，col 0 x=pad、col 1 x=pad+cw+gap。依紀錄順序逐一放：放到目前高度較低的那欄（同高放 col 0）；若該欄放不下試另一欄；兩欄都放不下 → 開新一頁（hasSummary false）。
  4. 單張卡片比一整頁 bodyH 還高 → 截斷組數：rowsShown 取放得下的最大列數（至少 1），並保留 1 列顯示「…另 N 組」（hiddenSets = 未顯示的組數，h 依截斷後重算）；未截斷時 rowsShown = totalRows、hiddenSets = 0。
  5. 全部頁面的 total = 頁數；空陣列回 1 張只有總結的頁（cards 空）。
### share.js 改版
- `export function buildShareCanvases(daySummary, { createCanvas } = {})` → canvas 陣列，全部 1080×1080，完全依 planSharePages 的座標繪製（normal 用 formatSet 完整文字、右側小計；compact 用 compactSetText，fields 只有 1 個時在卡片標題旁小字標示單位如「kg × 下」，每列 2 組）。
- 字級下限：compact 組數文字 ≥ 26px、器材名 ≥ 32px、備註 ≥ 24px；normal 組數 32px、器材名 40px。文字超出寬度用「…」截斷（逐字量測）。
- 第 1 張頁首：日期大字＋年份、部位標籤、總結 4 格一列（器材數／總組數／總次數／總訓練量 kg）＋有氧加總列；第 2 張以後頁首：日期小字＋「（續）」。多張時每張右上角標「1/2」膠囊。底部置中「健身記錄」。
- `openSharePreview(ctx, date)`：產生全部頁 → PNG 檔 `fitness-YYYY-MM-DD.png`（多張則 `-1.png`、`-2.png`）。預覽：橫向捲動 scroll-snap 容器 `.share-pages`，每張 `<img class="share-preview">` 正方形，多張時下方顯示「共 N 張，左右滑動查看」與頁點；「分享」一次送全部檔案（canShare 檢查全部檔案）；「下載圖片」逐張下載（間隔 300ms）。
