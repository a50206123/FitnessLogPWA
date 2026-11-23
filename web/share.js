/**
 * 健身記錄 PWA 分享圖片模組（v3：1080×1080 正方形，自動緊湊與多頁分頁）
 * 負責依 planSharePages 回傳的座標使用 Canvas 2D 繪製當日訓練分享圖，
 * 並於全螢幕面板顯示多頁橫向滑動預覽、系統分享與逐張下載。
 * 注意：本模組在載入階段不接觸 DOM，僅在函式呼叫時使用瀏覽器 API，確保可在無 DOM 環境匯入測試。
 */

import {
  summarizeDay,
  formatNumber,
  formatSet,
  formatDateLabel,
  SHARE_METRICS,
  compactSetText,
  planSharePages,
} from './logic.js';

/** 圖片字型設定 */
const FONT_FAMILY = "'PingFang TC', 'Noto Sans TC', 'Microsoft JhengHei', sans-serif";

/** 圖片配色常數 */
const COLORS = Object.freeze({
  bgTop: '#0f172a',
  bgBottom: '#111827',
  accent: '#22c55e',
  accentSoft: 'rgba(34, 197, 94, 0.16)',
  accentBorder: 'rgba(34, 197, 94, 0.45)',
  accentText: '#4ade80',
  accentSubtle: 'rgba(74, 222, 128, 0.85)',
  accentGlow: 'rgba(34, 197, 94, 0.14)',
  accentDarkText: '#052e16',
  cardBg: 'rgba(255, 255, 255, 0.065)',
  cardBorder: 'rgba(255, 255, 255, 0.12)',
  divider: 'rgba(255, 255, 255, 0.09)',
  textPrimary: '#f8fafc',
  textBody: '#f1f5f9',
  textSecondary: '#cbd5e1',
  textMuted: '#94a3b8',
  textFaint: 'rgba(255, 255, 255, 0.45)',
});

/** 重量單位集合（用於 normal 模式計算單組訓練量小計） */
const WEIGHT_UNITS = new Set(['kg', 'lb']);

/** 逐張下載之間的間隔毫秒數 */
const DOWNLOAD_INTERVAL_MS = 300;

/** 記錄前一次預覽產生的 Object URL 清單，於重新開啟預覽時統一釋放記憶體 */
let lastPreviewObjectUrls = [];

/**
 * 組合 Canvas 字型字串
 * @param {number} size 字級（px）
 * @param {number | string} [weight=400] 字重
 * @returns {string}
 */
function makeFont(size, weight = 400) {
  return `${weight} ${size}px ${FONT_FAMILY}`;
}

/**
 * 安全量測文字寬度
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @returns {number}
 */
function measureWidth(ctx, text) {
  if (!text) return 0;
  return ctx.measureText(text)?.width ?? 0;
}

/**
 * 將值轉為有限正數；無法解析或非正數則回傳 null
 * @param {unknown} val
 * @returns {number | null}
 */
function toPositiveNumber(val) {
  if (val === '' || val === null || val === undefined) return null;
  const num = Number(val);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/**
 * 手動繪製圓角矩形路徑（不依賴 ctx.roundRect，確保跨環境相容）
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r 圓角半徑
 */
function drawRoundedRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * 繪製填滿與可選描邊的圓角矩形
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 * @param {string | null} fillStyle
 * @param {string | null} [strokeStyle=null]
 * @param {number} [lineWidth=1]
 */
function drawRoundedRect(ctx, x, y, w, h, r, fillStyle, strokeStyle = null, lineWidth = 1) {
  drawRoundedRectPath(ctx, x, y, w, h, r);
  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

/**
 * 繪製水平分隔線
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x1
 * @param {number} x2
 * @param {number} y
 * @param {string} [color=COLORS.divider]
 */
function drawHorizontalLine(ctx, x1, x2, y, color = COLORS.divider) {
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/**
 * 繪製垂直分隔線
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y1
 * @param {number} y2
 * @param {string} [color=COLORS.divider]
 */
function drawVerticalLine(ctx, x, y1, y2, color = COLORS.divider) {
  ctx.beginPath();
  ctx.moveTo(x, y1);
  ctx.lineTo(x, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/**
 * 逐字量測並以「…」截斷超出最大寬度的單行文字（支援中文與 emoji 代理對）
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string}
 */
function truncateText(ctx, text, maxWidth) {
  const str = String(text ?? '');
  if (!str) return '';
  const limit = Math.max(0, maxWidth);
  if (limit <= 0) return '';
  if (measureWidth(ctx, str) <= limit) return str;

  const ellipsis = '…';
  if (measureWidth(ctx, ellipsis) > limit) return '';

  let result = '';
  for (const ch of Array.from(str)) {
    const candidate = result + ch;
    if (measureWidth(ctx, candidate + ellipsis) > limit) {
      break;
    }
    result = candidate;
  }
  return result + ellipsis;
}

/**
 * 依最大寬度逐字量測並自動換行（支援中文、emoji 代理對與手動換行符號）
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string[]}
 */
function wrapText(ctx, text, maxWidth) {
  const raw = String(text ?? '');
  if (!raw) return [];
  const limit = Math.max(1, maxWidth);
  const paragraphs = raw.split(/\r?\n/);
  const lines = [];

  for (const para of paragraphs) {
    if (para === '') {
      lines.push('');
      continue;
    }
    let current = '';
    for (const ch of Array.from(para)) {
      const candidate = current + ch;
      if (current && measureWidth(ctx, candidate) > limit) {
        lines.push(current);
        current = ch;
      } else {
        current = candidate;
      }
    }
    if (current) {
      lines.push(current);
    }
  }

  return lines;
}

/**
 * 逐字換行並限制最多 maxLines 行，超出部分於最後一行結尾加上「…」
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidth
 * @param {number} maxLines
 * @returns {string[]}
 */
function wrapTextClamped(ctx, text, maxWidth, maxLines) {
  if (maxLines <= 0) return [];
  const normalized = String(text ?? '').replace(/\r?\n+/g, ' ').trim();
  if (!normalized) return [];

  if (maxLines === 1) {
    return [truncateText(ctx, normalized, maxWidth)];
  }

  const lines = wrapText(ctx, normalized, maxWidth);
  if (lines.length <= maxLines) {
    return lines;
  }

  const clamped = lines.slice(0, maxLines - 1);
  const rest = lines.slice(maxLines - 1).join('');
  clamped.push(truncateText(ctx, rest, maxWidth));
  return clamped;
}

/**
 * 解析日期顯示文字：主要標籤「M/D（週）」與年份「YYYY」
 * @param {string} dateStr 本地日期字串 'YYYY-MM-DD'
 * @returns {{ mainLabel: string, yearLabel: string }}
 */
function parseDateParts(dateStr) {
  const rawDate = typeof dateStr === 'string' ? dateStr.trim() : '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawDate);
  const yearLabel = match ? match[1] : '';
  const formatted = rawDate ? formatDateLabel(rawDate) : '';

  // 若 formatDateLabel 已包含年份前綴（非今年），移除前綴避免與年份重複顯示
  let mainLabel = formatted;
  if (yearLabel && mainLabel.startsWith(`${yearLabel}/`)) {
    mainLabel = mainLabel.slice(yearLabel.length + 1);
  }

  return {
    mainLabel: mainLabel || rawDate || '今日訓練',
    yearLabel,
  };
}

/**
 * 計算單組小計文字（有重量欄位且記錄次數時，回傳如 '480 kg'）
 * @param {object} set
 * @param {Array<{ key: string, unit?: string }>} fields
 * @param {boolean} trackReps
 * @returns {string}
 */
function formatSetSubtotal(set, fields, trackReps) {
  if (!trackReps || !set || typeof set !== 'object') return '';
  const reps = toPositiveNumber(set.reps);
  if (reps === null) return '';

  const fieldList = Array.isArray(fields) ? fields : [];
  const weightField = fieldList.find((f) =>
    WEIGHT_UNITS.has(String(f?.unit ?? '').trim().toLowerCase())
  );
  if (!weightField || !weightField.key) return '';

  const values = set.values && typeof set.values === 'object' ? set.values : {};
  const weight = toPositiveNumber(values[weightField.key]);
  if (weight === null) return '';

  const subtotal = Math.round(weight * reps * 10) / 10;
  const unit = String(weightField.unit ?? '').trim();
  return `${formatNumber(subtotal)} ${unit}`;
}

/**
 * 取得 compact 模式單一欄位器材的標題單位提示（如「kg × 下」）
 * @param {Array<{ name?: string, unit?: string }>} fields
 * @param {boolean} trackReps
 * @returns {string}
 */
function buildCompactUnitHint(fields, trackReps) {
  if (!Array.isArray(fields) || fields.length !== 1) return '';
  const unit = String(fields[0]?.unit ?? '').trim();
  const name = String(fields[0]?.name ?? '').trim();
  const label = unit || name;

  if (trackReps) {
    return label ? `${label} × 下` : '下';
  }
  return label;
}

/**
 * 整理有氧加總列文字（如「時間 40 分 · 距離 5 km」）
 * @param {Array<{ name?: string, unit?: string, total?: number }>} cardioList
 * @returns {string}
 */
function formatCardioSummary(cardioList) {
  if (!Array.isArray(cardioList) || cardioList.length === 0) return '';
  return cardioList
    .map((item) => {
      if (!item) return '';
      const name = String(item.name ?? '').trim();
      const unit = String(item.unit ?? '').trim();
      const totalStr = formatNumber(item.total ?? 0);
      return [name, totalStr, unit].filter(Boolean).join(' ');
    })
    .filter(Boolean)
    .join(' · ');
}

/**
 * 繪製整體背景（深色垂直漸層、微光點綴與頂部細強調條）
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 */
function drawBackground(ctx, width, height) {
  if (typeof ctx.createLinearGradient === 'function') {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, COLORS.bgTop);
    grad.addColorStop(1, COLORS.bgBottom);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = COLORS.bgTop;
  }
  ctx.fillRect(0, 0, width, height);

  // 右上角微弱綠光氛圍
  if (typeof ctx.createRadialGradient === 'function') {
    const glow = ctx.createRadialGradient(
      width * 0.88,
      100,
      20,
      width * 0.88,
      100,
      440
    );
    glow.addColorStop(0, COLORS.accentGlow);
    glow.addColorStop(1, 'rgba(34, 197, 94, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, Math.min(height, 600));
  }

  // 頂部細強調光條
  if (typeof ctx.createLinearGradient === 'function') {
    const barGrad = ctx.createLinearGradient(0, 0, width, 0);
    barGrad.addColorStop(0, COLORS.accent);
    barGrad.addColorStop(0.65, 'rgba(34, 197, 94, 0.55)');
    barGrad.addColorStop(1, 'rgba(34, 197, 94, 0.12)');
    ctx.fillStyle = barGrad;
  } else {
    ctx.fillStyle = COLORS.accent;
  }
  ctx.fillRect(0, 0, width, 6);
}

/**
 * 繪製右上角分頁膠囊（例如「1/2」），回傳膠囊寬度
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} pageNo 目前頁碼
 * @param {number} total 總頁數
 * @param {number} rightX 膠囊右緣 X 座標
 * @param {number} y 膠囊上緣 Y 座標
 * @returns {number} 膠囊寬度
 */
function drawPageBadge(ctx, pageNo, total, rightX, y) {
  const label = `${pageNo}/${total}`;
  const pillH = 38;
  const padX = 18;
  ctx.font = makeFont(22, 700);
  const textW = measureWidth(ctx, label);
  const pillW = Math.max(66, Math.ceil(textW + padX * 2));
  const pillX = rightX - pillW;

  drawRoundedRect(
    ctx,
    pillX,
    y,
    pillW,
    pillH,
    pillH / 2,
    COLORS.accentSoft,
    COLORS.accentBorder,
    1.5
  );

  ctx.font = makeFont(22, 700);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.accentText;
  ctx.fillText(label, pillX + pillW / 2, y + pillH / 2 + 1);

  return pillW;
}

/**
 * 繪製訓練部位圓角標籤列（自動換行，對齊 SHARE_METRICS.tagRowH）
 * @param {CanvasRenderingContext2D} ctx
 * @param {string[]} bodyParts
 * @param {number} x
 * @param {number} y
 * @param {number} maxWidth
 * @param {number} maxBottomY 標籤區塊不可超出的下緣 Y 座標
 * @param {typeof SHARE_METRICS} metrics
 */
function drawBodyPartTags(ctx, bodyParts, x, y, maxWidth, maxBottomY, metrics) {
  const parts = Array.isArray(bodyParts)
    ? bodyParts.map((p) => String(p ?? '').trim()).filter(Boolean)
    : [];
  if (parts.length === 0) return;

  const fontSize = 25;
  const padX = 20;
  const tagH = 40;
  const tagRadius = tagH / 2;
  const gapX = metrics.tagGap;
  const rowPitch = metrics.tagRowH;

  ctx.font = makeFont(fontSize, 600);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  let curX = x;
  let curY = y;

  for (const part of parts) {
    const rawW = measureWidth(ctx, part) + padX * 2;
    const tagW = Math.min(maxWidth, rawW);

    if (curX > x && curX + tagW > x + maxWidth) {
      curX = x;
      curY += rowPitch;
    }

    // 安全防呆：不超出摘要卡上緣
    if (curY + tagH > maxBottomY + 4) {
      break;
    }

    const displayPart = truncateText(ctx, part, tagW - padX * 2);
    drawRoundedRect(
      ctx,
      curX,
      curY,
      tagW,
      tagH,
      tagRadius,
      COLORS.accentSoft,
      COLORS.accentBorder,
      1.5
    );
    ctx.fillStyle = COLORS.accentText;
    ctx.fillText(displayPart, curX + padX, curY + tagH / 2 + 1);

    curX += tagW + gapX;
  }
}

/**
 * 在總結數據格內繪製數值與單位（過寬時自動縮小字級避免溢出）
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} valueText
 * @param {string} unitText
 * @param {number} x
 * @param {number} baselineY
 * @param {number} maxWidth
 * @param {string} valueColor
 * @param {string} unitColor
 */
function drawMetricValue(ctx, valueText, unitText, x, baselineY, maxWidth, valueColor, unitColor) {
  let valueSize = 40;
  const unitSize = 22;
  const unitGap = 6;

  // 若數值過長，依格子可用寬度微調字級避免溢出
  while (valueSize > 24) {
    ctx.font = makeFont(valueSize, 800);
    const valW = measureWidth(ctx, valueText);
    ctx.font = makeFont(unitSize, 600);
    const unitW = measureWidth(ctx, unitText);
    if (valW + unitGap + unitW <= maxWidth) break;
    valueSize -= 2;
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // 單位寬度要用單位字型量測，否則會高估而把數值誤截成「…」
  ctx.font = makeFont(unitSize, 600);
  const unitWidth = measureWidth(ctx, unitText);
  ctx.font = makeFont(valueSize, 800);
  const safeValue = truncateText(
    ctx,
    valueText,
    Math.max(40, maxWidth - unitWidth - unitGap)
  );
  ctx.fillStyle = valueColor;
  ctx.fillText(safeValue, x, baselineY);
  const valW = measureWidth(ctx, safeValue);

  ctx.font = makeFont(unitSize, 600);
  ctx.fillStyle = unitColor;
  ctx.fillText(unitText, x + valW + unitGap, baselineY - 1);
}

/**
 * 繪製第 1 張的 4 格一列總結數據卡片（含選填有氧加總列）
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} summary
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {typeof SHARE_METRICS} metrics
 */
function drawSummaryCard(ctx, summary, x, y, w, h, metrics) {
  const statsH = metrics.statsH;
  const cardioH = metrics.cardioH;
  const cardioText = formatCardioSummary(summary?.cardio);
  const hasCardio = Boolean(cardioText);

  drawRoundedRect(ctx, x, y, w, h, 22, COLORS.cardBg, COLORS.cardBorder, 1.5);

  const colW = w / 4;
  const cellPadX = 20;

  // 四格垂直細分隔線
  for (let i = 1; i < 4; i++) {
    const divX = x + colW * i;
    drawVerticalLine(ctx, divX, y + 20, y + statsH - 20, COLORS.divider);
  }

  const statItems = [
    {
      label: '器材數',
      value: formatNumber(summary?.equipmentCount ?? 0),
      unit: '項',
      highlight: false,
    },
    {
      label: '總組數',
      value: formatNumber(summary?.totalSets ?? 0),
      unit: '組',
      highlight: false,
    },
    {
      label: '總次數',
      value: formatNumber(summary?.totalReps ?? 0),
      unit: '下',
      highlight: false,
    },
    {
      label: '總訓練量',
      value: formatNumber(summary?.totalVolumeKg ?? 0),
      unit: 'kg',
      highlight: true,
    },
  ];

  for (let i = 0; i < statItems.length; i++) {
    const item = statItems[i];
    const cellX = x + colW * i + cellPadX;
    const maxCellW = colW - cellPadX * 2;

    ctx.font = makeFont(22, 500);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = COLORS.textMuted;
    ctx.fillText(item.label, cellX, y + 20);

    drawMetricValue(
      ctx,
      item.value,
      item.unit,
      cellX,
      y + statsH - 24,
      maxCellW,
      item.highlight ? COLORS.accentText : COLORS.textPrimary,
      item.highlight ? COLORS.accentSubtle : COLORS.textSecondary
    );
  }

  // 有氧加總列（依 metrics.cardioH 高度單列顯示，過長時以「…」截斷）
  if (hasCardio) {
    const dividerY = y + statsH;
    drawHorizontalLine(ctx, x + cellPadX, x + w - cellPadX, dividerY, COLORS.divider);

    const rowCy = dividerY + cardioH / 2;
    ctx.beginPath();
    ctx.arc(x + cellPadX + 6, rowCy, 5, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.accent;
    ctx.fill();

    ctx.font = makeFont(24, 600);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.textBody;
    const textX = x + cellPadX + 22;
    const maxTextW = w - cellPadX * 2 - 22;
    ctx.fillText(truncateText(ctx, cardioText, maxTextW), textX, rowCy + 1);
  }
}

/**
 * 繪製第 1 張頁首（日期大字＋年份、部位標籤、總結 4 格一列＋有氧加總列，多張時右上標頁碼膠囊）
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} summary
 * @param {object} page planSharePages 回傳的單頁配置
 * @param {typeof SHARE_METRICS} metrics
 */
function drawFirstPageHeader(ctx, summary, page, metrics) {
  const pad = metrics.pad;
  const contentW = metrics.size - pad * 2;
  const { mainLabel, yearLabel } = parseDateParts(summary?.date || '');

  // 1. 頂部日期區塊（範圍：pad .. pad + dateH）
  const dateTop = pad;

  // 左上強調色小條與「今日訓練」小字
  drawRoundedRect(ctx, pad, dateTop + 2, 7, 24, 3.5, COLORS.accent);
  ctx.font = makeFont(24, 700);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = COLORS.accent;
  ctx.fillText('今日訓練', pad + 18, dateTop);

  // 多張時於右上角繪製頁碼膠囊（如「1/2」）
  let rightReservedW = 0;
  if (page.total > 1) {
    const badgeW = drawPageBadge(ctx, page.pageNo, page.total, metrics.size - pad, dateTop);
    rightReservedW = Math.max(rightReservedW, badgeW);
  }

  // 右側年份文字
  if (yearLabel) {
    ctx.font = makeFont(32, 700);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = COLORS.textFaint;
    ctx.fillText(yearLabel, metrics.size - pad, dateTop + 56);
    rightReservedW = Math.max(rightReservedW, measureWidth(ctx, yearLabel));
  }

  // 主日期大字（左側）
  ctx.font = makeFont(62, 800);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = COLORS.textPrimary;
  const dateMaxW = Math.max(180, contentW - rightReservedW - 20);
  ctx.fillText(truncateText(ctx, mainLabel, dateMaxW), pad, dateTop + 32);

  // 2. 總結卡片位置對齊 page.bodyTop - gap（確保與第一張器材卡完全不重疊）
  const hasCardio = Array.isArray(summary?.cardio) && summary.cardio.length > 0;
  const summaryCardH = metrics.statsH + (hasCardio ? metrics.cardioH : 0);
  const summaryY = page.bodyTop - metrics.gap - summaryCardH;

  // 3. 訓練部位圓角標籤（介於日期區與總結卡之間）
  const tagsTop = dateTop + metrics.dateH + metrics.gap;
  const tagsMaxBottom = summaryY - metrics.gap;
  drawBodyPartTags(
    ctx,
    summary?.bodyParts || [],
    pad,
    tagsTop,
    contentW,
    tagsMaxBottom,
    metrics
  );

  // 4. 總結數據卡片（4 格一列＋有氧加總列）
  drawSummaryCard(ctx, summary, pad, summaryY, contentW, summaryCardH, metrics);
}

/**
 * 繪製第 2 張以後的精簡頁首（日期小字＋「（續）」與右上頁碼膠囊）
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} summary
 * @param {object} page
 * @param {typeof SHARE_METRICS} metrics
 */
function drawOtherPageHeader(ctx, summary, page, metrics) {
  const pad = metrics.pad;
  const contentW = metrics.size - pad * 2;
  const { mainLabel, yearLabel } = parseDateParts(summary?.date || '');

  // 右上角頁碼膠囊（如「2/3」）
  let badgeW = 0;
  if (page.total > 1) {
    badgeW = drawPageBadge(ctx, page.pageNo, page.total, metrics.size - pad, pad + 16);
  }

  // 左側強調條與小字標題
  drawRoundedRect(ctx, pad, pad + 10, 7, 56, 3.5, COLORS.accent);

  const subText = yearLabel ? `今日訓練 · ${yearLabel}` : '今日訓練';
  ctx.font = makeFont(20, 700);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = COLORS.accent;
  ctx.fillText(subText, pad + 18, pad + 6);

  const titleText = `${mainLabel}（續）`;
  ctx.font = makeFont(36, 800);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = COLORS.textPrimary;
  const titleMaxW = Math.max(160, contentW - 18 - (badgeW ? badgeW + 20 : 0));
  ctx.fillText(truncateText(ctx, titleText, titleMaxW), pad + 18, pad + 32);

  // 頁首底部分隔線
  drawHorizontalLine(ctx, pad, metrics.size - pad, page.bodyTop - 10, COLORS.divider);
}

/**
 * 繪製底部置中「健身記錄」浮水印
 * @param {CanvasRenderingContext2D} ctx
 * @param {typeof SHARE_METRICS} metrics
 */
function drawFooter(ctx, metrics) {
  const size = metrics.size;
  const footerTop = size - metrics.pad - metrics.footerH;

  drawRoundedRect(
    ctx,
    size / 2 - 20,
    footerTop + 12,
    40,
    4,
    2,
    'rgba(34, 197, 94, 0.55)'
  );

  ctx.font = makeFont(24, 600);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = COLORS.textFaint;
  ctx.fillText('健身記錄', size / 2, footerTop + 26);
}

/**
 * 計算截斷後實際要繪製的組數數量
 * @param {number} totalSets 該紀錄總組數
 * @param {object} card planSharePages 回傳的卡片物件
 * @returns {number}
 */
function resolveShownSetCount(totalSets, card) {
  const hidden = Math.max(0, Number(card?.hiddenSets) || 0);
  if (hidden > 0) {
    return Math.max(0, totalSets - hidden);
  }
  return totalSets;
}

/**
 * 繪製 normal 模式單欄器材卡片（完全依 card.x / y / w / h 與 SHARE_METRICS.normal 繪製）
 * 字級：器材名 40px、組數 32px、備註 26px（≥ 24px）
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} log 訓練紀錄
 * @param {object} card 卡片配置座標
 * @param {typeof SHARE_METRICS.normal} m normal 版面參數
 */
function drawNormalCard(ctx, log, card, m) {
  const padX = 26;
  const innerW = Math.max(80, card.w - padX * 2);
  const cardRight = card.x + card.w - padX;
  let cursorY = card.y + m.padY;

  const sets = Array.isArray(log?.sets) ? log.sets : [];
  const fields = Array.isArray(log?.fields) ? log.fields : [];
  const trackReps = log?.trackReps !== false;
  const noteText = typeof log?.note === 'string' ? log.note.trim() : '';

  // 1. 標題列（序號圓圈＋器材名 40px＋右側部位小字）
  const titleCy = cursorY + m.titleH / 2;
  const circleRadius = 20;
  const circleCx = card.x + padX + circleRadius;

  ctx.beginPath();
  ctx.arc(circleCx, titleCy, circleRadius, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.accent;
  ctx.fill();

  ctx.font = makeFont(24, 800);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.accentDarkText;
  ctx.fillText(String((card.logIndex ?? 0) + 1), circleCx, titleCy + 1);

  // 右側部位文字
  const bodyParts = Array.isArray(log?.bodyParts)
    ? log.bodyParts.map((p) => String(p ?? '').trim()).filter(Boolean)
    : [];
  const partsRaw = bodyParts.join(' · ');
  let partsW = 0;
  if (partsRaw) {
    ctx.font = makeFont(24, 500);
    const partsText = truncateText(ctx, partsRaw, Math.min(240, innerW * 0.28));
    partsW = measureWidth(ctx, partsText);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.textMuted;
    ctx.fillText(partsText, cardRight, titleCy + 1);
  }

  // 器材名稱（40px）
  const nameX = card.x + padX + circleRadius * 2 + 16;
  const nameMaxW = Math.max(80, cardRight - (partsW ? partsW + 16 : 0) - nameX);
  const equipName = String(log?.equipmentName || '未命名器材').trim();
  ctx.font = makeFont(40, 700);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.textPrimary;
  ctx.fillText(truncateText(ctx, equipName, nameMaxW), nameX, titleCy + 1);

  cursorY += m.titleH;

  if (sets.length > 0 || noteText) {
    drawHorizontalLine(ctx, card.x + padX, cardRight, cursorY - 2, COLORS.divider);
  }

  // 2. 各組明細（組次＋formatSet 完整文字 32px＋右側單組小計）
  const shownCount = resolveShownSetCount(sets.length, card);
  const setLabelColW = 114;

  for (let i = 0; i < shownCount; i++) {
    const set = sets[i];
    const rowCy = cursorY + m.rowH / 2;

    // 組次標籤
    ctx.font = makeFont(28, 600);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.textMuted;
    ctx.fillText(`第 ${i + 1} 組`, card.x + padX, rowCy + 1);

    // 右側單組小計
    const subtotal = formatSetSubtotal(set, fields, trackReps);
    let subtotalW = 0;
    if (subtotal) {
      ctx.font = makeFont(26, 500);
      subtotalW = measureWidth(ctx, subtotal);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = COLORS.accentSubtle;
      ctx.fillText(subtotal, cardRight, rowCy + 1);
    }

    // 組數內容（32px）
    const setText = formatSet(set, fields, trackReps) || '—';
    const contentX = card.x + padX + setLabelColW;
    const contentMaxW = Math.max(
      80,
      cardRight - (subtotalW ? subtotalW + 18 : 0) - contentX
    );
    ctx.font = makeFont(32, 600);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.textBody;
    ctx.fillText(truncateText(ctx, setText, contentMaxW), contentX, rowCy + 1);

    cursorY += m.rowH;
  }

  // 若有截斷組數，保留一列顯示「…另 N 組」
  if (card.hiddenSets > 0) {
    const rowCy = cursorY + m.rowH / 2;
    ctx.font = makeFont(28, 600);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.textMuted;
    ctx.fillText(truncateText(ctx, `…另 ${card.hiddenSets} 組`, innerW), card.x + padX, rowCy + 1);
    cursorY += m.rowH;
  }

  // 3. 備註（最多 noteMaxLines 列，超出以「…」截斷）
  if (noteText) {
    ctx.font = makeFont(26, 400);
    const noteLines = wrapTextClamped(ctx, `備註：${noteText}`, innerW, m.noteMaxLines);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.textMuted;
    for (let i = 0; i < noteLines.length; i++) {
      const lineCy = cursorY + i * m.noteLineH + m.noteLineH / 2;
      ctx.fillText(noteLines[i], card.x + padX, lineCy);
    }
  }
}

/**
 * 繪製 compact 模式兩欄器材卡片（完全依 card.x / y / w / h 與 SHARE_METRICS.compact 繪製）
 * 字級下限：器材名 32px、組數文字 26px、備註 24px
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} log 訓練紀錄
 * @param {object} card 卡片配置座標
 * @param {typeof SHARE_METRICS.compact} m compact 版面參數
 */
function drawCompactCard(ctx, log, card, m) {
  const padX = 18;
  const innerW = Math.max(80, card.w - padX * 2);
  const cardRight = card.x + card.w - padX;
  let cursorY = card.y + m.padY;

  const sets = Array.isArray(log?.sets) ? log.sets : [];
  const fields = Array.isArray(log?.fields) ? log.fields : [];
  const trackReps = log?.trackReps !== false;
  const noteText = typeof log?.note === 'string' ? log.note.trim() : '';

  // 1. 標題列（序號圓圈＋器材名 32px＋單一欄位單位提示如「kg × 下」）
  const titleCy = cursorY + m.titleH / 2;
  const circleRadius = 15;
  const circleCx = card.x + padX + circleRadius;

  ctx.beginPath();
  ctx.arc(circleCx, titleCy, circleRadius, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.accent;
  ctx.fill();

  ctx.font = makeFont(19, 800);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.accentDarkText;
  ctx.fillText(String((card.logIndex ?? 0) + 1), circleCx, titleCy + 1);

  // fields 只有 1 個時在標題右側標示單位提示（如「kg × 下」）
  const unitHintRaw = buildCompactUnitHint(fields, trackReps);
  let unitHintW = 0;
  if (unitHintRaw) {
    ctx.font = makeFont(20, 500);
    const unitHint = truncateText(ctx, unitHintRaw, 116);
    unitHintW = measureWidth(ctx, unitHint);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.textMuted;
    ctx.fillText(unitHint, cardRight, titleCy + 1);
  }

  // 器材名稱（32px）
  const nameX = card.x + padX + circleRadius * 2 + 10;
  const nameMaxW = Math.max(60, cardRight - (unitHintW ? unitHintW + 10 : 0) - nameX);
  const equipName = String(log?.equipmentName || '未命名器材').trim();
  ctx.font = makeFont(32, 700);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.textPrimary;
  ctx.fillText(truncateText(ctx, equipName, nameMaxW), nameX, titleCy + 1);

  cursorY += m.titleH;

  if (sets.length > 0 || noteText) {
    drawHorizontalLine(ctx, card.x + padX, cardRight, cursorY - 2, COLORS.divider);
  }

  // 2. 組數列：fields.length <= 1 時每列 2 組，否則每列 1 組（文字 26px）
  const shownCount = resolveShownSetCount(sets.length, card);
  const perRow = fields.length <= 1 ? (m.setsPerRow || 2) : 1;
  const colGap = 12;
  const cellW = perRow > 1 ? (innerW - colGap * (perRow - 1)) / perRow : innerW;
  const rowCount = Math.ceil(shownCount / perRow);

  for (let r = 0; r < rowCount; r++) {
    const rowCy = cursorY + m.rowH / 2;
    for (let c = 0; c < perRow; c++) {
      const idx = r * perRow + c;
      if (idx >= shownCount) break;

      const cellX = card.x + padX + c * (cellW + colGap);
      const indexText = `${idx + 1}.`;

      ctx.font = makeFont(26, 500);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = COLORS.textMuted;
      ctx.fillText(indexText, cellX, rowCy + 1);
      const prefixW = measureWidth(ctx, indexText) + 6;

      const setText = compactSetText(sets[idx], fields, trackReps) || '—';
      ctx.font = makeFont(26, 600);
      ctx.fillStyle = COLORS.textBody;
      ctx.fillText(
        truncateText(ctx, setText, Math.max(24, cellW - prefixW)),
        cellX + prefixW,
        rowCy + 1
      );
    }
    cursorY += m.rowH;
  }

  // 若有截斷組數，保留一列顯示「…另 N 組」
  if (card.hiddenSets > 0) {
    const rowCy = cursorY + m.rowH / 2;
    ctx.font = makeFont(26, 600);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.textMuted;
    ctx.fillText(truncateText(ctx, `…另 ${card.hiddenSets} 組`, innerW), card.x + padX, rowCy + 1);
    cursorY += m.rowH;
  }

  // 3. 備註（字級 24px，最多 noteMaxLines 列，超出以「…」截斷）
  if (noteText) {
    ctx.font = makeFont(24, 400);
    const noteLines = wrapTextClamped(ctx, `備註：${noteText}`, innerW, m.noteMaxLines);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.textMuted;
    for (let i = 0; i < noteLines.length; i++) {
      const lineCy = cursorY + i * m.noteLineH + m.noteLineH / 2;
      ctx.fillText(noteLines[i], card.x + padX, lineCy);
    }
  }
}

/**
 * 繪製單一器材卡片外框與內容（依 planSharePages 回傳的座標與裁切邊界繪製）
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} log
 * @param {object} card
 * @param {'normal' | 'compact'} mode
 * @param {typeof SHARE_METRICS} metrics
 */
function drawEquipmentCard(ctx, log, card, mode, metrics) {
  const radius = mode === 'compact' ? 20 : 24;
  drawRoundedRect(
    ctx,
    card.x,
    card.y,
    card.w,
    card.h,
    radius,
    COLORS.cardBg,
    COLORS.cardBorder,
    1.5
  );

  // 裁切於卡片範圍內，避免極端字型寬高溢出外框
  const canClip =
    typeof ctx.save === 'function' &&
    typeof ctx.clip === 'function' &&
    typeof ctx.restore === 'function';
  if (canClip) {
    ctx.save();
    drawRoundedRectPath(ctx, card.x, card.y, card.w, card.h, radius);
    ctx.clip();
  }

  if (mode === 'normal') {
    drawNormalCard(ctx, log, card, metrics.normal);
  } else {
    drawCompactCard(ctx, log, card, metrics.compact);
  }

  if (canClip) {
    ctx.restore();
  }
}

/**
 * 繪製單張 1080×1080 分享圖頁面
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} summary
 * @param {object} page planSharePages 回傳的單頁配置
 * @param {'normal' | 'compact'} mode
 * @param {typeof SHARE_METRICS} metrics
 */
function drawSharePage(ctx, summary, page, mode, metrics) {
  const size = metrics.size;
  drawBackground(ctx, size, size);

  if (page.hasSummary) {
    drawFirstPageHeader(ctx, summary, page, metrics);
  } else {
    drawOtherPageHeader(ctx, summary, page, metrics);
  }

  const logs = Array.isArray(summary?.logs) ? summary.logs : [];
  const cards = Array.isArray(page.cards) ? page.cards : [];
  for (const card of cards) {
    const log = logs[card.logIndex];
    if (!log) continue;
    drawEquipmentCard(ctx, log, card, mode, metrics);
  }

  drawFooter(ctx, metrics);
}

/**
 * 依 planSharePages 結果繪製全部 1080×1080 正方形分享圖 Canvas 陣列
 * @param {object} daySummary 由 summarizeDay 產生的當日訓練摘要
 * @param {{ createCanvas?: (w: number, h: number) => HTMLCanvasElement }} [options={}]
 * @returns {HTMLCanvasElement[]}
 */
export function buildShareCanvases(daySummary, { createCanvas } = {}) {
  const safeSummary = daySummary && typeof daySummary === 'object' ? daySummary : {};
  const metrics = SHARE_METRICS;
  const size = metrics.size;
  const plan = planSharePages(safeSummary, metrics);

  const makeCanvas =
    typeof createCanvas === 'function'
      ? createCanvas
      : (w, h) => {
          const canvasEl = document.createElement('canvas');
          canvasEl.width = w;
          canvasEl.height = h;
          return canvasEl;
        };

  const pages = Array.isArray(plan?.pages) ? plan.pages : [];
  const mode = plan?.mode === 'compact' ? 'compact' : 'normal';

  return pages.map((page) => {
    const canvas = makeCanvas(size, size);
    if (canvas.width !== size) canvas.width = size;
    if (canvas.height !== size) canvas.height = size;
    const drawCtx = canvas.getContext('2d');
    drawSharePage(drawCtx, safeSummary, page, mode, metrics);
    return canvas;
  });
}

/**
 * 將單一 Canvas 轉為 PNG Blob
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<Blob>}
 */
function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    if (typeof canvas?.toBlob !== 'function') {
      reject(new Error('此瀏覽器不支援匯出圖片'));
      return;
    }
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
      } else {
        reject(new Error('無法轉換分享圖片'));
      }
    }, 'image/png');
  });
}

/**
 * 釋放前一次預覽建立的全部 Object URL
 */
function revokeLastPreviewUrls() {
  for (const url of lastPreviewObjectUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // 忽略釋放例外
    }
  }
  lastPreviewObjectUrls = [];
}

/**
 * 觸發單一檔案下載
 * @param {string} objectUrl
 * @param {string} filename
 */
function triggerDownload(objectUrl, filename) {
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * 延遲指定毫秒數
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 開啟「分享今日訓練」預覽面板（支援單張與多張橫向滑動、長按存圖、一次分享全部檔案與逐張下載）
 * @param {object} ctx 共用應用上下文物件
 * @param {string} date 本地日期字串 'YYYY-MM-DD'
 * @returns {Promise<void>}
 */
export async function openSharePreview(ctx, date) {
  const allLogs = Array.isArray(ctx?.data?.logs) ? ctx.data.logs : [];
  const dayLogs = allLogs.filter((log) => log && log.date === date);

  if (dayLogs.length === 0) {
    ctx?.toast?.('這天還沒有紀錄');
    return;
  }

  const summary = summarizeDay(dayLogs);
  const effectiveDate = summary?.date || date || '';

  // 等待網頁字型就緒，避免繪製時退回預設字型造成寬度偏差
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // 忽略字型等待例外，仍使用系統字型繪製
    }
  }

  let blobs;
  try {
    const canvases = buildShareCanvases(summary);
    blobs = await Promise.all(canvases.map((canvas) => canvasToPngBlob(canvas)));
  } catch (err) {
    ctx?.toast?.('產生圖片失敗：' + (err?.message || '請稍後再試'), true);
    return;
  }

  // 釋放前一次預覽的全部 Object URL
  revokeLastPreviewUrls();

  const total = blobs.length;
  const dateSlug = effectiveDate || 'workout';
  const pagesData = blobs.map((blob, index) => {
    const filename =
      total > 1 ? `fitness-${dateSlug}-${index + 1}.png` : `fitness-${dateSlug}.png`;
    const objectUrl = URL.createObjectURL(blob);
    lastPreviewObjectUrls.push(objectUrl);
    const file =
      typeof File === 'function' ? new File([blob], filename, { type: 'image/png' }) : null;
    return { filename, objectUrl, file };
  });

  // 檢查是否支援 Web Share API 一次分享全部檔案
  const shareFiles = pagesData.map((p) => p.file).filter(Boolean);
  let canShareFiles = false;
  if (
    shareFiles.length === total &&
    shareFiles.length > 0 &&
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function'
  ) {
    try {
      canShareFiles = Boolean(navigator.canShare({ files: shareFiles }));
    } catch {
      canShareFiles = false;
    }
  }

  // 建立面板內容：橫向滑動預覽容器、頁點與提示文字
  const bodyEl = document.createElement('div');
  bodyEl.className = 'stack';
  bodyEl.style.alignItems = 'center';
  bodyEl.style.gap = '12px';

  const pagesEl = document.createElement('div');
  pagesEl.className = 'share-pages';

  const dateLabel = effectiveDate ? formatDateLabel(effectiveDate) : '';
  const imgEls = pagesData.map((item, index) => {
    const imgEl = document.createElement('img');
    imgEl.className = 'share-preview';
    imgEl.src = item.objectUrl;
    const pageSuffix = total > 1 ? `（第 ${index + 1}/${total} 張）` : '';
    imgEl.alt = dateLabel
      ? `${dateLabel} 訓練分享圖${pageSuffix}`
      : `今日訓練分享圖${pageSuffix}`;
    pagesEl.appendChild(imgEl);
    return imgEl;
  });

  bodyEl.appendChild(pagesEl);

  // 多張時顯示頁點與滑動提示
  if (total > 1) {
    const dotsEl = document.createElement('div');
    dotsEl.className = 'share-dots';
    dotsEl.setAttribute('aria-label', '分享圖片頁碼');

    const dotBtns = pagesData.map((_, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = index === 0 ? 'share-dot active' : 'share-dot';
      dot.setAttribute('aria-label', `切換到第 ${index + 1} 張`);
      dot.addEventListener('click', () => {
        const target = imgEls[index];
        if (target && typeof target.scrollIntoView === 'function') {
          target.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
      });
      dotsEl.appendChild(dot);
      return dot;
    });

    const syncActiveDot = () => {
      const scrollCenter = pagesEl.scrollLeft + pagesEl.clientWidth / 2;
      let activeIdx = 0;
      let minDist = Infinity;
      for (let i = 0; i < imgEls.length; i++) {
        const el = imgEls[i];
        const center = el.offsetLeft + el.offsetWidth / 2;
        const dist = Math.abs(center - scrollCenter);
        if (dist < minDist) {
          minDist = dist;
          activeIdx = i;
        }
      }
      dotBtns.forEach((btn, i) => {
        btn.classList.toggle('active', i === activeIdx);
      });
    };

    pagesEl.addEventListener('scroll', syncActiveDot, { passive: true });

    const swipeHintEl = document.createElement('p');
    swipeHintEl.className = 'share-hint';
    swipeHintEl.textContent = `共 ${total} 張，左右滑動查看`;

    bodyEl.append(dotsEl, swipeHintEl);
  }

  const hintEl = document.createElement('p');
  hintEl.className = 'share-hint';
  hintEl.textContent = 'iPhone／Android 可長按圖片存到相簿';
  bodyEl.appendChild(hintEl);

  // 建立底部操作列：分享（條件顯示）與下載圖片
  const footerEl = document.createElement('div');
  footerEl.className = 'row';
  footerEl.style.width = '100%';

  if (canShareFiles) {
    const shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.className = 'btn btn-primary';
    shareBtn.style.flex = '1';
    shareBtn.textContent = '分享';
    shareBtn.addEventListener('click', async () => {
      try {
        await navigator.share({ files: shareFiles, title: '今日訓練' });
      } catch (err) {
        // 使用者主動取消分享不顯示錯誤提示
        if (err && err.name === 'AbortError') return;
        ctx?.toast?.('分享失敗：' + (err?.message || '請改用下載或長按存圖'), true);
      }
    });
    footerEl.appendChild(shareBtn);
  }

  if (total === 1) {
    const downloadLink = document.createElement('a');
    downloadLink.className = canShareFiles ? 'btn btn-ghost' : 'btn btn-primary';
    downloadLink.style.flex = '1';
    downloadLink.href = pagesData[0].objectUrl;
    downloadLink.download = pagesData[0].filename;
    downloadLink.textContent = '下載圖片';
    footerEl.appendChild(downloadLink);
  } else {
    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = canShareFiles ? 'btn btn-ghost' : 'btn btn-primary';
    downloadBtn.style.flex = '1';
    downloadBtn.textContent = '下載圖片';
    downloadBtn.addEventListener('click', async () => {
      if (downloadBtn.disabled) return;
      downloadBtn.disabled = true;
      try {
        for (let i = 0; i < pagesData.length; i++) {
          triggerDownload(pagesData[i].objectUrl, pagesData[i].filename);
          if (i < pagesData.length - 1) {
            await delay(DOWNLOAD_INTERVAL_MS);
          }
        }
      } finally {
        downloadBtn.disabled = false;
      }
    });
    footerEl.appendChild(downloadBtn);
  }

  ctx.openSheet('分享今日訓練', bodyEl, footerEl);
}
