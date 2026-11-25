/**
 * 健身記錄 PWA 紀錄編輯小視窗模組
 * 透過 ctx.openModal 提供就地修改單筆訓練紀錄（日期、組數、備註、刪除），
 * 完成或取消後停留在原本分頁與捲動位置。
 */

import { cleanSets, newSetFrom, formatDateLabel, toDateStr } from './logic.js';
import { blankSet } from './equipment-link.js';

/**
 * 檢查字串是否為合法的 'YYYY-MM-DD' 日期格式
 * @param {unknown} str
 * @returns {boolean}
 */
function isValidDateStr(str) {
  return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str.trim());
}

/**
 * 安全的 HTML 跳脫函式（優先使用 ctx.esc）
 * @param {object} ctx
 * @param {unknown} val
 * @returns {string}
 */
function safeEsc(ctx, val) {
  if (typeof ctx?.esc === 'function') {
    return ctx.esc(String(val ?? ''));
  }
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 開啟「修改紀錄」小視窗
 * @param {object} ctx 共用應用上下文物件
 * @param {string} logId 訓練紀錄 ID
 */
export function openLogEditor(ctx, logId) {
  const logs = Array.isArray(ctx?.data?.logs) ? ctx.data.logs : [];
  const resolvedLog = logs.find((item) => item && item.id === logId);

  if (!resolvedLog) {
    ctx?.toast?.('找不到這筆訓練紀錄', true);
    return;
  }

  // 優先以 rawLogs 作為基底避免遺漏原始欄位，並移除顯示用的 _resolved 標記
  const rawLogs = Array.isArray(ctx?.data?.rawLogs) ? ctx.data.rawLogs : [];
  const rawLog = rawLogs.find((item) => item && item.id === logId) || null;
  const { _resolved, ...baseLog } = rawLog || resolvedLog;

  const esc = (val) => safeEsc(ctx, val);

  const fields = Array.isArray(resolvedLog.fields)
    ? resolvedLog.fields
        .filter((f) => f && f.key)
        .map((f) => ({
          key: f.key,
          name: String(f.name ?? ''),
          unit: String(f.unit ?? ''),
          orphan: Boolean(f.orphan),
        }))
    : [];

  const trackReps = resolvedLog.trackReps !== false;
  const bodyParts = Array.isArray(resolvedLog.bodyParts)
    ? resolvedLog.bodyParts.filter((p) => typeof p === 'string' && p.trim())
    : [];
  const equipmentName = resolvedLog.equipmentName || '未命名器材';
  const equipmentId = resolvedLog.equipmentId || '';

  // 編輯表單閉包狀態：純輸入時只更新此物件，不重繪整個 modal
  const state = {
    date: isValidDateStr(resolvedLog.date) ? resolvedLog.date.trim() : toDateStr(),
    sets:
      Array.isArray(resolvedLog.sets) && resolvedLog.sets.length > 0
        ? resolvedLog.sets.map((s) => newSetFrom(s, fields))
        : [blankSet(fields, trackReps)],
    note: String(resolvedLog.note || ''),
  };

  let closeHandle = null;
  function closeEditor() {
    if (typeof closeHandle === 'function') {
      closeHandle();
    } else if (typeof ctx?.closeModal === 'function') {
      ctx.closeModal();
    }
  }

  // 建立主體容器
  const bodyEl = document.createElement('div');
  bodyEl.id = 'logEditorForm';
  bodyEl.className = 'stack';
  bodyEl.style.gap = '14px';

  const tagsHtml = bodyParts
    .map((part) => `<span class="tag">${esc(part)}</span>`)
    .join('');

  // 欄位提示列（當輸入框已有數值時，方便辨識各欄與舊欄位）
  const legendItems = fields.map((f) => {
    const label = f.unit ? `${esc(f.name)}（${esc(f.unit)}）` : esc(f.name);
    const orphanBadge = f.orphan ? ' <span class="orphan-tag">（舊欄位）</span>' : '';
    return `<span>${label}${orphanBadge}</span>`;
  });
  if (trackReps) {
    legendItems.push('<span>次數（下）</span>');
  }
  const legendHtml =
    legendItems.length > 0
      ? `<div class="muted" style="font-size:13px;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;">${legendItems.join('')}</div>`
      : '';

  bodyEl.innerHTML = `
    <div class="card stack" style="gap:6px;padding:12px;">
      <div class="card-title">${esc(equipmentName)}</div>
      ${tagsHtml ? `<div class="chips" style="gap:6px;">${tagsHtml}</div>` : ''}
    </div>

    <div>
      <div class="row-between" style="margin-bottom:6px;">
        <label class="field-label" for="logEditorDate" style="margin-bottom:0;">日期</label>
        <span id="logEditorDateLabel" class="muted">${esc(formatDateLabel(state.date))}</span>
      </div>
      <input
        id="logEditorDate"
        type="date"
        value="${esc(state.date)}"
        aria-label="訓練日期"
      >
    </div>

    <div class="stack" style="gap:8px;">
      <label class="field-label" style="margin-bottom:0;">組數明細</label>
      ${legendHtml}
      <div id="logEditorSetsList" class="sets-list"></div>
      <div class="row" style="flex-wrap:wrap;">
        <button type="button" id="btnLogAddBlankSet" class="btn btn-ghost" style="flex:1 1 150px;">＋ 新增一組（空白）</button>
        <button type="button" id="btnLogCopyLastSet" class="btn btn-ghost" style="flex:1 1 120px;">複製上一組</button>
      </div>
    </div>

    <div>
      <label class="field-label" for="logEditorNote">備註</label>
      <textarea
        id="logEditorNote"
        rows="3"
        placeholder="可填寫座椅高度、發力感受等備註（選填）"
        style="min-height:76px;"
      ></textarea>
    </div>
  `;

  const dateInput = bodyEl.querySelector('#logEditorDate');
  const dateLabelEl = bodyEl.querySelector('#logEditorDateLabel');
  const setsListEl = bodyEl.querySelector('#logEditorSetsList');
  const addBlankBtn = bodyEl.querySelector('#btnLogAddBlankSet');
  const copyLastBtn = bodyEl.querySelector('#btnLogCopyLastSet');
  const noteInput = bodyEl.querySelector('#logEditorNote');

  // 設定備註初始值
  noteInput.value = state.note;

  /**
   * 僅重繪組列表區（增刪組時呼叫，不影響日期與備註）
   */
  function renderSetsList() {
    if (state.sets.length === 0) {
      setsListEl.innerHTML =
        '<div class="muted" style="text-align:center;padding:8px 0;">目前沒有組數，請點下方按鈕新增一組</div>';
      return;
    }

    setsListEl.innerHTML = state.sets
      .map((set, idx) => {
        const fieldInputsHtml = fields
          .map((field) => {
            const val = set?.values?.[field.key] ?? '';
            const unitHtml = field.unit
              ? `<span class="unit">${esc(field.unit)}</span>`
              : '';

            if (field.orphan) {
              return `
                <label
                  class="input-unit orphan-field"
                  aria-label="第 ${idx + 1} 組 ${esc(field.name || '舊欄位')}（舊欄位）"
                  title="${esc(field.name || '舊欄位')}（舊欄位）"
                >
                  <span class="orphan-tag">（舊欄位）</span>
                  <input
                    type="text"
                    inputmode="decimal"
                    placeholder="${esc(field.name || '數值')}"
                    value="${esc(val)}"
                    data-set-idx="${idx}"
                    data-field-key="${esc(field.key)}"
                  >
                  ${unitHtml}
                </label>
              `;
            }

            return `
              <label class="input-unit" aria-label="第 ${idx + 1} 組 ${esc(field.name || '數值')}">
                <input
                  type="text"
                  inputmode="decimal"
                  placeholder="${esc(field.name || '數值')}"
                  value="${esc(val)}"
                  data-set-idx="${idx}"
                  data-field-key="${esc(field.key)}"
                >
                ${unitHtml}
              </label>
            `;
          })
          .join('');

        const repsInputHtml = trackReps
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
            <span class="set-num" style="flex:0 0 auto;min-width:44px;white-space:nowrap;font-size:13px;">第 ${idx + 1} 組</span>
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
  }

  // 日期輸入監聽（不重繪整個 modal）
  function handleDateUpdate() {
    const val = String(dateInput.value || '').trim();
    state.date = val;
    dateLabelEl.textContent = isValidDateStr(val) ? formatDateLabel(val) : '';
  }
  dateInput.addEventListener('change', handleDateUpdate);
  dateInput.addEventListener('input', handleDateUpdate);

  // 組數輸入監聽（不重繪，保留輸入焦點與游標）
  setsListEl.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const idx = Number(target.dataset.setIdx);
    if (!Number.isInteger(idx) || !state.sets[idx]) return;

    if (target.dataset.fieldReps) {
      state.sets[idx].reps = target.value;
    } else if (target.dataset.fieldKey) {
      if (!state.sets[idx].values || typeof state.sets[idx].values !== 'object') {
        state.sets[idx].values = {};
      }
      state.sets[idx].values[target.dataset.fieldKey] = target.value;
    }
  });

  // 刪除單組（只重繪組列表區）
  setsListEl.addEventListener('click', (event) => {
    const delBtn = event.target.closest('button[data-action="del-set"]');
    if (!delBtn) return;
    const idx = Number(delBtn.dataset.setIdx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= state.sets.length) return;
    state.sets.splice(idx, 1);
    renderSetsList();
  });

  // 新增一組（空白）
  addBlankBtn.addEventListener('click', () => {
    state.sets.push(blankSet(fields, trackReps));
    renderSetsList();
    const rows = setsListEl.querySelectorAll('.set-row');
    const lastRow = rows[rows.length - 1];
    const firstInput = lastRow?.querySelector('input');
    if (firstInput) {
      firstInput.focus();
    }
  });

  // 複製上一組
  copyLastBtn.addEventListener('click', () => {
    const prev = state.sets.length > 0 ? state.sets[state.sets.length - 1] : null;
    const nextSet = prev ? newSetFrom(prev, fields) : blankSet(fields, trackReps);
    state.sets.push(nextSet);
    renderSetsList();
  });

  // 備註輸入監聽（不重繪）
  noteInput.addEventListener('input', () => {
    state.note = noteInput.value;
  });

  // 初次繪製組列表
  renderSetsList();

  // 建立底部操作列：「刪除這筆」「取消」「儲存」
  const footerEl = document.createElement('div');
  footerEl.className = 'row';
  footerEl.style.width = '100%';
  footerEl.style.gap = '8px';
  footerEl.innerHTML = `
    <button type="button" id="btnLogEditorDelete" class="btn btn-danger" style="padding:10px 12px;">刪除這筆</button>
    <button type="button" id="btnLogEditorCancel" class="btn btn-ghost" style="padding:10px 12px;">取消</button>
    <button type="button" id="btnLogEditorSave" class="btn btn-primary" style="flex:1;">儲存</button>
  `;

  const deleteBtn = footerEl.querySelector('#btnLogEditorDelete');
  const cancelBtn = footerEl.querySelector('#btnLogEditorCancel');
  const saveBtn = footerEl.querySelector('#btnLogEditorSave');

  // 取消：直接關閉，停留在原畫面
  cancelBtn.addEventListener('click', () => {
    closeEditor();
  });

  // 刪除：確認後刪除並關閉
  deleteBtn.addEventListener('click', () => {
    const ok = ctx.confirm('確定要刪除這筆訓練紀錄嗎？');
    if (!ok) return;

    Promise.resolve(ctx.store.deleteLog(resolvedLog.id)).catch((err) => {
      ctx.toast('刪除失敗：' + (err?.message || err), true);
    });

    ctx.toast('已刪除紀錄');
    closeEditor();
  });

  // 儲存：清理組數、去掉 orphan 標記但保留有值的舊欄位、非同步寫入不擋畫面
  saveBtn.addEventListener('click', () => {
    if (!isValidDateStr(state.date)) {
      ctx.toast('請選擇有效的訓練日期', true);
      dateInput.focus();
      return;
    }

    const cleaned = cleanSets(state.sets, fields, trackReps);
    if (cleaned.length === 0) {
      ctx.toast('請至少填寫一組訓練資料', true);
      return;
    }

    // 整理儲存用 fields：去掉 orphan 標記；舊欄位僅在任一組仍有數值時保留
    const savedFields = fields
      .filter((f) => {
        if (!f.orphan) return true;
        return cleaned.some(
          (set) =>
            set.values &&
            Object.prototype.hasOwnProperty.call(set.values, f.key)
        );
      })
      .map((f) => ({
        key: f.key,
        name: f.name,
        unit: f.unit,
      }));

    const updatedLog = {
      ...baseLog,
      date: state.date.trim(),
      equipmentId,
      equipmentName,
      bodyParts: [...bodyParts],
      trackReps,
      fields: savedFields,
      sets: cleaned,
      note: String(state.note || '').trim(),
      updatedAt: new Date().toISOString(),
    };

    Promise.resolve(ctx.store.saveLog(updatedLog)).catch((err) => {
      ctx.toast('儲存失敗：' + (err?.message || err), true);
    });

    ctx.toast('已更新');
    closeEditor();
  });

  closeHandle = ctx.openModal('修改紀錄', bodyEl, footerEl);
}
