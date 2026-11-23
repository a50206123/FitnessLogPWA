/**
 * 健身記錄 PWA 器材頁與器材編輯面板模組
 * 負責器材清單顯示、部位篩選，以及透過全螢幕面板新增／編輯／刪除器材。
 */

import { BODY_PARTS, makeId, validateEquipment } from './logic.js';

/** 篩選列的「全部」選項常數 */
const ALL_PART = '全部';

/** 編輯面板快速加入的常用詳細項目 */
const QUICK_FIELD_PRESETS = Object.freeze([
  { name: '重量', unit: 'kg' },
  { name: '坡度', unit: '%' },
  { name: '速度', unit: 'km/h' },
  { name: '時間', unit: '分' },
  { name: '距離', unit: 'km' },
  { name: '阻力', unit: '段' },
]);

/**
 * 蒐集預設部位與既有器材的自訂部位（依 BODY_PARTS 順序排列，自訂部位排在後面）
 * @param {Array<object>} equipmentList 器材清單
 * @param {string[]} [extraParts=[]] 額外納入的自訂部位
 * @returns {string[]}
 */
function collectBodyParts(equipmentList, extraParts = []) {
  const defaultSet = new Set(BODY_PARTS);
  const customSet = new Set();

  for (const eq of equipmentList || []) {
    if (!eq || !Array.isArray(eq.bodyParts)) continue;
    for (const raw of eq.bodyParts) {
      const part = typeof raw === 'string' ? raw.trim() : '';
      if (part && !defaultSet.has(part)) {
        customSet.add(part);
      }
    }
  }

  for (const raw of extraParts || []) {
    const part = typeof raw === 'string' ? raw.trim() : '';
    if (part && !defaultSet.has(part)) {
      customSet.add(part);
    }
  }

  const customParts = Array.from(customSet).sort((a, b) =>
    a.localeCompare(b, 'zh-Hant')
  );
  return [...BODY_PARTS, ...customParts];
}

/**
 * 依預設部位順序整理部位陣列（去除空白與重複）
 * @param {string[]} parts
 * @returns {string[]}
 */
function normalizeBodyParts(parts) {
  const unique = [];
  const seen = new Set();
  for (const raw of parts || []) {
    const part = typeof raw === 'string' ? raw.trim() : '';
    if (part && !seen.has(part)) {
      seen.add(part);
      unique.push(part);
    }
  }
  unique.sort((a, b) => {
    const idxA = BODY_PARTS.indexOf(a);
    const idxB = BODY_PARTS.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b, 'zh-Hant');
  });
  return unique;
}

/**
 * 統計各器材在歷史紀錄中的紀錄次數
 * @param {Array<object>} logs
 * @returns {Map<string, number>}
 */
function countLogsByEquipment(logs) {
  const counts = new Map();
  for (const log of logs || []) {
    if (!log || !log.equipmentId) continue;
    counts.set(log.equipmentId, (counts.get(log.equipmentId) || 0) + 1);
  }
  return counts;
}

/**
 * 組合器材的詳細項目摘要文字，例如「重量 kg · 次數」
 * @param {object} eq
 * @returns {string}
 */
function formatEquipmentFields(eq) {
  const items = [];
  const fields = Array.isArray(eq?.fields) ? eq.fields : [];

  for (const field of fields) {
    const name = typeof field?.name === 'string' ? field.name.trim() : '';
    const unit = typeof field?.unit === 'string' ? field.unit.trim() : '';
    if (!name) continue;
    items.push(unit ? `${name} ${unit}` : name);
  }

  if (eq?.trackReps !== false) {
    items.push('次數');
  }

  return items.length > 0 ? items.join(' · ') : '無詳細項目';
}

/**
 * 繪製器材管理分頁
 * @param {HTMLElement} container 分頁容器（#tab-equipment）
 * @param {object} ctx 共用上下文物件
 */
export function renderEquipment(container, ctx) {
  if (!container) return;

  const esc = (val) => ctx.esc(String(val ?? ''));
  const equipmentList = Array.isArray(ctx?.data?.equipment)
    ? ctx.data.equipment
    : [];
  const logs = Array.isArray(ctx?.data?.logs) ? ctx.data.logs : [];

  if (!ctx.view) {
    ctx.view = {};
  }

  const allParts = collectBodyParts(equipmentList);
  const filterOptions = [ALL_PART, ...allParts];

  // 若先前選中的自訂部位已不存在，退回「全部」
  let selectedPart = ctx.view.equipmentPart || ALL_PART;
  if (!filterOptions.includes(selectedPart)) {
    selectedPart = ALL_PART;
    ctx.view.equipmentPart = ALL_PART;
  }

  const logCounts = countLogsByEquipment(logs);
  const filteredEquipment =
    selectedPart === ALL_PART
      ? equipmentList
      : equipmentList.filter(
          (eq) =>
            Array.isArray(eq?.bodyParts) && eq.bodyParts.includes(selectedPart)
        );

  // 建立頂部新增按鈕、部位篩選列與器材卡片清單
  const filterChipsHtml = filterOptions
    .map((part) => {
      const isActive = part === selectedPart;
      return `<button type="button" class="chip${isActive ? ' active' : ''}" data-part="${esc(part)}" aria-pressed="${isActive}">${esc(part)}</button>`;
    })
    .join('');

  let listHtml = '';
  if (equipmentList.length === 0) {
    listHtml =
      '<div class="empty-state">尚未建立任何器材，點擊上方「＋ 新增器材」開始新增。</div>';
  } else if (filteredEquipment.length === 0) {
    listHtml = `<div class="empty-state">「${esc(selectedPart)}」部位目前沒有器材。</div>`;
  } else {
    listHtml = filteredEquipment
      .map((eq) => {
        const parts = Array.isArray(eq.bodyParts) ? eq.bodyParts : [];
        const tagsHtml = parts
          .map((part) => `<span class="tag">${esc(part)}</span>`)
          .join('');
        const fieldsText = formatEquipmentFields(eq);
        const count = logCounts.get(eq.id) || 0;

        return `
          <article class="card stack" data-equipment-id="${esc(eq.id)}">
            <div class="row-between" style="align-items:flex-start;">
              <div style="min-width:0;flex:1;">
                <h2 class="card-title">${esc(eq.name)}</h2>
                <div class="card-sub">${esc(fieldsText)}</div>
              </div>
              <span class="muted" style="white-space:nowrap;flex-shrink:0;">已記錄 ${count} 次</span>
            </div>
            ${tagsHtml ? `<div class="chips" style="gap:6px;">${tagsHtml}</div>` : ''}
            <div class="row">
              <button type="button" class="btn btn-ghost" style="flex:1;" data-action="edit" data-id="${esc(eq.id)}">編輯</button>
              <button type="button" class="btn btn-primary" style="flex:1;" data-action="record" data-id="${esc(eq.id)}">去記錄</button>
            </div>
          </article>
        `;
      })
      .join('');
  }

  container.innerHTML = `
    <div id="equipmentPage" class="stack">
      <button type="button" id="btnAddEquipment" class="btn btn-primary btn-block">＋ 新增器材</button>
      <div id="equipmentPartFilter" class="chips-scroll" role="tablist" aria-label="依部位篩選器材">
        ${filterChipsHtml}
      </div>
      <div id="equipmentList" class="stack">
        ${listHtml}
      </div>
    </div>
  `;

  // 綁定「＋ 新增器材」按鈕事件
  const addBtn = container.querySelector('#btnAddEquipment');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      openEquipmentEditor(ctx, null);
    });
  }

  // 綁定部位篩選事件
  const filterBar = container.querySelector('#equipmentPartFilter');
  if (filterBar) {
    filterBar.addEventListener('click', (event) => {
      const chip = event.target.closest('button[data-part]');
      if (!chip) return;
      const part = chip.getAttribute('data-part') || ALL_PART;
      if (ctx.view.equipmentPart === part) return;
      ctx.view.equipmentPart = part;
      if (typeof ctx.rerender === 'function') {
        ctx.rerender();
      } else {
        renderEquipment(container, ctx);
      }
    });
  }

  // 綁定器材卡片按鈕事件（編輯／去記錄）
  const listEl = container.querySelector('#equipmentList');
  if (listEl) {
    listEl.addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      const eqId = btn.getAttribute('data-id');
      if (!eqId) return;

      if (action === 'edit') {
        openEquipmentEditor(ctx, eqId);
      } else if (action === 'record') {
        ctx.go('record', { equipmentId: eqId });
      }
    });
  }
}

/**
 * 開啟器材新增或編輯全螢幕面板
 * 面板內的輸入狀態皆保存在閉包物件中，輸入過程不觸發整頁重繪，只在增刪項目或部位時局部重繪面板內容。
 * @param {object} ctx 共用上下文物件
 * @param {string | null} [equipmentId=null] 編輯既有器材時傳入 id；新增時傳入 null
 */
export function openEquipmentEditor(ctx, equipmentId = null) {
  const esc = (val) => ctx.esc(String(val ?? ''));
  const equipmentList = Array.isArray(ctx?.data?.equipment)
    ? ctx.data.equipment
    : [];
  const existing = equipmentId
    ? equipmentList.find((item) => item && item.id === equipmentId) || null
    : null;
  const isEdit = Boolean(existing);

  // 閉包狀態物件：保留編輯中的表單資料，既有詳細項目維持原本的 key
  const state = {
    name: existing ? String(existing.name || '') : '',
    bodyParts:
      existing && Array.isArray(existing.bodyParts)
        ? existing.bodyParts
            .map((p) => (typeof p === 'string' ? p.trim() : ''))
            .filter(Boolean)
        : [],
    extraParts: [],
    instructions: existing ? String(existing.instructions || '') : '',
    trackReps: existing ? existing.trackReps !== false : true,
    fields:
      existing && Array.isArray(existing.fields)
        ? existing.fields.map((f) => ({
            key: f?.key || makeId('f_'),
            name: typeof f?.name === 'string' ? f.name : '',
            unit: typeof f?.unit === 'string' ? f.unit : '',
          }))
        : [],
    errors: [],
  };

  // 建立面板主要內容容器
  const bodyEl = document.createElement('div');
  bodyEl.id = 'equipmentEditorForm';
  bodyEl.className = 'stack';
  bodyEl.style.gap = '16px';

  bodyEl.innerHTML = `
    <div id="eqEditorErrors" class="card hidden" role="alert" style="background-color:var(--danger-soft);border-color:var(--danger-border);color:#fca5a5;"></div>

    <div>
      <label class="field-label" for="eqNameInput">器材名稱</label>
      <input id="eqNameInput" type="text" placeholder="例如：胸推機、跑步機" autocomplete="off">
    </div>

    <div>
      <label class="field-label">訓練部位（可多選）</label>
      <div id="eqBodyPartsChips" class="chips"></div>
      <div class="row" style="margin-top:10px;">
        <input id="eqCustomPartInput" type="text" placeholder="自訂部位（例如：小腿、前臂）" autocomplete="off" style="flex:1;min-width:0;">
        <button type="button" id="btnAddCustomPart" class="btn" style="flex:0 0 auto;">加入</button>
      </div>
    </div>

    <div>
      <label class="field-label" for="eqInstructionsInput">使用說明</label>
      <textarea id="eqInstructionsInput" rows="3" placeholder="記錄座椅高度、握距、姿勢提醒等（選填）"></textarea>
    </div>

    <label class="card row-between" for="eqTrackReps" style="cursor:pointer;min-height:56px;">
      <div style="min-width:0;padding-right:8px;">
        <div style="font-weight:700;">記錄次數</div>
        <div class="muted" style="font-size:13px;">關閉適用於跑步機等不需計算「下數」的器材</div>
      </div>
      <input id="eqTrackReps" type="checkbox" style="width:28px;height:28px;min-height:28px;">
    </label>

    <div class="stack" style="gap:10px;">
      <div>
        <label class="field-label" style="margin-bottom:2px;">詳細項目</label>
        <div class="muted" style="font-size:13px;">設定每次訓練要記錄的數值欄位與單位</div>
      </div>
      <div id="eqFieldsList" class="stack" style="gap:8px;"></div>
      <button type="button" id="btnAddField" class="btn btn-ghost btn-block">＋ 新增項目</button>
      <div>
        <div class="muted" style="font-size:13px;margin-bottom:6px;">快速加入常用項目：</div>
        <div id="eqQuickFields" class="chips"></div>
      </div>
    </div>
  `;

  const errorsEl = bodyEl.querySelector('#eqEditorErrors');
  const nameInput = bodyEl.querySelector('#eqNameInput');
  const partsChipsEl = bodyEl.querySelector('#eqBodyPartsChips');
  const customPartInput = bodyEl.querySelector('#eqCustomPartInput');
  const addCustomPartBtn = bodyEl.querySelector('#btnAddCustomPart');
  const instructionsInput = bodyEl.querySelector('#eqInstructionsInput');
  const trackRepsInput = bodyEl.querySelector('#eqTrackReps');
  const fieldsListEl = bodyEl.querySelector('#eqFieldsList');
  const addFieldBtn = bodyEl.querySelector('#btnAddField');
  const quickFieldsEl = bodyEl.querySelector('#eqQuickFields');

  // 填入初始值（不觸發重繪）
  nameInput.value = state.name;
  instructionsInput.value = state.instructions;
  trackRepsInput.checked = state.trackReps;

  /** 重繪驗證錯誤區塊 */
  function renderErrors() {
    if (!state.errors.length) {
      errorsEl.classList.add('hidden');
      errorsEl.innerHTML = '';
      return;
    }
    const itemsHtml = state.errors
      .map((msg) => `<li>${esc(msg)}</li>`)
      .join('');
    errorsEl.innerHTML = `
      <div style="font-weight:700;margin-bottom:4px;">請修正以下欄位：</div>
      <ul style="margin:0;padding-left:20px;">${itemsHtml}</ul>
    `;
    errorsEl.classList.remove('hidden');
  }

  /** 重繪訓練部位多選 chips */
  function renderBodyParts() {
    const allParts = collectBodyParts(equipmentList, [
      ...state.extraParts,
      ...state.bodyParts,
    ]);
    const selectedSet = new Set(state.bodyParts);
    partsChipsEl.innerHTML = allParts
      .map((part) => {
        const isActive = selectedSet.has(part);
        return `<button type="button" class="chip${isActive ? ' active' : ''}" data-part="${esc(part)}" aria-pressed="${isActive}">${esc(part)}</button>`;
      })
      .join('');
  }

  /** 重繪詳細項目列表 */
  function renderFields() {
    if (state.fields.length === 0) {
      fieldsListEl.innerHTML =
        '<div class="muted" style="font-size:14px;padding:4px 2px;">尚未新增詳細項目，可點下方「＋ 新增項目」或快速加入。</div>';
      return;
    }

    fieldsListEl.innerHTML = state.fields
      .map(
        (field, idx) => `
          <div class="row" data-field-index="${idx}">
            <input type="text" class="eq-field-name" data-field-prop="name" data-field-index="${idx}" placeholder="項目名稱（例：重量）" value="${esc(field.name)}" style="flex:1.35;min-width:0;">
            <input type="text" class="eq-field-unit" data-field-prop="unit" data-field-index="${idx}" placeholder="單位（例：kg）" value="${esc(field.unit)}" style="flex:0.95;min-width:0;">
            <button type="button" class="btn btn-danger btn-icon eq-field-del" data-del-index="${idx}" aria-label="刪除此項目" title="刪除此項目">✕</button>
          </div>
        `
      )
      .join('');
  }

  /** 繪製快速加入常用項目 chips */
  function renderQuickFields() {
    quickFieldsEl.innerHTML = QUICK_FIELD_PRESETS.map(
      (preset, idx) =>
        `<button type="button" class="chip" data-preset-index="${idx}">＋ ${esc(preset.name)} ${esc(preset.unit)}</button>`
    ).join('');
  }

  /** 加入自訂部位並自動勾選 */
  function handleAddCustomPart() {
    const part = customPartInput.value.trim();
    if (!part) {
      customPartInput.focus();
      return;
    }
    if (!state.extraParts.includes(part)) {
      state.extraParts.push(part);
    }
    if (!state.bodyParts.includes(part)) {
      state.bodyParts.push(part);
    }
    customPartInput.value = '';
    renderBodyParts();
  }

  // 純輸入事件：只更新閉包 state，不重繪面板
  nameInput.addEventListener('input', (event) => {
    state.name = event.target.value;
  });

  instructionsInput.addEventListener('input', (event) => {
    state.instructions = event.target.value;
  });

  trackRepsInput.addEventListener('change', (event) => {
    state.trackReps = event.target.checked;
  });

  fieldsListEl.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const idx = Number(target.getAttribute('data-field-index'));
    const prop = target.getAttribute('data-field-prop');
    if (!Number.isInteger(idx) || idx < 0 || idx >= state.fields.length) return;
    if (prop === 'name' || prop === 'unit') {
      state.fields[idx][prop] = target.value;
    }
  });

  // 部位切換與自訂部位加入：只重繪部位 chips
  partsChipsEl.addEventListener('click', (event) => {
    const chip = event.target.closest('button[data-part]');
    if (!chip) return;
    const part = chip.getAttribute('data-part');
    if (!part) return;
    const idx = state.bodyParts.indexOf(part);
    if (idx >= 0) {
      state.bodyParts.splice(idx, 1);
    } else {
      state.bodyParts.push(part);
    }
    renderBodyParts();
  });

  addCustomPartBtn.addEventListener('click', handleAddCustomPart);
  customPartInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleAddCustomPart();
    }
  });

  // 刪除詳細項目：只重繪詳細項目列表
  fieldsListEl.addEventListener('click', (event) => {
    const delBtn = event.target.closest('button[data-del-index]');
    if (!delBtn) return;
    const idx = Number(delBtn.getAttribute('data-del-index'));
    if (!Number.isInteger(idx) || idx < 0 || idx >= state.fields.length) return;
    state.fields.splice(idx, 1);
    renderFields();
  });

  // 新增空白詳細項目：使用 makeId('f_') 建立新 key
  addFieldBtn.addEventListener('click', () => {
    state.fields.push({
      key: makeId('f_'),
      name: '',
      unit: '',
    });
    renderFields();
    const inputs = fieldsListEl.querySelectorAll('.eq-field-name');
    const lastInput = inputs[inputs.length - 1];
    if (lastInput) {
      lastInput.focus();
    }
  });

  // 快速加入常用項目：已存在同名項目則不重複加入
  quickFieldsEl.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-preset-index]');
    if (!btn) return;
    const idx = Number(btn.getAttribute('data-preset-index'));
    const preset = QUICK_FIELD_PRESETS[idx];
    if (!preset) return;

    const exists = state.fields.some(
      (field) => String(field.name || '').trim() === preset.name
    );
    if (exists) {
      ctx.toast(`「${preset.name}」已存在`);
      return;
    }

    state.fields.push({
      key: makeId('f_'),
      name: preset.name,
      unit: preset.unit,
    });
    renderFields();
  });

  // 初次繪製面板動態區塊
  renderErrors();
  renderBodyParts();
  renderFields();
  renderQuickFields();

  // 建立面板底部操作列（儲存與刪除）
  const footerEl = document.createElement('div');
  footerEl.className = 'row';
  footerEl.style.width = '100%';
  footerEl.innerHTML = `
    ${isEdit ? '<button type="button" id="btnDeleteEquipment" class="btn btn-danger">刪除器材</button>' : ''}
    <button type="button" id="btnSaveEquipment" class="btn btn-primary" style="flex:1;">儲存</button>
  `;

  const saveBtn = footerEl.querySelector('#btnSaveEquipment');
  saveBtn.addEventListener('click', () => {
    const candidate = {
      name: String(state.name || '').trim(),
      bodyParts: normalizeBodyParts(state.bodyParts),
      instructions: String(state.instructions || '').trim(),
      trackReps: Boolean(state.trackReps),
      fields: state.fields.map((field) => ({
        key: field.key || makeId('f_'),
        name: String(field.name || '').trim(),
        unit: String(field.unit || '').trim(),
      })),
    };

    const errors = validateEquipment(candidate);
    if (errors.length > 0) {
      state.errors = errors;
      renderErrors();
      errorsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    state.errors = [];
    renderErrors();

    const now = new Date().toISOString();
    const record = {
      ...candidate,
      id: existing ? existing.id : makeId('eq_'),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    // 寫入不 await 擋畫面，失敗時再以 toast 提示
    Promise.resolve(ctx.store.saveEquipment(record)).catch((err) => {
      ctx.toast('儲存失敗：' + (err?.message || err));
    });

    ctx.closeSheet();
    ctx.toast('已儲存');
  });

  if (isEdit) {
    const deleteBtn = footerEl.querySelector('#btnDeleteEquipment');
    deleteBtn.addEventListener('click', () => {
      const ok = ctx.confirm('刪除器材不會刪除歷史紀錄，確定刪除？');
      if (!ok) return;

      Promise.resolve(ctx.store.deleteEquipment(existing.id)).catch((err) => {
        ctx.toast('刪除失敗：' + (err?.message || err));
      });

      ctx.closeSheet();
      ctx.toast('已刪除器材');
    });
  }

  ctx.openSheet(isEdit ? '編輯器材' : '新增器材', bodyEl, footerEl);
}
