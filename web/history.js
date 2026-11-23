/**
 * 健身記錄 PWA 歷史頁模組
 * 提供「依日期」、「依器材」、「依部位」三種分段檢視與簡易訓練統計。
 */

import {
  formatDateLabel,
  formatLogSummary,
  formatSet,
  groupByBodyPart,
  groupByDate,
  groupByEquipment,
  toDateStr,
} from './logic.js';
import { openSharePreview } from './share.js';

/** 合法的歷史檢視模式清單 */
const VALID_VIEWS = new Set(['date', 'equipment', 'part']);

/** 分段切換按鈕定義 */
const VIEW_TABS = [
  { key: 'date', label: '依日期' },
  { key: 'equipment', label: '依器材' },
  { key: 'part', label: '依部位' },
];

/** 無資料時的提示文字 */
const EMPTY_MESSAGE = '還沒有紀錄，到「記錄」分頁開始吧';

/**
 * 取得 HTML 跳脫函式（優先使用 ctx.esc，缺少時提供安全備援）
 * @param {object} ctx
 * @returns {(value: unknown) => string}
 */
function getEscaper(ctx) {
  if (typeof ctx?.esc === 'function') {
    return (value) => ctx.esc(value);
  }
  return (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
}

/**
 * 計算頂部簡易統計：總訓練天數、本週天數（週一至週日）、總筆數
 * @param {Array<object>} logs
 * @param {Array<{ date: string, logs: Array<object> }>} dateGroups
 * @returns {{ totalDays: number, weekDays: number, totalLogs: number }}
 */
function calcHistoryStats(logs, dateGroups) {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=週日、1=週一 ... 6=週六
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = toDateStr(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday)
  );
  const weekEnd = toDateStr(
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - diffToMonday + 6
    )
  );

  let weekDays = 0;
  for (const group of dateGroups) {
    if (group.date >= weekStart && group.date <= weekEnd) {
      weekDays += 1;
    }
  }

  return {
    totalDays: dateGroups.length,
    weekDays,
    totalLogs: logs.length,
  };
}

/**
 * 產生訓練部位標籤清單 HTML
 * @param {Array<string>} bodyParts
 * @param {(v: unknown) => string} esc
 * @returns {string}
 */
function renderPartTags(bodyParts, esc) {
  if (!Array.isArray(bodyParts) || bodyParts.length === 0) return '';
  const items = bodyParts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean);
  if (items.length === 0) return '';
  return `<span class="row" style="gap:4px;flex-wrap:wrap">${items
    .map((part) => `<span class="tag">${esc(part)}</span>`)
    .join('')}</span>`;
}

/**
 * 產生單筆備註 HTML（無備註時回傳空字串）
 * @param {string} note
 * @param {(v: unknown) => string} esc
 * @returns {string}
 */
function renderNote(note, esc) {
  const text = typeof note === 'string' ? note.trim() : '';
  if (!text) return '';
  return `<div class="muted" style="font-size:12px">備註：${esc(text)}</div>`;
}

/**
 * 產生空狀態區塊 HTML
 * @param {(v: unknown) => string} esc
 * @returns {string}
 */
function renderEmptyState(esc) {
  return `<div class="card empty-state">${esc(EMPTY_MESSAGE)}</div>`;
}

/**
 * 產生頂部分段切換列 HTML
 * @param {'date' | 'equipment' | 'part'} activeView
 * @param {(v: unknown) => string} esc
 * @returns {string}
 */
function renderSegmentBar(activeView, esc) {
  const buttons = VIEW_TABS.map((tab) => {
    const isActive = tab.key === activeView;
    const activeCls = isActive ? ' active' : '';
    return `<button type="button" role="tab" class="${activeCls.trim()}" data-history-view="${esc(tab.key)}" aria-selected="${isActive ? 'true' : 'false'}">${esc(tab.label)}</button>`;
  }).join('');
  return `<div class="seg" role="tablist" aria-label="歷史紀錄檢視方式">${buttons}</div>`;
}

/**
 * 產生頂部簡易統計列 HTML（總訓練天數、本週天數、總筆數）
 * @param {{ totalDays: number, weekDays: number, totalLogs: number }} stats
 * @returns {string}
 */
function renderStatsBar(stats) {
  return `
    <div class="card" aria-label="訓練統計" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;text-align:center;padding:12px 8px">
      <div>
        <div style="font-size:20px;font-weight:700;color:var(--primary);font-variant-numeric:tabular-nums">${stats.totalDays}</div>
        <div class="muted" style="font-size:12px">總訓練天數</div>
      </div>
      <div>
        <div style="font-size:20px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums">${stats.weekDays}</div>
        <div class="muted" style="font-size:12px">本週天數</div>
      </div>
      <div>
        <div style="font-size:20px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums">${stats.totalLogs}</div>
        <div class="muted" style="font-size:12px">總筆數</div>
      </div>
    </div>`;
}

/**
 * 依日期檢視：每天一張 .card，內含各筆 .log-item
 * @param {Array<{ date: string, logs: Array<object> }>} dateGroups
 * @param {(v: unknown) => string} esc
 * @returns {string}
 */
function renderByDate(dateGroups, esc) {
  if (dateGroups.length === 0) {
    return renderEmptyState(esc);
  }

  return dateGroups
    .map((group) => {
      const dateLabel = formatDateLabel(group.date);
      const itemsHtml = group.logs
        .map((log) => {
          const equipName = log.equipmentName || '未命名器材';
          const summary = formatLogSummary(log);
          return `
            <button type="button" class="log-item" data-edit-log-id="${esc(log.id)}">
              <div class="row-between" style="width:100%;flex-wrap:wrap">
                <span style="font-weight:700;font-size:15px">${esc(equipName)}</span>
                ${renderPartTags(log.bodyParts, esc)}
              </div>
              <div class="card-sub" style="margin-top:0;color:var(--text-secondary)">${esc(summary)}</div>
              ${renderNote(log.note, esc)}
            </button>`;
        })
        .join('');

      return `
        <section class="card stack">
          <div class="row-between">
            <h2 class="card-title">${esc(dateLabel)}</h2>
            <span class="muted">${group.logs.length} 項器材</span>
          </div>
          <div class="stack" style="gap:8px">${itemsHtml}</div>
          <button type="button" class="btn btn-ghost btn-block" data-action="share-day" data-date="${esc(group.date)}">📤 分享今日訓練</button>
        </section>`;
    })
    .join('');
}

/**
 * 依器材檢視：每個器材一個 <details class="card">，展開顯示各筆紀錄與每組明細
 * @param {Array<object>} logs
 * @param {Array<object>} equipment
 * @param {(v: unknown) => string} esc
 * @returns {string}
 */
function renderByEquipment(logs, equipment, esc) {
  const groups = groupByEquipment(logs, equipment);
  if (groups.length === 0) {
    return renderEmptyState(esc);
  }

  const emptyBanner = logs.length === 0 ? renderEmptyState(esc) : '';

  const cardsHtml = groups
    .map((group) => {
      const equipName = group.name || '未命名器材';
      const metaText =
        group.count > 0
          ? `${group.count} 次 · 最近 ${esc(formatDateLabel(group.lastDate))}`
          : '尚無紀錄';

      let bodyHtml;
      if (group.count === 0) {
        bodyHtml =
          '<div class="muted" style="text-align:center;padding:8px 0">尚無紀錄</div>';
      } else {
        bodyHtml = group.logs
          .map((log) => {
            const dateLabel = formatDateLabel(log.date);
            const summary = formatLogSummary(log);
            const sets = Array.isArray(log.sets) ? log.sets : [];
            const setsHtml =
              sets.length > 0
                ? `<div class="stack" style="gap:2px;width:100%;margin-top:4px;padding-top:6px;border-top:1px solid var(--border)">${sets
                    .map((set, idx) => {
                      const detail = formatSet(set, log.fields, log.trackReps);
                      return `<div class="muted" style="font-size:13px">第 ${idx + 1} 組：${esc(detail || '—')}</div>`;
                    })
                    .join('')}</div>`
                : '';

            return `
              <button type="button" class="log-item" data-edit-log-id="${esc(log.id)}">
                <div class="row-between" style="width:100%">
                  <span style="font-weight:700;font-size:15px">${esc(dateLabel)}</span>
                  <span class="muted" style="font-size:12px">編輯</span>
                </div>
                <div class="card-sub" style="margin-top:0;color:var(--text-secondary)">${esc(summary)}</div>
                ${setsHtml}
                ${renderNote(log.note, esc)}
              </button>`;
          })
          .join('');
      }

      return `
        <details class="card" style="padding:0">
          <summary>
            <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">
              <div class="row" style="flex-wrap:wrap;gap:6px">
                <span class="card-title" style="font-size:16px">${esc(equipName)}</span>
                ${renderPartTags(group.bodyParts, esc)}
              </div>
              <div class="card-sub" style="margin-top:0">${metaText}</div>
            </div>
          </summary>
          <div class="stack" style="gap:8px">${bodyHtml}</div>
        </details>`;
    })
    .join('');

  return `${emptyBanner}${cardsHtml}`;
}

/**
 * 依部位檢視：每個部位一個 <details class="card">，展開後依日期分組列出器材名與摘要
 * @param {Array<object>} logs
 * @param {(v: unknown) => string} esc
 * @returns {string}
 */
function renderByBodyPart(logs, esc) {
  const groups = groupByBodyPart(logs);
  if (groups.length === 0) {
    return renderEmptyState(esc);
  }

  return groups
    .map((group) => {
      const dateGroups = groupByDate(group.logs);
      const bodyHtml = dateGroups
        .map((dateGroup) => {
          const dateLabel = formatDateLabel(dateGroup.date);
          const itemsHtml = dateGroup.logs
            .map((log) => {
              const equipName = log.equipmentName || '未命名器材';
              const summary = formatLogSummary(log);
              return `
                <button type="button" class="log-item" data-edit-log-id="${esc(log.id)}">
                  <span style="font-weight:700;font-size:15px">${esc(equipName)}</span>
                  <span class="card-sub" style="margin-top:0;color:var(--text-secondary)">${esc(summary)}</span>
                  ${renderNote(log.note, esc)}
                </button>`;
            })
            .join('');

          return `
            <div class="stack" style="gap:6px">
              <div class="section-title" style="margin:0">${esc(dateLabel)}</div>
              ${itemsHtml}
            </div>`;
        })
        .join('');

      return `
        <details class="card" style="padding:0">
          <summary>
            <span style="flex:1;min-width:0"><span class="card-title" style="font-size:16px">${esc(group.part)}</span><span class="muted"> · ${group.count} 筆 · ${group.days} 天</span></span>
          </summary>
          <div class="stack" style="gap:10px">${bodyHtml}</div>
        </details>`;
    })
    .join('');
}

/**
 * 繪製歷史紀錄分頁（依日期｜依器材｜依部位）
 * @param {HTMLElement} container 分頁容器（#tab-history）
 * @param {object} ctx 共用應用程式上下文
 */
export function renderHistory(container, ctx) {
  if (!container) return;

  const esc = getEscaper(ctx);
  if (!ctx.view || typeof ctx.view !== 'object') {
    ctx.view = {};
  }

  // 取得並正規化目前檢視模式，預設為 'date'
  const activeView = VALID_VIEWS.has(ctx.view.historyView)
    ? ctx.view.historyView
    : 'date';
  ctx.view.historyView = activeView;

  const logs = Array.isArray(ctx?.data?.logs) ? ctx.data.logs : [];
  const equipment = Array.isArray(ctx?.data?.equipment)
    ? ctx.data.equipment
    : [];

  const dateGroups = groupByDate(logs);
  const stats = calcHistoryStats(logs, dateGroups);

  let contentHtml = '';
  if (activeView === 'equipment') {
    contentHtml = renderByEquipment(logs, equipment, esc);
  } else if (activeView === 'part') {
    contentHtml = renderByBodyPart(logs, esc);
  } else {
    contentHtml = renderByDate(dateGroups, esc);
  }

  // 每次渲染以全新根節點替換容器內容，避免重複綁定事件監聽器
  const root = document.createElement('div');
  root.className = 'stack';
  root.innerHTML = `
    ${renderSegmentBar(activeView, esc)}
    ${renderStatsBar(stats)}
    ${contentHtml}`;

  // 事件委派：處理分段切換、分享今日訓練與點擊紀錄跳轉編輯
  root.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const shareBtn = target.closest('button[data-action="share-day"]');
    if (shareBtn) {
      event.stopPropagation();
      const date = shareBtn.getAttribute('data-date');
      if (date) {
        openSharePreview(ctx, date).catch((e) =>
          ctx.toast('產生圖片失敗：' + e.message)
        );
      }
      return;
    }

    const segBtn = target.closest('.seg > button[data-history-view]');
    if (segBtn) {
      const nextView = segBtn.getAttribute('data-history-view');
      if (nextView && VALID_VIEWS.has(nextView) && nextView !== activeView) {
        ctx.view.historyView = nextView;
        if (typeof ctx.rerender === 'function') {
          ctx.rerender();
        }
      }
      return;
    }

    const logBtn = target.closest('.log-item[data-edit-log-id]');
    if (logBtn) {
      const editLogId = logBtn.getAttribute('data-edit-log-id');
      if (editLogId && typeof ctx.go === 'function') {
        ctx.go('record', { editLogId });
      }
    }
  });

  container.replaceChildren(root);
}
