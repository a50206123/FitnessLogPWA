/**
 * 健身記錄 PWA 純邏輯函式模組
 * 注意：本模組完全不接觸 DOM 與 localStorage，供瀏覽器與 Node 測試共用。
 */

/** 預設訓練部位清單（依顯示與排序順序） */
export const BODY_PARTS = Object.freeze([
  '胸',
  '背',
  '肩',
  '手臂',
  '腿',
  '臀',
  '核心',
  '有氧',
  '全身',
]);

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const WEIGHT_UNITS = new Set(['kg', 'lb']);
const REQUIRED_FIREBASE_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'];

/**
 * 將值轉為有限數字；若為空值或無法解析則回傳 null
 * @param {unknown} val
 * @returns {number | null}
 */
function toFiniteNumber(val) {
  if (val === '' || val === null || val === undefined) return null;
  if (typeof val === 'string' && val.trim() === '') return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

/**
 * 依日期與建立時間由新到舊比較兩筆紀錄
 */
function compareLogsDesc(a, b) {
  const dateDiff = (b?.date || '').localeCompare(a?.date || '');
  if (dateDiff !== 0) return dateDiff;
  return (b?.createdAt || '').localeCompare(a?.createdAt || '');
}

/**
 * 產生唯一識別碼（時間戳記＋亂數）
 * @param {string} [prefix=''] 前綴字串
 * @returns {string}
 */
export function makeId(prefix = '') {
  const timePart = Date.now().toString(36);
  const randPart =
    Math.random().toString(36).slice(2, 8) +
    Math.random().toString(36).slice(2, 6);
  return `${prefix}${timePart}${randPart}`;
}

/**
 * 取得本地日期字串 'YYYY-MM-DD'
 * @param {Date | string | number} [date=new Date()]
 * @returns {string}
 */
export function toDateStr(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = String(d.getFullYear()).padStart(4, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 將 'YYYY-MM-DD' 格式化為易讀標籤，例如 '11/23（一）'；非今年則加上年份 '2025/11/23（日）'
 * @param {string} dateStr 本地日期字串 'YYYY-MM-DD'
 * @param {Date | string | number} [refDate=new Date()] 判斷「今年」用的參考日期
 * @returns {string}
 */
export function formatDateLabel(dateStr, refDate = new Date()) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return dateStr;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // 使用本地時間建構 Date，避免跨時區偏移
  const localDate = new Date(year, month - 1, day);
  const weekday = WEEKDAYS[localDate.getDay()];
  const currentYear = (refDate instanceof Date ? refDate : new Date(refDate)).getFullYear();

  const md = `${month}/${day}`;
  return year === currentYear ? `${md}（${weekday}）` : `${year}/${md}（${weekday}）`;
}

/**
 * 產生下一組資料：沿用上一組的 reps 與 values（深拷貝）；若無上一組則皆為空字串
 * @param {{ reps?: number | string, values?: Record<string, any> } | null | undefined} prevSet
 * @param {Array<{ key: string, name?: string, unit?: string }>} [fields=[]]
 * @returns {{ reps: number | string, values: Record<string, any> }}
 */
export function newSetFrom(prevSet, fields = []) {
  const values = {};
  if (prevSet && prevSet.values && typeof prevSet.values === 'object') {
    for (const [k, v] of Object.entries(prevSet.values)) {
      values[k] = v !== undefined && v !== null ? structuredClone(v) : '';
    }
  }
  for (const field of fields || []) {
    if (field && field.key && !(field.key in values)) {
      values[field.key] = '';
    }
  }
  const reps =
    prevSet && prevSet.reps !== undefined && prevSet.reps !== null
      ? prevSet.reps
      : '';
  return { reps, values };
}

/**
 * 清理組數陣列：將數字字串轉為數值、移除完全空白的組，並回傳新陣列（不修改原資料）
 * @param {Array<{ reps?: any, values?: Record<string, any> }>} sets
 * @param {Array<{ key: string }>} [fields=[]]
 * @param {boolean} [trackReps=true]
 * @returns {Array<{ reps?: number, values: Record<string, number> }>}
 */
export function cleanSets(sets, fields = [], trackReps = true) {
  if (!Array.isArray(sets)) return [];
  const fieldList = Array.isArray(fields) ? fields : [];
  const result = [];

  for (const rawSet of sets) {
    if (!rawSet || typeof rawSet !== 'object') continue;

    const cleanedValues = {};
    const rawValues = rawSet.values && typeof rawSet.values === 'object' ? rawSet.values : {};
    for (const field of fieldList) {
      if (!field || !field.key) continue;
      const num = toFiniteNumber(rawValues[field.key]);
      if (num !== null) {
        cleanedValues[field.key] = num;
      }
    }

    const repsNum = trackReps ? toFiniteNumber(rawSet.reps) : null;
    const hasValues = Object.keys(cleanedValues).length > 0;
    const hasReps = repsNum !== null;

    if (!hasValues && !hasReps) continue;

    const cleanedSet = { values: cleanedValues };
    if (hasReps) {
      cleanedSet.reps = repsNum;
    }
    result.push(cleanedSet);
  }

  return result;
}

/**
 * 計算單筆訓練紀錄的統計摘要
 * @param {object} log 訓練紀錄
 * @returns {{ setCount: number, totalReps: number, maxByField: Record<string, number>, volume: number }}
 */
export function summarizeLog(log) {
  const sets = Array.isArray(log?.sets) ? log.sets : [];
  const fields = Array.isArray(log?.fields) ? log.fields : [];
  const trackReps = log?.trackReps !== false;

  const weightField = fields.find((f) =>
    WEIGHT_UNITS.has(String(f?.unit ?? '').trim().toLowerCase())
  );

  let totalReps = 0;
  let volume = 0;
  const maxByField = {};

  for (const set of sets) {
    if (!set || typeof set !== 'object') continue;
    const reps = trackReps ? toFiniteNumber(set.reps) : null;
    if (reps !== null) {
      totalReps += reps;
    }

    const values = set.values && typeof set.values === 'object' ? set.values : {};
    if (fields.length > 0) {
      for (const field of fields) {
        if (!field || !field.key) continue;
        const val = toFiniteNumber(values[field.key]);
        if (val !== null) {
          if (!(field.key in maxByField) || val > maxByField[field.key]) {
            maxByField[field.key] = val;
          }
        }
      }
    } else {
      for (const [key, rawVal] of Object.entries(values)) {
        const val = toFiniteNumber(rawVal);
        if (val !== null) {
          if (!(key in maxByField) || val > maxByField[key]) {
            maxByField[key] = val;
          }
        }
      }
    }

    if (weightField && reps !== null) {
      const weight = toFiniteNumber(values[weightField.key]);
      if (weight !== null) {
        volume += weight * reps;
      }
    }
  }

  // 消除浮點數尾數誤差
  const roundedVolume = Math.round(volume * 1e6) / 1e6;

  return {
    setCount: sets.length,
    totalReps,
    maxByField,
    volume: roundedVolume,
  };
}

/**
 * 將單筆訓練紀錄格式化為摘要文字
 * 例：'3 組 · 共 30 下 · 重量最高 40 kg' 或 '1 組 · 速度最高 8 km/h · 坡度最高 3 %'
 * @param {object} log 訓練紀錄
 * @returns {string}
 */
export function formatLogSummary(log) {
  const { setCount, totalReps, maxByField } = summarizeLog(log);
  const trackReps = log?.trackReps !== false;
  const fields = Array.isArray(log?.fields) ? log.fields : [];

  const parts = [`${setCount} 組`];

  if (trackReps && totalReps > 0) {
    parts.push(`共 ${totalReps} 下`);
  }

  for (const field of fields) {
    if (!field || !field.key || !(field.key in maxByField)) continue;
    const maxVal = maxByField[field.key];
    const unit = String(field.unit ?? '').trim();
    const label = unit
      ? `${field.name}最高 ${maxVal} ${unit}`
      : `${field.name}最高 ${maxVal}`;
    parts.push(label);
  }

  return parts.join(' · ');
}

/**
 * 將單組資料格式化為易讀字串
 * 例：'40 kg × 12 下'、'8 km/h · 3 % · 20 分'
 * @param {{ reps?: number | string, values?: Record<string, any> }} set
 * @param {Array<{ key: string, name?: string, unit?: string }>} [fields=[]]
 * @param {boolean} [trackReps=true]
 * @returns {string}
 */
export function formatSet(set, fields = [], trackReps = true) {
  if (!set || typeof set !== 'object') return '';
  const values = set.values && typeof set.values === 'object' ? set.values : {};
  const fieldParts = [];

  for (const field of fields || []) {
    if (!field || !field.key) continue;
    const val = values[field.key];
    if (val === undefined || val === null || val === '') continue;
    const unit = String(field.unit ?? '').trim();
    if (unit) {
      fieldParts.push(`${val} ${unit}`);
    } else if (field.name) {
      fieldParts.push(`${field.name} ${val}`);
    } else {
      fieldParts.push(String(val));
    }
  }

  const hasReps =
    trackReps !== false &&
    set.reps !== undefined &&
    set.reps !== null &&
    set.reps !== '';
  const repsPart = hasReps ? `${set.reps} 下` : '';

  if (fieldParts.length > 0 && hasReps) {
    return `${fieldParts.join(' · ')} × ${repsPart}`;
  }
  if (fieldParts.length > 0) {
    return fieldParts.join(' · ');
  }
  return repsPart;
}

/**
 * 依日期分組紀錄：日期由新到舊，同日依 createdAt 由舊到新
 * @param {Array<object>} logs
 * @returns {Array<{ date: string, logs: Array<object> }>}
 */
export function groupByDate(logs) {
  if (!Array.isArray(logs) || logs.length === 0) return [];

  const map = new Map();
  for (const log of logs) {
    if (!log || !log.date) continue;
    if (!map.has(log.date)) {
      map.set(log.date, []);
    }
    map.get(log.date).push(log);
  }

  return Array.from(map.entries())
    .sort(([dateA], [dateB]) => dateB.localeCompare(dateA))
    .map(([date, items]) => ({
      date,
      logs: [...items].sort((a, b) =>
        (a?.createdAt || '').localeCompare(b?.createdAt || '')
      ),
    }));
}

/**
 * 依器材分組紀錄：依 lastDate 由新到舊排序；已刪除器材使用紀錄快照名稱；無紀錄器材排在最後（count 為 0）
 * @param {Array<object>} logs
 * @param {Array<object>} [equipmentList=[]]
 * @returns {Array<{ equipmentId: string, name: string, bodyParts: string[], count: number, lastDate: string | null, logs: Array<object> }>}
 */
export function groupByEquipment(logs, equipmentList = []) {
  const safeLogs = Array.isArray(logs) ? logs : [];
  const safeEquipment = Array.isArray(equipmentList) ? equipmentList : [];

  const map = new Map();

  // 先納入現有器材清單，保留無紀錄的器材
  for (const eq of safeEquipment) {
    if (!eq || !eq.id) continue;
    map.set(eq.id, {
      equipmentId: eq.id,
      name: eq.name || '',
      bodyParts: Array.isArray(eq.bodyParts) ? [...eq.bodyParts] : [],
      logs: [],
      fromList: true,
    });
  }

  // 匯入所有訓練紀錄（已刪除器材以快照建立）
  for (const log of safeLogs) {
    if (!log || !log.equipmentId) continue;
    if (!map.has(log.equipmentId)) {
      map.set(log.equipmentId, {
        equipmentId: log.equipmentId,
        name: log.equipmentName || '未命名器材',
        bodyParts: Array.isArray(log.bodyParts) ? [...log.bodyParts] : [],
        logs: [],
        fromList: false,
      });
    }
    map.get(log.equipmentId).logs.push(log);
  }

  const groups = Array.from(map.values()).map((entry) => {
    const sortedLogs = [...entry.logs].sort(compareLogsDesc);
    const lastDate = sortedLogs.length > 0 ? sortedLogs[0].date : null;

    // 若器材已刪除，以最新一筆紀錄的快照名稱與部位為準
    const name =
      entry.fromList || sortedLogs.length === 0
        ? entry.name
        : sortedLogs[0].equipmentName || entry.name;
    const bodyParts =
      entry.fromList || sortedLogs.length === 0
        ? entry.bodyParts
        : Array.isArray(sortedLogs[0].bodyParts)
          ? [...sortedLogs[0].bodyParts]
          : entry.bodyParts;

    return {
      equipmentId: entry.equipmentId,
      name,
      bodyParts,
      count: sortedLogs.length,
      lastDate,
      logs: sortedLogs,
    };
  });

  groups.sort((a, b) => {
    if (a.lastDate && b.lastDate) {
      return b.lastDate.localeCompare(a.lastDate);
    }
    if (a.lastDate && !b.lastDate) return -1;
    if (!a.lastDate && b.lastDate) return 1;
    return 0;
  });

  return groups;
}

/**
 * 依訓練部位分組紀錄：多部位紀錄會出現在各對應部位；依 BODY_PARTS 順序排列，自訂部位排在後面
 * @param {Array<object>} logs
 * @returns {Array<{ part: string, count: number, days: number, logs: Array<object> }>}
 */
export function groupByBodyPart(logs) {
  if (!Array.isArray(logs) || logs.length === 0) return [];

  const map = new Map();
  for (const log of logs) {
    if (!log || !Array.isArray(log.bodyParts)) continue;
    const uniqueParts = new Set(
      log.bodyParts
        .map((p) => (typeof p === 'string' ? p.trim() : ''))
        .filter(Boolean)
    );
    for (const part of uniqueParts) {
      if (!map.has(part)) {
        map.set(part, []);
      }
      map.get(part).push(log);
    }
  }

  const groups = Array.from(map.entries()).map(([part, items]) => {
    const sortedLogs = [...items].sort(compareLogsDesc);
    const uniqueDates = new Set(sortedLogs.map((l) => l.date).filter(Boolean));
    return {
      part,
      count: sortedLogs.length,
      days: uniqueDates.size,
      logs: sortedLogs,
    };
  });

  groups.sort((a, b) => {
    const idxA = BODY_PARTS.indexOf(a.part);
    const idxB = BODY_PARTS.indexOf(b.part);
    const inDefaultA = idxA !== -1;
    const inDefaultB = idxB !== -1;

    if (inDefaultA && inDefaultB) return idxA - idxB;
    if (inDefaultA) return -1;
    if (inDefaultB) return 1;
    return a.part.localeCompare(b.part, 'zh-Hant');
  });

  return groups;
}

/**
 * 取得指定器材最近一筆訓練紀錄（若提供 beforeDate，僅取該日期之前的紀錄）
 * @param {Array<object>} logs
 * @param {string} equipmentId
 * @param {string} [beforeDate]
 * @returns {object | null}
 */
export function lastLogForEquipment(logs, equipmentId, beforeDate) {
  if (!Array.isArray(logs) || !equipmentId) return null;

  let latest = null;
  for (const log of logs) {
    if (!log || log.equipmentId !== equipmentId) continue;
    if (beforeDate && (!log.date || log.date >= beforeDate)) continue;
    if (!latest || compareLogsDesc(log, latest) < 0) {
      latest = log;
    }
  }

  return latest;
}

/**
 * 驗證器材表單資料，回傳正體中文錯誤訊息陣列（通過時回傳空陣列）
 * @param {object} eq
 * @returns {string[]}
 */
export function validateEquipment(eq) {
  if (!eq || typeof eq !== 'object') {
    return ['器材資料格式不正確'];
  }

  const errors = [];

  const name = typeof eq.name === 'string' ? eq.name.trim() : '';
  if (!name) {
    errors.push('器材名稱為必填項目');
  }

  const bodyParts = Array.isArray(eq.bodyParts)
    ? eq.bodyParts
        .map((p) => (typeof p === 'string' ? p.trim() : ''))
        .filter(Boolean)
    : [];
  if (bodyParts.length === 0) {
    errors.push('請至少選擇一個訓練部位');
  }

  const fields = Array.isArray(eq.fields) ? eq.fields : [];
  let hasBlankFieldName = false;
  const seenFieldNames = new Set();
  const duplicateFieldNames = new Set();

  for (const field of fields) {
    const fieldName = typeof field?.name === 'string' ? field.name.trim() : '';
    if (!fieldName) {
      hasBlankFieldName = true;
      continue;
    }
    if (seenFieldNames.has(fieldName)) {
      if (!duplicateFieldNames.has(fieldName)) {
        duplicateFieldNames.add(fieldName);
        errors.push(`欄位名稱不可重複：${fieldName}`);
      }
    } else {
      seenFieldNames.add(fieldName);
    }
  }

  if (hasBlankFieldName) {
    errors.push('欄位名稱不可空白');
  }

  return errors;
}

/**
 * 解析 JS 物件字面量（支援未加引號 key、單引號字串、註解與結尾逗號），不使用 eval
 * @param {string} src 起始字元為 '{' 的文字片段
 * @returns {Record<string, any>}
 */
function parseObjectLiteral(src) {
  let pos = 0;
  const len = src.length;

  function skipIgnored() {
    while (pos < len) {
      const ch = src[pos];
      if (/\s/.test(ch)) {
        pos++;
        continue;
      }
      // 單行註解
      if (ch === '/' && src[pos + 1] === '/') {
        pos += 2;
        while (pos < len && src[pos] !== '\n') pos++;
        continue;
      }
      // 多行註解
      if (ch === '/' && src[pos + 1] === '*') {
        pos += 2;
        while (pos < len && !(src[pos] === '*' && src[pos + 1] === '/')) pos++;
        if (pos >= len) {
          throw new Error('Firebase 設定格式錯誤：註解未正確結束');
        }
        pos += 2;
        continue;
      }
      break;
    }
  }

  function readString() {
    const quote = src[pos];
    pos++;
    let out = '';
    while (pos < len) {
      const ch = src[pos];
      if (ch === '\\') {
        pos++;
        if (pos >= len) {
          throw new Error('Firebase 設定格式錯誤：字串跳脫未完成');
        }
        const esc = src[pos];
        if (esc === 'n') out += '\n';
        else if (esc === 'r') out += '\r';
        else if (esc === 't') out += '\t';
        else if (esc === 'u') {
          const hex = src.slice(pos + 1, pos + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw new Error('Firebase 設定格式錯誤：無效的 Unicode 跳脫序列');
          }
          out += String.fromCharCode(parseInt(hex, 16));
          pos += 4;
        } else {
          out += esc;
        }
        pos++;
        continue;
      }
      if (ch === quote) {
        pos++;
        return out;
      }
      out += ch;
      pos++;
    }
    throw new Error('Firebase 設定格式錯誤：字串引號未閉合');
  }

  function readIdentifier() {
    const start = pos;
    while (pos < len && /[A-Za-z0-9_$-]/.test(src[pos])) {
      pos++;
    }
    if (pos === start) {
      throw new Error('Firebase 設定格式錯誤：無法解析欄位名稱');
    }
    return src.slice(start, pos);
  }

  function readValue() {
    skipIgnored();
    if (pos >= len) {
      throw new Error('Firebase 設定格式錯誤：缺少欄位值');
    }
    const ch = src[pos];
    if (ch === '"' || ch === "'") {
      return readString();
    }
    if (ch === '{') {
      return readObject();
    }
    // 處理布林、null、數字等基本型別
    const start = pos;
    while (pos < len && !/[\s,}\]]/.test(src[pos])) {
      pos++;
    }
    const token = src.slice(start, pos);
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'null') return null;
    if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token)) {
      return Number(token);
    }
    throw new Error(`Firebase 設定格式錯誤：無法解析的值「${token}」`);
  }

  function readObject() {
    skipIgnored();
    if (src[pos] !== '{') {
      throw new Error('Firebase 設定格式錯誤：找不到設定物件的左大括號');
    }
    pos++;
    const obj = {};

    while (pos < len) {
      skipIgnored();
      if (src[pos] === '}') {
        pos++;
        return obj;
      }

      const ch = src[pos];
      const key = ch === '"' || ch === "'" ? readString() : readIdentifier();

      skipIgnored();
      if (src[pos] !== ':') {
        throw new Error(`Firebase 設定格式錯誤：欄位「${key}」後方缺少冒號`);
      }
      pos++;

      const val = readValue();
      obj[key] = val;

      skipIgnored();
      if (src[pos] === ',') {
        pos++;
        continue;
      }
      if (src[pos] === '}') {
        pos++;
        return obj;
      }
      throw new Error('Firebase 設定格式錯誤：欄位之間缺少逗號或結束大括號');
    }

    throw new Error('Firebase 設定格式錯誤：設定物件的大括號未閉合');
  }

  return readObject();
}

/**
 * 解析 Firebase 設定文字：接受純 JSON 或 Firebase 主控台複製的 firebaseConfig 程式碼片段
 * 缺少 apiKey、authDomain、projectId 或 appId 時會拋出正體中文 Error
 * @param {string} text
 * @returns {Record<string, any>}
 */
export function parseFirebaseConfig(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('請貼上 Firebase 設定內容');
  }

  const trimmed = text.trim();
  let config = null;

  // 優先嘗試純 JSON 解析
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      config = parsed;
    }
  } catch {
    // 非純 JSON 時改用寬鬆物件字面量解析器
  }

  if (!config) {
    // 若貼上完整 Firebase 主控台片段（含 import { initializeApp }），優先定位賦值後的 '{'
    let startIdx = -1;
    const assignMatch = /firebaseConfig\s*=\s*\{/.exec(trimmed) || /=\s*\{/.exec(trimmed);
    if (assignMatch) {
      startIdx = assignMatch.index + assignMatch[0].lastIndexOf('{');
    } else {
      startIdx = trimmed.indexOf('{');
    }

    if (startIdx === -1) {
      throw new Error('無法解析 Firebase 設定：找不到設定物件內容');
    }

    config = parseObjectLiteral(trimmed.slice(startIdx));
  }

  const missing = REQUIRED_FIREBASE_KEYS.filter(
    (key) => typeof config[key] !== 'string' || config[key].trim() === ''
  );
  if (missing.length > 0) {
    throw new Error(`Firebase 設定缺少必要欄位：${missing.join('、')}`);
  }

  return config;
}

/** 有氧時間與距離類單位集合（比對時統一去空白並轉小寫） */
const CARDIO_UNITS = new Set([
  '分',
  '分鐘',
  'min',
  '秒',
  'sec',
  's',
  '小時',
  'hr',
  'h',
  'km',
  '公里',
  'm',
  '公尺',
]);

/**
 * 彙整單日訓練紀錄摘要（傳入同一天的紀錄陣列）
 * @param {Array<object>} logs 同一天的訓練紀錄陣列
 * @returns {{
 *   date: string,
 *   logs: Array<object>,
 *   bodyParts: string[],
 *   equipmentCount: number,
 *   totalSets: number,
 *   totalReps: number,
 *   totalVolumeKg: number,
 *   cardio: Array<{ name: string, unit: string, total: number }>
 * }}
 */
export function summarizeDay(logs) {
  const validLogs = Array.isArray(logs)
    ? logs.filter((l) => l && typeof l === 'object')
    : [];

  if (validLogs.length === 0) {
    return {
      date: '',
      logs: [],
      bodyParts: [],
      equipmentCount: 0,
      totalSets: 0,
      totalReps: 0,
      totalVolumeKg: 0,
      cardio: [],
    };
  }

  // 依 createdAt 由舊到新排序（不修改原陣列）
  const sortedLogs = [...validLogs].sort((a, b) =>
    (a?.createdAt || '').localeCompare(b?.createdAt || '')
  );

  const date = sortedLogs[0]?.date || '';
  const partSet = new Set();
  const equipmentIds = new Set();
  const cardioMap = new Map();

  let totalSets = 0;
  let totalReps = 0;
  let volumeKgSum = 0;

  for (const log of sortedLogs) {
    if (log.equipmentId) {
      equipmentIds.add(log.equipmentId);
    }

    if (Array.isArray(log.bodyParts)) {
      for (const rawPart of log.bodyParts) {
        const part = typeof rawPart === 'string' ? rawPart.trim() : '';
        if (part) partSet.add(part);
      }
    }

    // 沿用 summarizeLog 計算單筆組數與總次數
    const logSummary = summarizeLog(log);
    totalSets += logSummary.setCount;
    totalReps += logSummary.totalReps;

    const sets = Array.isArray(log.sets) ? log.sets : [];
    const fields = Array.isArray(log.fields) ? log.fields : [];
    const trackReps = log.trackReps !== false;

    const kgFields = fields.filter(
      (f) => f && f.key && String(f.unit ?? '').trim().toLowerCase() === 'kg'
    );
    const cardioFields = fields.filter(
      (f) => f && f.key && CARDIO_UNITS.has(String(f.unit ?? '').trim().toLowerCase())
    );

    for (const set of sets) {
      if (!set || typeof set !== 'object') continue;
      const values = set.values && typeof set.values === 'object' ? set.values : {};

      // 只計算 trackReps 為真且單位為 kg 的訓練量
      if (trackReps && kgFields.length > 0) {
        const reps = toFiniteNumber(set.reps);
        if (reps !== null) {
          for (const field of kgFields) {
            const weight = toFiniteNumber(values[field.key]);
            if (weight !== null) {
              volumeKgSum += weight * reps;
            }
          }
        }
      }

      // 彙整時間／距離類欄位，依 name+unit 合併並保留首次出現順序
      for (const field of cardioFields) {
        const val = toFiniteNumber(values[field.key]);
        if (val === null) continue;
        const name = String(field.name ?? '').trim();
        const unit = String(field.unit ?? '').trim();
        const mapKey = `${name}\0${unit.toLowerCase()}`;
        if (!cardioMap.has(mapKey)) {
          cardioMap.set(mapKey, { name, unit, total: 0 });
        }
        cardioMap.get(mapKey).total += val;
      }
    }
  }

  // 部位依 BODY_PARTS 預設順序排列，自訂部位排在後面
  const bodyParts = Array.from(partSet).sort((a, b) => {
    const idxA = BODY_PARTS.indexOf(a);
    const idxB = BODY_PARTS.indexOf(b);
    const inDefaultA = idxA !== -1;
    const inDefaultB = idxB !== -1;

    if (inDefaultA && inDefaultB) return idxA - idxB;
    if (inDefaultA) return -1;
    if (inDefaultB) return 1;
    return a.localeCompare(b, 'zh-Hant');
  });

  const roundedVolumeKg = Math.round(volumeKgSum * 10) / 10;
  const totalVolumeKg = Object.is(roundedVolumeKg, -0) ? 0 : roundedVolumeKg;

  const cardio = Array.from(cardioMap.values()).map((item) => {
    const roundedTotal = Math.round(item.total * 100) / 100;
    return {
      name: item.name,
      unit: item.unit,
      total: Object.is(roundedTotal, -0) ? 0 : roundedTotal,
    };
  });

  return {
    date,
    logs: sortedLogs,
    bodyParts,
    equipmentCount: equipmentIds.size,
    totalSets,
    totalReps,
    totalVolumeKg,
    cardio,
  };
}

/**
 * 格式化數字：加上千分位、最多保留 1 位小數並去掉多餘的 .0
 * 例：12345.0 → '12,345'、1234.56 → '1,234.6'
 * @param {number | string} n
 * @returns {string}
 */
export function formatNumber(n) {
  const num = toFiniteNumber(n);
  if (num === null) return '0';

  const rounded = (Math.sign(num) * Math.round(Math.abs(num) * 10)) / 10;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  const fixed = normalized.toFixed(1).replace(/\.0$/, '');
  const [intPart, decPart] = fixed.split('.');
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return decPart ? `${formattedInt}.${decPart}` : formattedInt;
}

/**
 * 1:1 正方形分享圖（1080×1080）版面量測與分頁常數
 */
export const SHARE_METRICS = Object.freeze({
  size: 1080,
  pad: 56,
  gap: 20,
  footerH: 56,
  headerOtherH: 92, // 第 2 張以後的頁首（日期小字＋右上「2/3」）
  // 第 1 張頁首 = dateH + gap + tagsH(標籤列數 × tagRowH) + gap + statsH + (有 cardio ? cardioH : 0) + gap
  dateH: 100,
  tagRowH: 52,
  tagCharW: 28,
  tagPadW: 44,
  tagGap: 12,
  statsH: 120,
  cardioH: 44,
  normal: Object.freeze({
    cols: 1,
    padY: 22,
    titleH: 50,
    rowH: 44,
    noteLineH: 36,
    noteMaxLines: 2,
    noteCharsPerLine: 34,
    setsPerRow: 1,
  }),
  compact: Object.freeze({
    cols: 2,
    padY: 16,
    titleH: 44,
    rowH: 38,
    noteLineH: 32,
    noteMaxLines: 1,
    noteCharsPerLine: 16,
    setsPerRow: 2,
  }),
});

/**
 * 判斷單組欄位值或次數是否為空值
 * @param {unknown} val
 * @returns {boolean}
 */
function isEmptySetValue(val) {
  if (val === undefined || val === null) return true;
  if (typeof val === 'string' && val.trim() === '') return true;
  return false;
}

/**
 * 計算緊湊模式下的單組文字
 * - 只有 1 個欄位且記錄次數：省略單位，例如 '80×12'
 * - 其他情況：各欄位以「值+單位」空白連接（例如 '6km/h 1% 5分'），若記錄次數再加 ' ×12'
 * - 空值略過
 * @param {{ reps?: number | string, values?: Record<string, any> }} set
 * @param {Array<{ key: string, name?: string, unit?: string }>} [fields=[]]
 * @param {boolean} [trackReps=true]
 * @returns {string}
 */
export function compactSetText(set, fields = [], trackReps = true) {
  if (!set || typeof set !== 'object') return '';

  const fieldList = Array.isArray(fields)
    ? fields.filter((f) => f && f.key)
    : [];
  const values = set.values && typeof set.values === 'object' ? set.values : {};
  const useReps = trackReps !== false;
  const hasReps = useReps && !isEmptySetValue(set.reps);

  // 只有 1 個欄位且記錄次數時，單位已標示於卡片標題旁，直接輸出 '80×12'
  if (fieldList.length === 1 && useReps) {
    const val = values[fieldList[0].key];
    const hasVal = !isEmptySetValue(val);
    if (hasVal && hasReps) return `${val}×${set.reps}`;
    if (hasVal) return String(val);
    if (hasReps) return `${set.reps}下`;
    return '';
  }

  const parts = [];
  for (const field of fieldList) {
    const val = values[field.key];
    if (isEmptySetValue(val)) continue;
    const unit = String(field.unit ?? '').trim();
    parts.push(unit ? `${val}${unit}` : String(val));
  }

  if (hasReps) {
    if (parts.length > 0) {
      return `${parts.join(' ')} ×${set.reps}`;
    }
    return `${set.reps}下`;
  }

  return parts.join(' ');
}

/**
 * 估計分享圖訓練部位標籤所佔列數
 * 每個標籤寬 = 字數 × tagCharW + tagPadW，標籤間加 tagGap，超過可用寬（size − 2×pad）則換列；無部位回傳 0。
 * @param {string[]} bodyParts
 * @param {typeof SHARE_METRICS} [metrics=SHARE_METRICS]
 * @returns {number}
 */
export function shareTagRows(bodyParts, metrics = SHARE_METRICS) {
  const tags = Array.isArray(bodyParts)
    ? bodyParts
        .map((p) => (typeof p === 'string' ? p.trim() : ''))
        .filter(Boolean)
    : [];
  if (tags.length === 0) return 0;

  const maxW = metrics.size - 2 * metrics.pad;
  let rows = 1;
  let lineW = 0;

  for (const tag of tags) {
    const charCount = Array.from(tag).length;
    const tagW = charCount * metrics.tagCharW + metrics.tagPadW;
    if (lineW === 0) {
      lineW = tagW;
    } else if (lineW + metrics.tagGap + tagW <= maxW) {
      lineW += metrics.tagGap + tagW;
    } else {
      rows += 1;
      lineW = tagW;
    }
  }

  return rows;
}

/**
 * 計算第 1 張分享圖的頁首高度
 * 公式：dateH + gap + tagsH(標籤列數 × tagRowH) + gap + statsH + (有 cardio ? cardioH : 0) + gap
 * @param {object} daySummary 當日摘要物件（由 summarizeDay 產生）
 * @param {typeof SHARE_METRICS} [metrics=SHARE_METRICS]
 * @returns {number}
 */
export function firstHeaderHeight(daySummary, metrics = SHARE_METRICS) {
  const tagRows = shareTagRows(daySummary?.bodyParts, metrics);
  const tagsH = tagRows * metrics.tagRowH;
  const hasCardio =
    Array.isArray(daySummary?.cardio) && daySummary.cardio.length > 0;

  return (
    metrics.dateH +
    metrics.gap +
    tagsH +
    metrics.gap +
    metrics.statsH +
    (hasCardio ? metrics.cardioH : 0) +
    metrics.gap
  );
}

/**
 * 計算單筆紀錄在指定版面模式下的排版資訊（每列組數、總列數、備註列數與固定區塊高度）
 * @param {object} log
 * @param {'normal' | 'compact'} mode
 * @param {typeof SHARE_METRICS} metrics
 * @returns {{ perRow: number, totalRows: number, noteLines: number, baseH: number, fullH: number, setCount: number }}
 */
function getCardLayoutMeta(log, mode, metrics) {
  const cfg = mode === 'compact' ? metrics.compact : metrics.normal;
  const sets = Array.isArray(log?.sets) ? log.sets : [];
  const fields = Array.isArray(log?.fields) ? log.fields : [];

  // compact 且欄位數 ≤ 1 時每列排 setsPerRow（2）組，其餘皆為每列 1 組
  const perRow =
    mode === 'compact' && fields.length <= 1 ? cfg.setsPerRow : 1;
  const totalRows = Math.ceil(sets.length / perRow);

  const note = typeof log?.note === 'string' ? log.note.trim() : '';
  const noteChars = Array.from(note).length;
  const noteLines =
    noteChars === 0
      ? 0
      : Math.min(cfg.noteMaxLines, Math.ceil(noteChars / cfg.noteCharsPerLine));

  const baseH = 2 * cfg.padY + cfg.titleH + noteLines * cfg.noteLineH;
  const fullH = baseH + totalRows * cfg.rowH;

  return {
    perRow,
    totalRows,
    noteLines,
    baseH,
    fullH,
    setCount: sets.length,
  };
}

/**
 * 估算單張器材卡片高度
 * 公式：2×padY + titleH + 列數×rowH + 備註列數×noteLineH
 * @param {object} log 訓練紀錄
 * @param {'normal' | 'compact'} [mode='normal'] 排版模式
 * @param {typeof SHARE_METRICS} [metrics=SHARE_METRICS]
 * @returns {number}
 */
export function estimateCardHeight(
  log,
  mode = 'normal',
  metrics = SHARE_METRICS
) {
  return getCardLayoutMeta(log, mode, metrics).fullH;
}

/**
 * 規劃 1:1 正方形分享圖的排版模式（normal / compact）與各頁卡片座標
 * @param {object} daySummary 當日摘要物件（由 summarizeDay 產生）
 * @param {typeof SHARE_METRICS} [metrics=SHARE_METRICS]
 * @returns {{
 *   mode: 'normal' | 'compact',
 *   pages: Array<{
 *     pageNo: number,
 *     total: number,
 *     hasSummary: boolean,
 *     bodyTop: number,
 *     bodyH: number,
 *     cards: Array<{
 *       logIndex: number,
 *       col: number,
 *       x: number,
 *       y: number,
 *       w: number,
 *       h: number,
 *       rowsShown: number,
 *       totalRows: number,
 *       hiddenSets: number
 *     }>
 *   }>
 * }}
 */
export function planSharePages(daySummary, metrics = SHARE_METRICS) {
  const logs = Array.isArray(daySummary?.logs) ? daySummary.logs : [];
  const W = metrics.size - 2 * metrics.pad;
  const firstBodyTop = metrics.pad + firstHeaderHeight(daySummary, metrics);
  const firstBodyH =
    metrics.size - metrics.pad - metrics.footerH - firstBodyTop;

  // 空陣列回傳 1 張只有總結的空白頁
  if (logs.length === 0) {
    return {
      mode: 'normal',
      pages: [
        {
          pageNo: 1,
          total: 1,
          hasSummary: true,
          bodyTop: firstBodyTop,
          bodyH: firstBodyH,
          cards: [],
        },
      ],
    };
  }

  // 1. 先嘗試 normal 單欄模式：若全部卡片可放入第 1 張則直接回傳
  const normalCards = [];
  let cursorY = firstBodyTop;
  let fitsNormal = true;

  for (let i = 0; i < logs.length; i++) {
    const meta = getCardLayoutMeta(logs[i], 'normal', metrics);
    const y = i === 0 ? cursorY : cursorY + metrics.gap;
    if (y + meta.fullH > firstBodyTop + firstBodyH) {
      fitsNormal = false;
      break;
    }
    normalCards.push({
      logIndex: i,
      col: 0,
      x: metrics.pad,
      y,
      w: W,
      h: meta.fullH,
      rowsShown: meta.totalRows,
      totalRows: meta.totalRows,
      hiddenSets: 0,
    });
    cursorY = y + meta.fullH;
  }

  if (fitsNormal) {
    return {
      mode: 'normal',
      pages: [
        {
          pageNo: 1,
          total: 1,
          hasSummary: true,
          bodyTop: firstBodyTop,
          bodyH: firstBodyH,
          cards: normalCards,
        },
      ],
    };
  }

  // 2. 否則採用 compact 兩欄模式，必要時自動分頁與截斷超長組數
  const cw = (W - metrics.gap) / 2;
  const colX = [metrics.pad, metrics.pad + cw + metrics.gap];
  const otherBodyTop = metrics.pad + metrics.headerOtherH;
  const otherBodyH =
    metrics.size - metrics.pad - metrics.footerH - otherBodyTop;
  const compactCfg = metrics.compact;

  const pages = [];

  /** 建立新頁並回傳頁面與雙欄已用高度狀態 */
  function createPage(hasSummary) {
    const bodyTop = hasSummary ? firstBodyTop : otherBodyTop;
    const bodyH = hasSummary ? firstBodyH : otherBodyH;
    const page = {
      pageNo: pages.length + 1,
      total: 0,
      hasSummary,
      bodyTop,
      bodyH,
      cards: [],
    };
    pages.push(page);
    return { page, colUsed: [0, 0] };
  }

  let current = createPage(true);

  for (let i = 0; i < logs.length; i++) {
    const meta = getCardLayoutMeta(logs[i], 'compact', metrics);

    /** 檢查指定欄位在目前頁面上是否放得下完整卡片 */
    const canFitInCol = (state, col) => {
      const used = state.colUsed[col];
      const nextUsed = used === 0 ? meta.fullH : used + metrics.gap + meta.fullH;
      return nextUsed <= state.page.bodyH;
    };

    // 先依規則選擇目前高度較低的那欄（同高選 col 0），放不下再試另一欄
    const primaryCol = current.colUsed[0] <= current.colUsed[1] ? 0 : 1;
    const otherCol = 1 - primaryCol;

    let targetCol = -1;
    if (canFitInCol(current, primaryCol)) {
      targetCol = primaryCol;
    } else if (canFitInCol(current, otherCol)) {
      targetCol = otherCol;
    } else if (current.page.cards.length > 0) {
      // 目前頁兩欄皆放不下且已有其他卡片 → 開新一頁（hasSummary: false）
      current = createPage(false);
      if (canFitInCol(current, 0)) {
        targetCol = 0;
      }
    }

    if (targetCol !== -1) {
      const used = current.colUsed[targetCol];
      const y =
        current.page.bodyTop + (used === 0 ? 0 : used + metrics.gap);
      current.page.cards.push({
        logIndex: i,
        col: targetCol,
        x: colX[targetCol],
        y,
        w: cw,
        h: meta.fullH,
        rowsShown: meta.totalRows,
        totalRows: meta.totalRows,
        hiddenSets: 0,
      });
      current.colUsed[targetCol] =
        used === 0 ? meta.fullH : used + metrics.gap + meta.fullH;
      continue;
    }

    // 單張卡片比一整頁 bodyH 還高 → 截斷組數並保留 1 列顯示「…另 N 組」
    const availForRows = current.page.bodyH - meta.baseH;
    const maxTotalRows = Math.floor(availForRows / compactCfg.rowH);
    let rowsShown = meta.totalRows;
    let hiddenSets = 0;
    let cardH = meta.fullH;

    if (meta.totalRows > 1) {
      rowsShown = Math.max(1, Math.min(meta.totalRows - 1, maxTotalRows - 1));
      hiddenSets = Math.max(0, meta.setCount - rowsShown * meta.perRow);
      cardH = meta.baseH + (rowsShown + 1) * compactCfg.rowH;
    }

    current.page.cards.push({
      logIndex: i,
      col: 0,
      x: colX[0],
      y: current.page.bodyTop,
      w: cw,
      h: cardH,
      rowsShown,
      totalRows: meta.totalRows,
      hiddenSets,
    });
    current.colUsed[0] = cardH;
  }

  // 回填總頁數
  const totalPages = pages.length;
  for (const page of pages) {
    page.total = totalPages;
  }

  return {
    mode: 'compact',
    pages,
  };
}
