/**
 * 健身記錄 PWA 月曆頁模組
 * 顯示每月訓練日曆、本月訓練天數，以及所選日期的訓練紀錄、快速新增與分享功能。
 */

import {
  buildMonthGrid,
  formatDateLabel,
  formatLogSummary,
  shiftMonth,
  toDateStr,
} from './logic.js';
import { openSharePreview } from './share.js';

/** 週一至週日的表頭文字 */
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

/** 記錄已綁定委派事件的容器與最新 ctx，避免重複綁定與閉包過期 */
const boundContainers = new WeakMap();

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
 * 檢查是否為合法的 'YYYY-MM-DD' 日期字串
 * @param {unknown} str
 * @returns {boolean}
 */
function isValidDateStr(str) {
  return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str);
}

/**
 * 將年份與月份格式化為 'YYYY-MM'
 * @param {number} year
 * @param {number} month 1~12
 * @returns {string}
 */
function formatYearMonth(year, month) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/**
 * 解析 'YYYY-MM' 字串為 { year, month }；格式不符時退回指定日期所在年月
 * @param {unknown} ymStr
 * @param {string} fallbackDateStr
 * @returns {{ year: number, month: number }}
 */
function parseYearMonth(ymStr, fallbackDateStr) {
  if (typeof ymStr === 'string') {
    const match = /^(\d{4})-(\d{2})$/.exec(ymStr.trim());
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      if (month >= 1 && month <= 12) {
        return { year, month };
      }
    }
  }
  const fallbackMatch = /^(\d{4})-(\d{2})/.exec(fallbackDateStr);
  if (fallbackMatch) {
    return {
      year: Number(fallbackMatch[1]),
      month: Number(fallbackMatch[2]),
    };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/**
 * 產生訓練部位標籤 HTML
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
 * 產生單日圓點標記 HTML（count >= 3 顯示兩個圓點，1~2 顯示一個圓點）
 * @param {number} count
 * @returns {string}
 */
function renderCellDots(count) {
  if (count >= 3) {
    return '<span class="cal-dots" aria-hidden="true"><span class="cal-dot"></span><span class="cal-dot"></span></span>';
  }
  if (count > 0) {
    return '<span class="cal-dots" aria-hidden="true"><span class="cal-dot"></span></span>';
  }
  return '<span class="cal-dots" aria-hidden="true"></span>';
}

/**
 * 處理月曆分頁的委派點擊事件
 * @param {MouseEvent} event
 * @param {object} ctx
 */
function handleCalendarClick(event, ctx) {
  const target = event.target;
  if (!(target instanceof Element) || !ctx) return;

  if (!ctx.view || typeof ctx.view !== 'object') {
    ctx.view = {};
  }

  // 切換上一個月／下一個月
  const monthNavBtn = target.closest(
    'button[data-action="prev-month"], button[data-action="next-month"]'
  );
  if (monthNavBtn) {
    const delta = monthNavBtn.getAttribute('data-action') === 'prev-month' ? -1 : 1;
    const { year, month } = parseYearMonth(ctx.view.calMonth, toDateStr());
    const next = shiftMonth(year, month, delta);
    ctx.view.calMonth = formatYearMonth(next.year, next.month);
    if (typeof ctx.rerender === 'function') {
      ctx.rerender();
    }
    return;
  }

  // 回到今天
  const todayBtn = target.closest('button[data-action="goto-today"]');
  if (todayBtn) {
    const todayStr = toDateStr();
    ctx.view.calMonth = todayStr.slice(0, 7);
    ctx.view.calSelected = todayStr;
    if (typeof ctx.rerender === 'function') {
      ctx.rerender();
    }
    return;
  }

  // 點擊日曆格子選取日期
  const cellBtn = target.closest('button.cal-cell[data-cal-date]');
  if (cellBtn) {
    const date = cellBtn.getAttribute('data-cal-date');
    if (isValidDateStr(date)) {
      ctx.view.calSelected = date;
      ctx.view.calMonth = date.slice(0, 7);
      if (typeof ctx.rerender === 'function') {
        ctx.rerender();
      }
    }
    return;
  }

  // 點擊該日訓練紀錄跳轉至記錄頁編輯
  const logBtn = target.closest('.log-item[data-edit-log-id]');
  if (logBtn) {
    const editLogId = logBtn.getAttribute('data-edit-log-id');
    if (editLogId && typeof ctx.go === 'function') {
      ctx.go('record', { editLogId });
    }
    return;
  }

  // 在這天新增紀錄
  const addBtn = target.closest('button[data-action="add-log"]');
  if (addBtn) {
    const date = addBtn.getAttribute('data-date') || ctx.view.calSelected || toDateStr();
    if (typeof ctx.go === 'function') {
      ctx.go('record', { date });
    }
    return;
  }

  // 分享這天訓練圖片
  const shareBtn = target.closest('button[data-action="share-day"]');
  if (shareBtn) {
    const date = shareBtn.getAttribute('data-date') || ctx.view.calSelected;
    if (date) {
      openSharePreview(ctx, date).catch((err) => {
        if (typeof ctx.toast === 'function') {
          ctx.toast('產生圖片失敗：' + (err?.message || err));
        }
      });
    }
  }
}

/**
 * 繪製月曆分頁（#tab-calendar）
 * @param {HTMLElement} container 分頁容器（#tab-calendar）
 * @param {object} ctx 共用應用程式上下文
 */
export function renderCalendar(container, ctx) {
  if (!container) return;

  // 在 container 上綁定單次事件委派，並更新最新 ctx 參照
  let boundState = boundContainers.get(container);
  if (!boundState) {
    boundState = { ctx };
    boundContainers.set(container, boundState);
    container.addEventListener('click', (event) => {
      handleCalendarClick(event, boundState.ctx);
    });
  } else {
    boundState.ctx = ctx;
  }

  const esc = getEscaper(ctx);
  if (!ctx.view || typeof ctx.view !== 'object') {
    ctx.view = {};
  }

  const todayStr = toDateStr();
  const { year, month } = parseYearMonth(ctx.view.calMonth, todayStr);
  ctx.view.calMonth = formatYearMonth(year, month);

  const selectedDate = isValidDateStr(ctx.view.calSelected)
    ? ctx.view.calSelected
    : todayStr;
  ctx.view.calSelected = selectedDate;

  const logs = Array.isArray(ctx?.data?.logs) ? ctx.data.logs : [];
  const grid = buildMonthGrid(year, month, logs, todayStr);
  const weeks = Array.isArray(grid?.weeks) ? grid.weeks : [];
  const monthLabel = grid?.label || `${year} 年 ${month} 月`;

  // 計算本月有訓練的天數
  let monthTrainDays = 0;
  for (const week of weeks) {
    if (!Array.isArray(week)) continue;
    for (const cell of week) {
      if (cell && cell.inMonth && cell.count > 0) {
        monthTrainDays += 1;
      }
    }
  }

  const weekdayHeaderHtml = WEEKDAY_LABELS.map(
    (label) => `<div class="cal-weekday">${esc(label)}</div>`
  ).join('');

  const cellsHtml = weeks
    .flat()
    .map((cell) => {
      if (!cell) return '';
      const isSelected = cell.date === selectedDate;
      const classes = ['cal-cell'];
      if (!cell.inMonth) classes.push('out');
      if (cell.isToday) classes.push('today');
      if (cell.count > 0) classes.push('has-log');
      if (isSelected) classes.push('selected');

      const ariaParts = [cell.date];
      if (cell.isToday) ariaParts.push('今天');
      if (cell.count > 0) ariaParts.push(`${cell.count} 筆紀錄`);

      return `
        <button
          type="button"
          class="${classes.join(' ')}"
          data-cal-date="${esc(cell.date)}"
          aria-label="${esc(ariaParts.join('，'))}"
          aria-pressed="${isSelected ? 'true' : 'false'}"
        >
          <span class="cal-day">${esc(cell.day)}</span>
          ${renderCellDots(cell.count || 0)}
        </button>`;
    })
    .join('');

  // 取得所選日期的訓練紀錄（依建立時間由舊到新排序）
  const dayLogs = logs
    .filter((log) => log && log.date === selectedDate)
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

  const selectedLabel = formatDateLabel(selectedDate);
  const dayItemsHtml =
    dayLogs.length > 0
      ? dayLogs
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
          .join('')
      : '<div class="muted" style="text-align:center;padding:12px 0">這天還沒有訓練紀錄</div>';

  const shareBtnHtml =
    dayLogs.length > 0
      ? `<button type="button" class="btn btn-ghost btn-block" data-action="share-day" data-date="${esc(selectedDate)}">📤 分享這天訓練</button>`
      : '';

  container.innerHTML = `
    <div class="stack">
      <section class="card stack" aria-label="訓練月曆">
        <div class="cal-head">
          <button type="button" class="btn btn-ghost btn-icon" data-action="prev-month" aria-label="上個月">‹</button>
          <div class="cal-title">${esc(monthLabel)}</div>
          <button type="button" class="btn btn-ghost btn-icon" data-action="next-month" aria-label="下個月">›</button>
          <button type="button" class="btn btn-ghost cal-today-btn" data-action="goto-today">今天</button>
        </div>
        <div class="cal-weekdays" aria-hidden="true">${weekdayHeaderHtml}</div>
        <div class="cal-grid" role="grid" aria-label="${esc(monthLabel)}">${cellsHtml}</div>
        <div class="cal-summary muted">本月 ${monthTrainDays} 天有訓練</div>
      </section>

      <section class="card stack" aria-label="當日訓練紀錄">
        <div class="row-between">
          <h2 class="card-title">${esc(selectedLabel)}</h2>
          <span class="muted">${dayLogs.length > 0 ? `${dayLogs.length} 項器材` : '尚無紀錄'}</span>
        </div>
        <div class="stack" style="gap:8px">${dayItemsHtml}</div>
        <div class="stack" style="gap:8px">
          <button type="button" class="btn btn-primary btn-block" data-action="add-log" data-date="${esc(selectedDate)}">在這天新增紀錄</button>
          ${shareBtnHtml}
        </div>
      </section>
    </div>`;
}
