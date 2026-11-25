/**
 * 健身記錄 PWA 主程式模組
 * 負責應用啟動、資料層切換（LocalStore／FirestoreStore）、底部分頁切換、
 * Hash 路由、模式標籤、Toast 提示、全螢幕面板（Sheet）、記錄頁、設定頁與 Service Worker 註冊。
 */

import {
  BODY_PARTS,
  makeId,
  toDateStr,
  formatDateLabel,
  newSetFrom,
  cleanSets,
  formatLogSummary,
  lastLogForEquipment,
  parseFirebaseConfig,
  buildEquipmentExport,
  parseEquipmentImport,
  mergeEquipment,
} from './logic.js';

import {
  LocalStore,
  FirestoreStore,
  getSavedFirebaseConfig,
  saveFirebaseConfig,
  clearFirebaseConfig,
  isDemoForced,
} from './store.js';

import { renderCalendar } from './calendar.js';
import { renderHistory } from './history.js';
import { renderEquipment, openEquipmentEditor } from './equipment.js';
import { openSharePreview } from './share.js';
import { blankSet, resolveLogView, migrateLegacyLogs } from './equipment-link.js';
import { openLogEditor } from './log-editor.js';

const APP_VERSION_LABEL = 'v0.4.3（快取 fitness-v7）';
const VALID_TABS = new Set(['calendar', 'history', 'record', 'equipment', 'settings']);
const VALID_HISTORY_VIEWS = new Set(['date', 'equipment', 'part']);

/** 目前是否為雲端（Firebase）模式 */
let isCloudMode = false;

/** 目前所在分頁 */
let activeTab = 'record';

/** Toast 自動隱藏計時器 */
let toastTimer = null;

/** 目前開啟小視窗（Modal）的關閉回呼與識別序號 */
let currentModalOnClose = null;
let modalTokenSeq = 0;
let activeModalToken = 0;

/** 已執行過一次性舊紀錄 equipmentId 遷移的紀錄 ID 集合（防止重複寫回迴圈） */
const migratedLogIds = new Set();

/** 雲端模式初始化完成前尚未載入資料時，暫存的 Hash 深連結動作 */
let pendingHashAction = null;

/** 記錄頁 UI 狀態（表單僅用於新增紀錄） */
const recordState = {
  date: toDateStr(),
  partFilter: '全部',
  equipmentId: null,
  sets: [],
  note: '',
};

/** 設定頁草稿狀態（避免重繪時遺失輸入中的 Firebase 設定文字與器材匯入預覽） */
const settingsState = {
  firebaseText: '',
  initialized: false,
  eqImportPreview: null,
};

const initialTodayStr = toDateStr();

/** 共用應用上下文物件（依 SPEC 傳入各分頁模組） */
export const ctx = {
  data: { equipment: [], logs: [], rawLogs: [] },
  store: null,
  view: {
    historyView: 'date',
    calMonth: initialTodayStr.slice(0, 7),
    calSelected: initialTodayStr,
  },
  rerender: () => renderCurrentTab(),
  toast,
  go,
  openSheet,
  closeSheet,
  openModal,
  closeModal,
  confirm: (msg) => window.confirm(msg),
  esc,
};

/* ==========================================================================
   通用工具函式
   ========================================================================== */

/**
 * HTML 字元跳脫，防止 XSS 與標記破壞
 * @param {unknown} str
 * @returns {string}
 */
export function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 依天數偏移本地日期字串 'YYYY-MM-DD'（使用本地時間避免時區誤差）
 * @param {string} dateStr
 * @param {number} deltaDays
 * @returns {string}
 */
function shiftDateStr(dateStr, deltaDays) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  const base = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date();
  base.setDate(base.getDate() + deltaDays);
  return toDateStr(base);
}

/**
 * 檢查是否為合法的 'YYYY-MM-DD' 日期字串
 * @param {string | null} str
 * @returns {boolean}
 */
function isValidDateStr(str) {
  return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str.trim());
}

/* ==========================================================================
   Toast 提示、模式標籤、全螢幕面板（Sheet）
   ========================================================================== */

/**
 * 顯示輕量提示訊息（Toast）
 * @param {string} msg 提示文字
 * @param {boolean} [isError=false] 是否以錯誤樣式顯示
 */
export function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  if (!el) return;

  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }

  el.textContent = String(msg ?? '');
  el.classList.toggle('error', Boolean(isError));
  el.classList.remove('hidden');

  toastTimer = setTimeout(() => {
    el.classList.add('hidden');
    toastTimer = null;
  }, 2600);
}

/**
 * 更新頂部模式標籤（#modeBadge）
 */
function updateModeBadge() {
  const badge = document.getElementById('modeBadge');
  if (!badge) return;

  if (isCloudMode && ctx.store) {
    const user = ctx.store.user;
    if (user) {
      const displayName = user.displayName || user.email || '已登入';
      badge.textContent = `雲端：${displayName}`;
      badge.classList.add('cloud');
    } else {
      badge.textContent = '雲端：未登入';
      badge.classList.remove('cloud');
    }
  } else {
    badge.textContent = '示範模式';
    badge.classList.remove('cloud');
  }
}

/**
 * 打開全螢幕滑入面板（#sheet）
 * @param {string} title 面板標題
 * @param {Node | string | null} bodyEl 主內容元素或 HTML 字串
 * @param {Node | string | null} [footerEl=null] 底部操作列元素或 HTML 字串
 */
export function openSheet(title, bodyEl, footerEl = null) {
  const sheet = document.getElementById('sheet');
  if (!sheet) return;

  sheet.innerHTML = '';

  // 標題列（含關閉鈕）
  const header = document.createElement('div');
  header.className = 'sheet-header';

  const titleEl = document.createElement('h2');
  titleEl.className = 'sheet-title';
  titleEl.textContent = title || '';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn-ghost btn-icon';
  closeBtn.setAttribute('aria-label', '關閉面板');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => closeSheet());

  header.append(titleEl, closeBtn);
  sheet.appendChild(header);

  // 主體內容區
  const body = document.createElement('div');
  body.className = 'sheet-body';
  if (bodyEl instanceof Node) {
    body.appendChild(bodyEl);
  } else if (typeof bodyEl === 'string') {
    body.innerHTML = bodyEl;
  }
  sheet.appendChild(body);

  // 底部按鈕列（選填）
  if (footerEl) {
    const footer = document.createElement('div');
    footer.className = 'sheet-footer';
    if (footerEl instanceof Node) {
      footer.appendChild(footerEl);
    } else if (typeof footerEl === 'string') {
      footer.innerHTML = footerEl;
    }
    sheet.appendChild(footer);
  }

  sheet.classList.remove('hidden');
  sheet.scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

/**
 * 關閉全螢幕滑入面板（#sheet）
 */
export function closeSheet() {
  const sheet = document.getElementById('sheet');
  if (!sheet) return;
  sheet.classList.add('hidden');
  sheet.innerHTML = '';
  document.body.style.overflow = '';
}

/**
 * 打開居中彈出小視窗（#modal），不改變目前分頁與捲動位置
 * @param {string} title 視窗標題
 * @param {Node | string | null} bodyEl 主內容元素或 HTML 字串
 * @param {Node | string | null} [footerEl=null] 底部操作列元素或 HTML 字串
 * @param {{ onClose?: () => void } | null} [opts={}] 選項（onClose 關閉回呼）
 * @returns {() => void} 關閉此小視窗的函式
 */
export function openModal(title, bodyEl, footerEl = null, opts = {}) {
  const modal = document.getElementById('modal');
  if (!modal) return () => {};

  const token = ++modalTokenSeq;
  activeModalToken = token;
  currentModalOnClose = typeof opts?.onClose === 'function' ? opts.onClose : null;

  modal.innerHTML = '';

  // 小視窗主卡片容器（.modal-card）
  const card = document.createElement('div');
  card.className = 'modal-card';

  // 標題列（.modal-header：.modal-title 與關閉鈕 ✕）
  const header = document.createElement('div');
  header.className = 'modal-header';

  const titleEl = document.createElement('h2');
  titleEl.className = 'modal-title';
  titleEl.textContent = title || '';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn-ghost btn-icon';
  closeBtn.setAttribute('aria-label', '關閉視窗');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => closeModal());

  header.append(titleEl, closeBtn);
  card.appendChild(header);

  // 主體內容區（.modal-body）
  const body = document.createElement('div');
  body.className = 'modal-body';
  if (bodyEl instanceof Node) {
    body.appendChild(bodyEl);
  } else if (typeof bodyEl === 'string') {
    body.innerHTML = bodyEl;
  }
  card.appendChild(body);

  // 底部按鈕列（.modal-footer，選填）
  if (footerEl) {
    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    if (footerEl instanceof Node) {
      footer.appendChild(footerEl);
    } else if (typeof footerEl === 'string') {
      footer.innerHTML = footerEl;
    }
    card.appendChild(footer);
  }

  modal.appendChild(card);

  // 點擊半透明背景遮罩關閉小視窗
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };

  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');

  return () => {
    if (activeModalToken === token) {
      closeModal();
    }
  };
}

/**
 * 關閉居中彈出小視窗（#modal），還原背景捲動並呼叫 onClose 回呼
 */
export function closeModal() {
  const modal = document.getElementById('modal');
  const isOpen = Boolean(modal && !modal.classList.contains('hidden'));
  const onClose = currentModalOnClose;

  currentModalOnClose = null;
  activeModalToken = 0;

  if (modal) {
    modal.classList.add('hidden');
    modal.innerHTML = '';
    modal.onclick = null;
  }

  document.body.classList.remove('modal-open');

  if (isOpen && typeof onClose === 'function') {
    onClose();
  }
}

/* ==========================================================================
   分頁切換與 Hash 路由
   ========================================================================== */

/**
 * 更新底部按鈕與五個分頁 section 的顯示狀態
 * @param {string} tab
 */
function applyTabUI(tab) {
  activeTab = VALID_TABS.has(tab) ? tab : 'record';

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    const isCurrent = btn.dataset.tab === activeTab;
    btn.classList.toggle('active', isCurrent);
    if (isCurrent) {
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.removeAttribute('aria-current');
    }
  });

  document.querySelectorAll('.tab-panel').forEach((panel) => {
    const isCurrent = panel.dataset.tabPanel === activeTab;
    panel.classList.toggle('hidden', !isCurrent);
  });
}

/**
 * 以 replaceState 同步網址 hash（不觸發 hashchange 事件）
 * @param {string} hashStr
 */
function syncHashSilently(hashStr) {
  try {
    const normalized = hashStr.startsWith('#') ? hashStr : `#${hashStr}`;
    if (location.hash !== normalized) {
      history.replaceState(null, '', normalized);
    }
  } catch {
    // 忽略部分受限環境的 history.replaceState 錯誤
  }
}

/**
 * 切換分頁並處理可選導覽參數
 * @param {string} tab 分頁名稱（calendar／history／record／equipment／settings）
 * @param {object} [opts={}] 導覽選項（editLogId、equipmentId、date、view、editEquipmentId、fromHash）
 */
export function go(tab, opts = {}) {
  const targetTab = VALID_TABS.has(tab) ? tab : 'record';

  // 若透過程式呼叫編輯既有紀錄（非初始 Hash 載入），直接在目前分頁開小視窗，不切換畫面與捲動位置
  if (targetTab === 'record' && opts.editLogId && !opts.fromHash) {
    openLogEditor(ctx, opts.editLogId);
    return;
  }

  // 切換分頁時先關閉可能開啟的小視窗與編輯面板
  if (!opts.keepModal) {
    closeModal();
  }
  if (!opts.keepSheet) {
    closeSheet();
  }

  if (targetTab === 'history' && opts.view && VALID_HISTORY_VIEWS.has(opts.view)) {
    ctx.view.historyView = opts.view;
  }

  if (targetTab === 'record') {
    if (opts.date && isValidDateStr(opts.date)) {
      recordState.date = opts.date.trim();
    }
    if (!opts.editLogId && opts.equipmentId) {
      selectEquipmentForRecord(opts.equipmentId);
    }
  }

  applyTabUI(targetTab);

  // 非來自 hashchange 的一般切換，同步精簡 hash
  if (!opts.fromHash) {
    if (targetTab === 'history') {
      syncHashSilently(`#tab=history&view=${ctx.view.historyView}`);
    } else if (targetTab === 'record' && opts.equipmentId) {
      syncHashSilently(`#tab=record&eq=${encodeURIComponent(opts.equipmentId)}`);
    } else {
      syncHashSilently(`#tab=${targetTab}`);
    }
  }

  renderCurrentTab();

  if (targetTab === 'record' && opts.editLogId) {
    openLogEditor(ctx, opts.editLogId);
  } else if (targetTab === 'equipment' && opts.editEquipmentId) {
    openEquipmentEditor(ctx, opts.editEquipmentId);
  }

  // 若指定器材進入新增表單，捲動至表單區；否則回到頂端
  if (targetTab === 'record' && opts.equipmentId && !opts.editLogId) {
    const formCard = document.getElementById('recordFormCard');
    if (formCard) {
      formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } else {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
}

/**
 * 解析網址 hash 並套用對應分頁與動作
 * 支援：
 * - #tab=calendar（可附 month=YYYY-MM、date=YYYY-MM-DD）
 * - #tab=history&view=equipment（或 date／part）
 * - #tab=record&eq=<equipmentId>
 * - #tab=equipment&edit=<equipmentId>
 */
function applyHash() {
  const raw = (location.hash || '').replace(/^#/, '').trim();
  if (!raw) {
    applyTabUI(activeTab);
    renderCurrentTab();
    return;
  }

  const params = new URLSearchParams(raw);
  const tabParam = params.get('tab');
  const targetTab = VALID_TABS.has(tabParam) ? tabParam : 'record';

  pendingHashAction = null;

  if (targetTab === 'calendar') {
    const monthParam = params.get('month');
    const dateParam = params.get('date');
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam.trim())) {
      ctx.view.calMonth = monthParam.trim();
    }
    if (dateParam && isValidDateStr(dateParam)) {
      ctx.view.calSelected = dateParam.trim();
      if (!monthParam) {
        ctx.view.calMonth = dateParam.trim().slice(0, 7);
      }
    }
    go('calendar', { fromHash: true });
    return;
  }

  if (targetTab === 'history') {
    const viewParam = params.get('view');
    go('history', {
      view: VALID_HISTORY_VIEWS.has(viewParam) ? viewParam : ctx.view.historyView,
      fromHash: true,
    });
    return;
  }

  if (targetTab === 'record') {
    const eqId = params.get('eq') || params.get('equipmentId');
    const editLogId = params.get('edit') || params.get('editLogId');
    const dateParam = params.get('date');

    if (editLogId) {
      const exists = ctx.data.logs.some((l) => l.id === editLogId);
      if (!exists && isCloudMode && ctx.data.logs.length === 0) {
        pendingHashAction = { type: 'record-edit', id: editLogId };
      }
      go('record', { editLogId: exists ? editLogId : undefined, date: dateParam, fromHash: true });
      return;
    }

    if (eqId) {
      const exists = ctx.data.equipment.some((e) => e.id === eqId);
      if (!exists && isCloudMode && ctx.data.equipment.length === 0) {
        pendingHashAction = { type: 'record-eq', id: eqId };
      }
      go('record', { equipmentId: exists ? eqId : undefined, date: dateParam, fromHash: true });
      return;
    }

    go('record', { date: dateParam, fromHash: true });
    return;
  }

  if (targetTab === 'equipment') {
    const editEqId = params.get('edit');
    if (editEqId) {
      const exists = ctx.data.equipment.some((e) => e.id === editEqId);
      if (!exists && isCloudMode && ctx.data.equipment.length === 0) {
        // 雲端資料尚未回傳，先切換到器材頁待資料到齊後再開啟編輯面板
        pendingHashAction = { type: 'equipment-edit', id: editEqId };
        go('equipment', { fromHash: true });
        return;
      }
      go('equipment', { editEquipmentId: editEqId, fromHash: true });
      return;
    }
    go('equipment', { fromHash: true });
    return;
  }

  go(targetTab, { fromHash: true });
}

/**
 * 嘗試執行先前因雲端資料尚未載入而暫存的 Hash 動作
 */
function flushPendingHashAction() {
  if (!pendingHashAction) return;
  const action = pendingHashAction;

  if (action.type === 'equipment-edit') {
    if (ctx.data.equipment.some((e) => e.id === action.id)) {
      pendingHashAction = null;
      if (activeTab === 'equipment') {
        openEquipmentEditor(ctx, action.id);
      }
    }
  } else if (action.type === 'record-eq') {
    if (ctx.data.equipment.some((e) => e.id === action.id)) {
      pendingHashAction = null;
      if (activeTab === 'record') {
        selectEquipmentForRecord(action.id);
        renderRecord();
      }
    }
  } else if (action.type === 'record-edit') {
    if (ctx.data.logs.some((l) => l.id === action.id)) {
      pendingHashAction = null;
      openLogEditor(ctx, action.id);
    }
  }
}

/**
 * 重新繪製目前啟用的分頁內容
 */
function renderCurrentTab() {
  const panel = document.getElementById(`tab-${activeTab}`);
  if (!panel) return;

  if (activeTab === 'calendar') {
    renderCalendar(panel, ctx);
  } else if (activeTab === 'record') {
    renderRecord(panel);
  } else if (activeTab === 'history') {
    renderHistory(panel, ctx);
  } else if (activeTab === 'equipment') {
    renderEquipment(panel, ctx);
  } else if (activeTab === 'settings') {
    renderSettings(panel);
  }
}

/* ==========================================================================
   記錄頁（SPEC 第 1 點）
   ========================================================================== */

/**
 * 選取器材進入新增記錄狀態：初始為一組空白（不再自動帶入上次數值）
 * @param {string} eqId
 */
function selectEquipmentForRecord(eqId) {
  const eq = ctx.data.equipment.find((item) => item.id === eqId);
  if (!eq) return;

  const fields = Array.isArray(eq.fields) ? eq.fields : [];
  const trackReps = eq.trackReps !== false;
  recordState.equipmentId = eq.id;
  recordState.note = '';
  recordState.sets = [blankSet(fields, trackReps)];
}

/**
 * 重設記錄頁選取狀態（例如清除示範資料或載入假資料後）
 */
function resetRecordSelection() {
  recordState.partFilter = '全部';
  recordState.equipmentId = null;
  recordState.sets = [];
  recordState.note = '';
}

/**
 * 取得目前篩選列要顯示的訓練部位清單（依 BODY_PARTS 順序，自訂部位排在後面）
 * @param {Array<object>} equipmentList
 * @returns {string[]}
 */
function getFilterBodyParts(equipmentList) {
  const used = new Set();
  for (const eq of equipmentList) {
    if (!Array.isArray(eq?.bodyParts)) continue;
    for (const part of eq.bodyParts) {
      const trimmed = typeof part === 'string' ? part.trim() : '';
      if (trimmed) used.add(trimmed);
    }
  }

  const sorted = Array.from(used).sort((a, b) => {
    const idxA = BODY_PARTS.indexOf(a);
    const idxB = BODY_PARTS.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b, 'zh-Hant');
  });

  return ['全部', ...sorted];
}

/**
 * 取得記錄頁新增表單目前選取的器材定義
 * @returns {{ id: string, name: string, bodyParts: string[], instructions: string, trackReps: boolean, fields: Array<object> } | null}
 */
function getActiveRecordTarget() {
  if (!recordState.equipmentId) return null;
  const eq = ctx.data.equipment.find((e) => e.id === recordState.equipmentId);
  if (!eq) {
    // 該器材已被刪除時清除選取狀態
    recordState.equipmentId = null;
    recordState.sets = [];
    recordState.note = '';
    return null;
  }

  return {
    id: eq.id,
    name: eq.name || '未命名器材',
    bodyParts: Array.isArray(eq.bodyParts) ? eq.bodyParts : [],
    instructions: eq.instructions || '',
    trackReps: eq.trackReps !== false,
    fields: Array.isArray(eq.fields) ? eq.fields : [],
  };
}

/**
 * 繪製記錄頁（#tab-record）
 * 注意：表單輸入時直接更新 recordState，不呼叫本函式重繪，避免輸入游標跳動。
 * @param {HTMLElement} [container]
 */
export function renderRecord(container = document.getElementById('tab-record')) {
  if (!container) return;

  const equipmentList = Array.isArray(ctx.data.equipment) ? ctx.data.equipment : [];
  const logs = Array.isArray(ctx.data.logs) ? ctx.data.logs : [];

  // 若先前選的部位已無器材，重設為「全部」
  const filterParts = getFilterBodyParts(equipmentList);
  if (!filterParts.includes(recordState.partFilter)) {
    recordState.partFilter = '全部';
  }

  const filteredEquipment =
    recordState.partFilter === '全部'
      ? equipmentList
      : equipmentList.filter(
          (eq) => Array.isArray(eq.bodyParts) && eq.bodyParts.includes(recordState.partFilter)
        );

  const activeTarget = getActiveRecordTarget();

  // 取得當日已記錄清單（依建立時間由舊到新排序）
  const dayLogs = logs
    .filter((l) => l && l.date === recordState.date)
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

  const partsHtml = [];

  // 1. 日期選擇列（.date-bar）
  partsHtml.push(`
    <div class="card stack" style="gap:8px">
      <div class="date-bar" style="flex-wrap:wrap">
        <input
          type="date"
          id="recordDateInput"
          value="${esc(recordState.date)}"
          aria-label="選擇訓練日期"
          style="flex:1 1 160px"
        >
        <button type="button" class="btn btn-ghost" data-action="today" style="padding:10px 14px;white-space:nowrap">今天</button>
        <div class="row" style="width:100%">
          <button type="button" class="btn btn-ghost" data-action="prev-day" style="flex:1">‹ 前一天</button>
          <button type="button" class="btn btn-ghost" data-action="next-day" style="flex:1">後一天 ›</button>
        </div>
      </div>
      <div class="muted" style="text-align:center">${esc(formatDateLabel(recordState.date))}</div>
    </div>
  `);

  // 2. 「這天已記錄（N）」清單（含分享鈕；點擊項目開啟修改紀錄小視窗）
  const dayLogsHtml =
    dayLogs.length === 0
      ? '<div class="card empty-state">這天尚未有訓練紀錄</div>'
      : `
        <div class="stack">
          ${dayLogs
            .map(
              (log) => `
                <button
                  type="button"
                  class="log-item"
                  data-edit-log-id="${esc(log.id)}"
                >
                  <div class="row-between">
                    <strong>${esc(log.equipmentName || '未命名器材')}</strong>
                  </div>
                  <div class="muted">${esc(formatLogSummary(log))}</div>
                  ${log.note ? `<div class="card-sub">${esc(log.note)}</div>` : ''}
                </button>
              `
            )
            .join('')}
        </div>
      `;

  const shareDayBtnHtml =
    dayLogs.length > 0
      ? `<button type="button" class="btn btn-ghost btn-block" data-action="share-day" data-date="${esc(recordState.date)}">📤 分享今日訓練</button>`
      : '';

  partsHtml.push(`
    <h2 class="section-title">這天已記錄（${dayLogs.length}）</h2>
    ${shareDayBtnHtml}
    ${dayLogsHtml}
  `);

  // 3. 選取器材後顯示新增訓練紀錄表單（位於已記錄清單與器材格之間）
  if (activeTarget) {
    const prevLog = lastLogForEquipment(logs, activeTarget.id);
    const prevSummaryHtml = prevLog
      ? `上次：${esc(formatDateLabel(prevLog.date))} · ${esc(formatLogSummary(prevLog))}`
      : '上次：尚無紀錄';

    const eqTagsHtml = activeTarget.bodyParts
      .map((p) => `<span class="tag">${esc(p)}</span>`)
      .join('');

    const instructionsText = activeTarget.instructions.trim();
    const instructionsHtml = instructionsText
      ? `<div style="white-space:pre-wrap">${esc(instructionsText)}</div>`
      : `<div class="muted">尚無使用說明</div>`;

    // 每組輸入列（.sets-list > .set-row）
    const setsRowsHtml = recordState.sets
      .map((set, idx) => {
        const fieldInputsHtml = activeTarget.fields
          .map((field) => {
            const val = set?.values?.[field.key] ?? '';
            const unitHtml = field.unit ? `<span class="unit">${esc(field.unit)}</span>` : '';
            return `
              <label class="input-unit" aria-label="第 ${idx + 1} 組 ${esc(field.name)}">
                <input
                  type="text"
                  inputmode="decimal"
                  placeholder="${esc(field.name)}"
                  value="${esc(val)}"
                  data-set-idx="${idx}"
                  data-field-key="${esc(field.key)}"
                >
                ${unitHtml}
              </label>
            `;
          })
          .join('');

        const repsInputHtml = activeTarget.trackReps
          ? `
            <label class="input-unit" aria-label="第 ${idx + 1} 組 次數">
              <input
                type="text"
                inputmode="decimal"
                placeholder="次數"
                value="${esc(set?.reps ?? '')}"
                data-set-idx="${idx}"
                data-field-reps="1"
              >
              <span class="unit">下</span>
            </label>
          `
          : '';

        return `
          <div class="set-row">
            <span class="set-num" style="flex:0 0 auto;min-width:44px;white-space:nowrap;font-size:13px">第 ${idx + 1} 組</span>
            <div class="set-fields">
              ${fieldInputsHtml}
              ${repsInputHtml}
            </div>
            <button
              type="button"
              class="btn btn-ghost set-del"
              data-action="del-set"
              data-set-idx="${idx}"
              aria-label="刪除第 ${idx + 1} 組"
            >✕</button>
          </div>
        `;
      })
      .join('');

    partsHtml.push(`
      <div id="recordFormCard" class="card stack">
        <div class="row-between">
          <div>
            <div class="card-title">${esc(activeTarget.name)}</div>
            <div class="chips" style="gap:4px;margin-top:4px">${eqTagsHtml}</div>
          </div>
        </div>

        <details>
          <summary>使用說明</summary>
          ${instructionsHtml}
        </details>

        <div class="muted">${prevSummaryHtml}</div>

        <div class="sets-list" id="recordSetsList">
          ${setsRowsHtml || '<div class="muted" style="text-align:center;padding:8px 0">目前沒有組數，請點下方按鈕新增一組</div>'}
        </div>

        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-ghost" style="flex:1" data-action="add-set">＋ 新增一組（空白）</button>
          <button type="button" class="btn btn-ghost" style="flex:0 0 auto;white-space:nowrap" data-action="copy-prev-set"${recordState.sets.length === 0 ? ' disabled' : ''}>複製上一組</button>
        </div>

        <div>
          <label class="field-label" for="recordNoteInput">備註</label>
          <textarea
            id="recordNoteInput"
            placeholder="可填寫座椅高度、發力感受等備註（選填）"
            style="min-height:76px"
          >${esc(recordState.note)}</textarea>
        </div>

        <div class="stack" style="gap:8px">
          <button type="button" class="btn btn-primary btn-block" data-action="save-log">儲存紀錄</button>
        </div>
      </div>
    `);
  }

  // 4. 沒有任何器材時的引導空狀態；有器材時顯示部位篩選與器材卡片格
  if (equipmentList.length === 0) {
    partsHtml.push(`
      <div class="card empty-state stack">
        <div>目前還沒有建立任何訓練器材。</div>
        <div class="muted">請先到器材頁新增器材，或前往設定頁載入示範假資料。</div>
        <div class="stack" style="margin-top:8px">
          <button type="button" class="btn btn-primary btn-block" data-action="go-equipment">前往器材頁新增</button>
          <button type="button" class="btn btn-ghost btn-block" data-action="go-settings">前往設定頁載入假資料</button>
        </div>
      </div>
    `);
  } else {
    // 部位篩選橫向捲動列（.chips-scroll）
    const chipsHtml = filterParts
      .map((part) => {
        const active = recordState.partFilter === part;
        return `<button type="button" class="chip${active ? ' active' : ''}" data-part="${esc(part)}">${esc(part)}</button>`;
      })
      .join('');
    partsHtml.push(`<div class="chips-scroll" aria-label="訓練部位篩選">${chipsHtml}</div>`);

    // 2 欄器材卡片格（.grid2 .equip-card）
    const cardsHtml = filteredEquipment
      .map((eq) => {
        const isSelected = recordState.equipmentId === eq.id;
        const lastLog = lastLogForEquipment(logs, eq.id);
        const lastText = lastLog ? `上次：${formatDateLabel(lastLog.date)}` : '尚未記錄';
        const tagsHtml = (Array.isArray(eq.bodyParts) ? eq.bodyParts : [])
          .map((p) => `<span class="tag">${esc(p)}</span>`)
          .join('');
        return `
          <button type="button" class="equip-card${isSelected ? ' active' : ''}" data-eq-id="${esc(eq.id)}">
            <div class="card-title">${esc(eq.name)}</div>
            <div class="chips" style="gap:4px">${tagsHtml}</div>
            <div class="card-sub">${esc(lastText)}</div>
          </button>
        `;
      })
      .join('');
    partsHtml.push(`<div class="grid2">${cardsHtml}</div>`);
  }

  container.innerHTML = partsHtml.join('');

  // 綁定記錄頁事件
  bindRecordEvents(container, activeTarget);
}

/**
 * 綁定記錄頁內互動事件（輸入欄位僅更新記憶體狀態，不重繪整頁）
 * @param {HTMLElement} container
 * @param {object | null} activeTarget
 */
function bindRecordEvents(container, activeTarget) {
  // 日期輸入框變更
  const dateInput = container.querySelector('#recordDateInput');
  if (dateInput) {
    dateInput.addEventListener('change', () => {
      if (isValidDateStr(dateInput.value)) {
        recordState.date = dateInput.value;
        renderRecord(container);
      }
    });
  }

  // 日期快速按鈕
  container.querySelector('[data-action="prev-day"]')?.addEventListener('click', () => {
    recordState.date = shiftDateStr(recordState.date, -1);
    renderRecord(container);
  });
  container.querySelector('[data-action="next-day"]')?.addEventListener('click', () => {
    recordState.date = shiftDateStr(recordState.date, 1);
    renderRecord(container);
  });
  container.querySelector('[data-action="today"]')?.addEventListener('click', () => {
    recordState.date = toDateStr();
    renderRecord(container);
  });

  // 空狀態引導按鈕
  container.querySelector('[data-action="go-equipment"]')?.addEventListener('click', () => {
    go('equipment');
  });
  container.querySelector('[data-action="go-settings"]')?.addEventListener('click', () => {
    go('settings');
  });

  // 部位篩選 chips
  container.querySelectorAll('.chips-scroll .chip[data-part]').forEach((chip) => {
    chip.addEventListener('click', () => {
      recordState.partFilter = chip.dataset.part || '全部';
      renderRecord(container);
    });
  });

  // 選擇器材卡片（開啟表單後平滑捲動至表單）
  container.querySelectorAll('.equip-card[data-eq-id]').forEach((card) => {
    card.addEventListener('click', () => {
      const eqId = card.dataset.eqId;
      if (!eqId) return;
      selectEquipmentForRecord(eqId);
      renderRecord(container);
      const formCard = container.querySelector('#recordFormCard');
      if (formCard) {
        formCard.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    });
  });

  // 組數表單輸入監聽（不重繪，避免輸入游標跳動）
  const setsList = container.querySelector('#recordSetsList');
  if (setsList && activeTarget) {
    setsList.addEventListener('input', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      const idx = Number(target.dataset.setIdx);
      if (!Number.isInteger(idx) || !recordState.sets[idx]) return;

      if (target.dataset.fieldReps) {
        recordState.sets[idx].reps = target.value;
      } else if (target.dataset.fieldKey) {
        if (!recordState.sets[idx].values || typeof recordState.sets[idx].values !== 'object') {
          recordState.sets[idx].values = {};
        }
        recordState.sets[idx].values[target.dataset.fieldKey] = target.value;
      }
    });

    // 刪除單組按鈕
    setsList.querySelectorAll('[data-action="del-set"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.setIdx);
        if (!Number.isInteger(idx)) return;
        recordState.sets.splice(idx, 1);
        renderRecord(container);
      });
    });
  }

  // 新增一組（空白）
  container.querySelector('[data-action="add-set"]')?.addEventListener('click', () => {
    if (!activeTarget) return;
    recordState.sets.push(blankSet(activeTarget.fields, activeTarget.trackReps));
    renderRecord(container);
  });

  // 複製上一組（沿用上一組數值）
  container.querySelector('[data-action="copy-prev-set"]')?.addEventListener('click', () => {
    if (!activeTarget) return;
    const prev =
      recordState.sets.length > 0 ? recordState.sets[recordState.sets.length - 1] : null;
    recordState.sets.push(newSetFrom(prev, activeTarget.fields));
    renderRecord(container);
  });

  // 備註輸入（不重繪）
  const noteInput = container.querySelector('#recordNoteInput');
  if (noteInput) {
    noteInput.addEventListener('input', () => {
      recordState.note = noteInput.value;
    });
  }

  // 儲存新訓練紀錄
  container.querySelector('[data-action="save-log"]')?.addEventListener('click', () => {
    if (!activeTarget) return;

    if (isCloudMode && !ctx.store?.user) {
      toast('請先前往設定頁登入 Google 帳號', true);
      return;
    }

    const cleaned = cleanSets(recordState.sets, activeTarget.fields, activeTarget.trackReps);
    if (cleaned.length === 0) {
      toast('請至少填寫一組訓練資料', true);
      return;
    }

    const logPayload = {
      id: makeId('log_'),
      date: recordState.date,
      equipmentId: activeTarget.id,
      equipmentName: activeTarget.name,
      bodyParts: [...activeTarget.bodyParts],
      trackReps: activeTarget.trackReps,
      fields: activeTarget.fields.map((f) => ({ ...f })),
      sets: cleaned,
      note: recordState.note.trim(),
    };

    // 清空表單並保留日期與目前器材（重設為一組空白）
    const keepEq = ctx.data.equipment.find((e) => e.id === activeTarget.id);
    recordState.note = '';
    if (keepEq) {
      const keepFields = Array.isArray(keepEq.fields) ? keepEq.fields : [];
      const keepTrackReps = keepEq.trackReps !== false;
      recordState.equipmentId = keepEq.id;
      recordState.sets = [blankSet(keepFields, keepTrackReps)];
    } else {
      recordState.equipmentId = null;
      recordState.sets = [];
    }

    // 寫入不 await 擋畫面，立即提示並於失敗時顯示錯誤
    ctx.store.saveLog(logPayload).catch((err) => {
      toast('儲存失敗：' + (err?.message || err), true);
    });
    toast('已儲存');
    renderRecord(container);
  });

  // 分享今日訓練圖片
  const shareDayBtn = container.querySelector('[data-action="share-day"]');
  if (shareDayBtn) {
    shareDayBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const date = shareDayBtn.dataset.date || recordState.date;
      openSharePreview(ctx, date).catch((e) => {
        toast('產生圖片失敗：' + (e?.message || e), true);
      });
    });
  }

  // 點擊「這天已記錄」列開啟修改紀錄小視窗
  container.querySelectorAll('.log-item[data-edit-log-id]').forEach((item) => {
    item.addEventListener('click', () => {
      const logId = item.dataset.editLogId;
      if (!logId) return;
      openLogEditor(ctx, logId);
    });
  });
}

/* ==========================================================================
   設定頁（SPEC 第 4 點）
   ========================================================================== */

/**
 * 繪製設定頁（#tab-settings）
 * @param {HTMLElement} [container]
 */
export function renderSettings(container = document.getElementById('tab-settings')) {
  if (!container) return;

  // 若使用者正在編輯 Firebase 設定文字框，避免背景同步重繪導致游標跳動
  if (document.activeElement && document.activeElement.id === 'firebaseConfigInput') {
    return;
  }

  const savedConfig = getSavedFirebaseConfig();
  if (!settingsState.initialized) {
    settingsState.firebaseText = savedConfig ? JSON.stringify(savedConfig, null, 2) : '';
    settingsState.initialized = true;
  }

  const eqCount = Array.isArray(ctx.data.equipment) ? ctx.data.equipment.length : 0;
  const logCount = Array.isArray(ctx.data.logs) ? ctx.data.logs.length : 0;

  let modeCardBody = '';
  if (isCloudMode && ctx.store) {
    const user = ctx.store.user;
    const authBlock = user
      ? `
        <div class="muted">登入狀態：已登入 ${esc(user.displayName || '')}${user.email ? `（${esc(user.email)}）` : ''}</div>
        <button type="button" class="btn btn-ghost btn-block" data-action="sign-out">登出</button>
      `
      : `
        <div class="muted">登入狀態：尚未登入。登入 Google 帳號後即可同步您的個人器材與訓練紀錄。</div>
        <button type="button" class="btn btn-primary btn-block" data-action="sign-in">用 Google 登入</button>
      `;

    modeCardBody = `
      <div class="muted">目前為<strong>雲端模式</strong>（Firebase Firestore，已啟用離線持久快取）。</div>
      ${authBlock}
      <button type="button" class="btn btn-danger btn-block" data-action="switch-demo">改回示範模式</button>
    `;
  } else {
    const demoHint = isDemoForced()
      ? '目前為<strong>示範模式</strong>（網址參數 <code>?demo=1</code> 強制啟用），資料僅儲存在本機瀏覽器。'
      : '目前為<strong>示範模式</strong>，資料僅儲存在本機瀏覽器（localStorage）。';

    modeCardBody = `
      <div class="muted">${demoHint}</div>
      ${
        savedConfig
          ? '<button type="button" class="btn btn-ghost btn-block" data-action="switch-demo">改回示範模式（清除已存 Firebase 設定）</button>'
          : ''
      }
    `;
  }

  // 示範模式專屬的假資料管理卡片
  const demoToolsCard = !isCloudMode
    ? `
      <div class="card stack">
        <h2 class="card-title">示範資料管理</h2>
        <div class="muted">目前共有 ${eqCount} 項器材、${logCount} 筆訓練紀錄。</div>
        <button type="button" class="btn btn-primary btn-block" data-action="load-demo">載入假資料</button>
        <button type="button" class="btn btn-danger btn-block" data-action="clear-demo">清除示範資料</button>
      </div>
    `
    : '';

  // 器材匯入預覽卡（選取檔案後顯示）
  let eqImportPreviewHtml = '';
  if (settingsState.eqImportPreview) {
    const preview = settingsState.eqImportPreview;
    const previewPlan = mergeEquipment(ctx.data.equipment, preview.equipment, 'update');
    const totalInFile = preview.equipment.length + preview.errors.length;
    const addedCount = previewPlan.added;
    const sameNameCount = previewPlan.updated;
    const dupCount = previewPlan.skipped;
    const errorCount = preview.errors.length;

    const errSuffix = errorCount > 0 ? `（略過 ${errorCount} 筆格式錯誤）` : '';
    const dupSuffix = dupCount > 0 ? `，另有 ${dupCount} 筆檔內重複已略過` : '';
    const summaryText = `檔案內 ${totalInFile} 筆器材：新增 ${addedCount} 筆、同名 ${sameNameCount} 筆${errSuffix}${dupSuffix}`;

    const errorListHtml =
      errorCount > 0
        ? `
          <ul class="stack" style="margin:0;padding-left:20px;gap:4px;color:#fca5a5;font-size:13px">
            ${preview.errors.map((err) => `<li>${esc(err)}</li>`).join('')}
          </ul>
        `
        : '';

    eqImportPreviewHtml = `
      <div class="card stack" id="eqImportPreviewCard" style="background-color:var(--bg-elevated);gap:10px">
        <div class="row-between">
          <strong>匯入預覽${preview.fileName ? `：${esc(preview.fileName)}` : ''}</strong>
        </div>
        <div class="muted">${esc(summaryText)}</div>
        ${errorListHtml}
        <div class="stack" style="gap:6px">
          <div class="field-label" style="margin-bottom:0">同名器材：</div>
          <div class="row" style="gap:16px;flex-wrap:wrap">
            <label class="row" style="cursor:pointer">
              <input type="radio" name="eqImportMode" value="skip"${preview.mode === 'skip' ? ' checked' : ''}>
              <span>略過</span>
            </label>
            <label class="row" style="cursor:pointer">
              <input type="radio" name="eqImportMode" value="update"${preview.mode === 'update' ? ' checked' : ''}>
              <span>更新</span>
            </label>
          </div>
        </div>
        <div class="row">
          <button type="button" class="btn btn-primary" style="flex:1" data-action="confirm-import-eq"${preview.equipment.length === 0 ? ' disabled' : ''}>確認匯入</button>
          <button type="button" class="btn btn-ghost" style="flex:1" data-action="cancel-import-eq">取消</button>
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="card stack">
      <h2 class="card-title">目前模式</h2>
      ${modeCardBody}
    </div>

    ${demoToolsCard}

    <div class="card stack">
      <h2 class="card-title">Firebase 雲端設定</h2>
      <p class="muted">
        Firebase 設定值（apiKey 等）僅用來識別專案，並不是密碼；您的資料是透過 <code>firestore.rules</code> 安全規則與 Google 帳號登入身分保護，只有本人能夠讀寫。
      </p>
      <div>
        <label class="field-label" for="firebaseConfigInput">貼上 Firebase 設定（JSON 或 firebaseConfig 程式碼片段）</label>
        <textarea
          id="firebaseConfigInput"
          rows="6"
          spellcheck="false"
          placeholder='const firebaseConfig = {\n  apiKey: "...",\n  authDomain: "...",\n  projectId: "...",\n  appId: "..."\n};'
        >${esc(settingsState.firebaseText)}</textarea>
      </div>
      <button type="button" class="btn btn-primary btn-block" data-action="save-firebase">儲存並使用雲端</button>
    </div>

    <div class="card stack">
      <h2 class="card-title">器材匯出／匯入</h2>
      <div class="muted">可單獨匯出或匯入器材清單（目前共 ${eqCount} 項器材）；匯入時永不刪除既有器材。</div>
      <button type="button" class="btn btn-ghost btn-block" data-action="export-eq-json">匯出器材 JSON</button>
      <input type="file" id="importEqJsonInput" accept="application/json,.json" class="hidden">
      <button type="button" class="btn btn-ghost btn-block" data-action="import-eq-json">匯入器材 JSON</button>
      ${eqImportPreviewHtml}
    </div>

    <div class="card stack">
      <h2 class="card-title">資料備份與還原</h2>
      <div class="muted">目前共有 ${eqCount} 項器材、${logCount} 筆訓練紀錄。匯入時相同 ID 的項目會被覆蓋，其餘資料將保留。</div>
      <button type="button" class="btn btn-ghost btn-block" data-action="export-json">匯出 JSON 備份</button>
      <input type="file" id="importJsonInput" accept="application/json,.json" class="hidden">
      <button type="button" class="btn btn-ghost btn-block" data-action="import-json">匯入 JSON</button>
    </div>

    <div class="card stack">
      <h2 class="card-title">關於本應用</h2>
      <div class="row-between">
        <span class="muted">App 版本</span>
        <strong>${esc(APP_VERSION_LABEL)}</strong>
      </div>
    </div>
  `;

  bindSettingsEvents(container);
}

/**
 * 綁定設定頁互動事件
 * @param {HTMLElement} container
 */
function bindSettingsEvents(container) {
  // 記錄 Firebase 設定 textarea 草稿
  const configTextarea = container.querySelector('#firebaseConfigInput');
  if (configTextarea) {
    configTextarea.addEventListener('input', () => {
      settingsState.firebaseText = configTextarea.value;
    });
  }

  // 儲存並使用雲端
  container.querySelector('[data-action="save-firebase"]')?.addEventListener('click', () => {
    const raw = configTextarea ? configTextarea.value : settingsState.firebaseText;
    try {
      const parsed = parseFirebaseConfig(raw);
      saveFirebaseConfig(parsed);
      toast('已儲存 Firebase 設定，正在重新載入...');
      if (isDemoForced()) {
        const url = new URL(location.href);
        url.searchParams.delete('demo');
        location.href = url.toString();
      } else {
        location.reload();
      }
    } catch (err) {
      toast(err?.message || 'Firebase 設定格式有誤', true);
    }
  });

  // 雲端模式：用 Google 登入
  container.querySelector('[data-action="sign-in"]')?.addEventListener('click', async () => {
    if (!ctx.store || typeof ctx.store.signIn !== 'function') return;
    try {
      await ctx.store.signIn();
      toast('登入成功');
    } catch (err) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        toast('Google 登入失敗：' + (err?.message || err), true);
      }
    }
  });

  // 雲端模式：登出
  container.querySelector('[data-action="sign-out"]')?.addEventListener('click', async () => {
    if (!ctx.store || typeof ctx.store.signOut !== 'function') return;
    try {
      await ctx.store.signOut();
      migratedLogIds.clear();
      resetRecordSelection();
      settingsState.eqImportPreview = null;
      toast('已登出 Google 帳號');
    } catch (err) {
      toast('登出失敗：' + (err?.message || err), true);
    }
  });

  // 改回示範模式
  container.querySelector('[data-action="switch-demo"]')?.addEventListener('click', () => {
    if (!ctx.confirm('確定要清除 Firebase 設定並改回示範模式嗎？')) return;
    clearFirebaseConfig();
    location.reload();
  });

  // 示範模式：載入假資料
  container.querySelector('[data-action="load-demo"]')?.addEventListener('click', () => {
    if (!ctx.store || typeof ctx.store.loadDemoData !== 'function') return;
    if (!ctx.confirm('載入假資料將覆蓋目前的示範器材與訓練紀錄，確定要繼續嗎？')) return;
    migratedLogIds.clear();
    ctx.store.loadDemoData();
    resetRecordSelection();
    toast('已載入示範假資料');
  });

  // 示範模式：清除示範資料
  container.querySelector('[data-action="clear-demo"]')?.addEventListener('click', () => {
    if (!ctx.store || typeof ctx.store.clearAll !== 'function') return;
    if (!ctx.confirm('確定要清除全部示範器材與訓練紀錄嗎？此操作無法復原。')) return;
    migratedLogIds.clear();
    ctx.store.clearAll();
    resetRecordSelection();
    toast('已清除示範資料');
  });

  // 匯出器材 JSON
  container.querySelector('[data-action="export-eq-json"]')?.addEventListener('click', () => {
    if (!ctx.store) return;
    try {
      const exported = ctx.store.exportAll();
      const eqList = Array.isArray(exported?.equipment) ? exported.equipment : ctx.data.equipment;
      const payload = buildEquipmentExport(eqList);
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fitness-equipment-${toDateStr()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(`已下載器材 JSON（共 ${eqList.length} 項）`);
    } catch (err) {
      toast('匯出器材失敗：' + (err?.message || err), true);
    }
  });

  // 匯入器材 JSON：選擇檔案並顯示預覽卡
  const importEqInput = container.querySelector('#importEqJsonInput');
  container.querySelector('[data-action="import-eq-json"]')?.addEventListener('click', () => {
    if (isCloudMode && !ctx.store?.user) {
      toast('請先登入 Google 帳號再匯入器材', true);
      return;
    }
    importEqInput?.click();
  });

  importEqInput?.addEventListener('change', async () => {
    const file = importEqInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseEquipmentImport(text);
      settingsState.eqImportPreview = {
        fileName: file.name || '',
        equipment: Array.isArray(parsed?.equipment) ? parsed.equipment : [],
        errors: Array.isArray(parsed?.errors) ? parsed.errors : [],
        mode: 'skip',
      };
      renderSettings(container);
    } catch (err) {
      toast('讀取器材檔失敗：' + (err?.message || err), true);
    } finally {
      importEqInput.value = '';
    }
  });

  // 器材匯入預覽：同名器材處理方式（略過／更新）
  container.querySelectorAll('input[name="eqImportMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (settingsState.eqImportPreview && (radio.value === 'skip' || radio.value === 'update')) {
        settingsState.eqImportPreview.mode = radio.value;
      }
    });
  });

  // 器材匯入預覽：確認匯入（逐筆 saveEquipment 不 await 擋畫面）
  container.querySelector('[data-action="confirm-import-eq"]')?.addEventListener('click', () => {
    const preview = settingsState.eqImportPreview;
    if (!preview) return;
    if (isCloudMode && !ctx.store?.user) {
      toast('請先登入 Google 帳號再匯入器材', true);
      return;
    }

    const result = mergeEquipment(ctx.data.equipment, preview.equipment, preview.mode);
    settingsState.eqImportPreview = null;

    let hasError = false;
    for (const eq of result.toSave) {
      ctx.store.saveEquipment(eq).catch((err) => {
        if (!hasError) {
          hasError = true;
          toast('匯入器材失敗：' + (err?.message || err), true);
        }
      });
    }

    const summaryParts = [];
    if (result.added > 0) summaryParts.push(`新增 ${result.added} 筆`);
    if (result.updated > 0) summaryParts.push(`更新 ${result.updated} 筆`);
    if (result.skipped > 0) summaryParts.push(`略過 ${result.skipped} 筆`);
    toast(
      summaryParts.length > 0
        ? `已匯入器材（${summaryParts.join('、')}）`
        : '沒有需要匯入的新器材'
    );
    renderSettings(container);
  });

  // 器材匯入預覽：取消
  container.querySelector('[data-action="cancel-import-eq"]')?.addEventListener('click', () => {
    settingsState.eqImportPreview = null;
    renderSettings(container);
  });

  // 匯出 JSON 備份
  container.querySelector('[data-action="export-json"]')?.addEventListener('click', () => {
    if (!ctx.store) return;
    try {
      const exported = ctx.store.exportAll();
      const payload = {
        version: APP_VERSION_LABEL,
        exportedAt: new Date().toISOString(),
        equipment: exported.equipment || [],
        logs: exported.logs || [],
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fitness-backup-${toDateStr()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('已下載 JSON 備份檔');
    } catch (err) {
      toast('匯出失敗：' + (err?.message || err), true);
    }
  });

  // 匯入 JSON
  const importInput = container.querySelector('#importJsonInput');
  container.querySelector('[data-action="import-json"]')?.addEventListener('click', () => {
    if (isCloudMode && !ctx.store?.user) {
      toast('請先登入 Google 帳號再匯入資料', true);
      return;
    }
    importInput?.click();
  });

  importInput?.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        (!Array.isArray(parsed.equipment) && !Array.isArray(parsed.logs))
      ) {
        throw new Error('備份檔格式不正確（需包含 equipment 或 logs 陣列）');
      }
      await ctx.store.importAll(parsed);
      const importedEq = Array.isArray(parsed.equipment) ? parsed.equipment.length : 0;
      const importedLogs = Array.isArray(parsed.logs) ? parsed.logs.length : 0;
      toast(`已匯入 ${importedEq} 項器材、${importedLogs} 筆紀錄`);
    } catch (err) {
      toast('匯入失敗：' + (err?.message || err), true);
    } finally {
      importInput.value = '';
    }
  });
}

/* ==========================================================================
   啟動流程與全域事件綁定
   ========================================================================== */

/**
 * 初始化資料層、事件監聽與初始畫面
 */
export async function initApp() {
  // 綁定底部分頁按鈕
  document.querySelectorAll('.tab-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      go(btn.dataset.tab);
    });
  });

  // 支援 Esc 鍵關閉小視窗或全螢幕面板（優先關閉上層小視窗）
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('modal');
      if (modal && !modal.classList.contains('hidden')) {
        closeModal();
        return;
      }
      const sheet = document.getElementById('sheet');
      if (sheet && !sheet.classList.contains('hidden')) {
        closeSheet();
      }
    }
  });

  // 選擇資料儲存層：?demo=1 或無 Firebase 設定使用 LocalStore，否則建立 FirestoreStore
  const savedConfig = getSavedFirebaseConfig();
  if (isDemoForced() || !savedConfig) {
    ctx.store = new LocalStore();
    isCloudMode = false;
  } else {
    try {
      ctx.store = await FirestoreStore.create(savedConfig);
      isCloudMode = true;
    } catch (err) {
      console.error('初始化 FirestoreStore 失敗，退回示範模式：', err);
      toast('雲端模式初始化失敗，已退回示範模式', true);
      ctx.store = new LocalStore();
      isCloudMode = false;
    }
  }

  updateModeBadge();

  // 雲端模式監聽登入狀態變動
  if (isCloudMode && typeof ctx.store.onAuth === 'function') {
    ctx.store.onAuth(() => {
      updateModeBadge();
      if (activeTab === 'settings') {
        renderSettings();
      }
    });
  }

  // 訂閱資料變動：保存原始 rawLogs、解析顯示用 logs、一次性遷移舊紀錄並重繪目前分頁
  ctx.store.subscribe((data) => {
    const equipment = Array.isArray(data?.equipment) ? data.equipment : [];
    const rawLogs = Array.isArray(data?.logs) ? data.logs : [];
    const logs = rawLogs.map((log) => resolveLogView(log, equipment));

    ctx.data = {
      equipment,
      rawLogs,
      logs,
    };

    // 一次性補齊舊紀錄缺少或失效的 equipmentId（以 Set 防止重複寫回造成迴圈）
    if (equipment.length > 0 && rawLogs.length > 0 && (!isCloudMode || ctx.store?.user)) {
      const toMigrate = migrateLegacyLogs(rawLogs, equipment).filter(
        (log) => log?.id && !migratedLogIds.has(log.id)
      );
      if (toMigrate.length > 0) {
        for (const log of toMigrate) {
          migratedLogIds.add(log.id);
        }
        queueMicrotask(() => {
          for (const log of toMigrate) {
            ctx.store?.saveLog(log).catch((err) => {
              console.warn('遷移舊紀錄 equipmentId 失敗：', err);
            });
          }
        });
      }
    }

    flushPendingHashAction();
    renderCurrentTab();
  });

  // 套用初始 Hash 路由並監聽後續變更
  applyHash();
  window.addEventListener('hashchange', applyHash);
}

// 瀏覽器環境自動啟動與註冊 Service Worker
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  initApp();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('Service Worker 註冊失敗：', err);
      });
    });
  }
}
