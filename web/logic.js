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
 * 9:16 直式分享圖（1080×1920）版面量測與分頁常數
 */
export const SHARE_METRICS = Object.freeze({
  width: 1080,
  height: 1920,
  pad: 64,
  gap: 24,
  footerH: 72,
  headerOtherH: 120, // 第 2 張以後的頁首（日期小字＋右上「2/3」）
  // 第 1 張頁首 = dateH + gap + tagsH(標籤列數 × tagRowH) + gap + statsH + (有 cardio ? cardioH : 0) + gap
  dateH: 130,
  tagRowH: 64,
  tagCharW: 34,
  tagPadW: 52,
  tagGap: 14,
  statsH: 150,
  cardioH: 56,
  normal: Object.freeze({
    cols: 1,
    padY: 28,
    titleH: 64,
    rowH: 58,
    noteLineH: 46,
    noteMaxLines: 2,
    noteCharsPerLine: 26,
    setsPerRow: 1,
  }),
  compact: Object.freeze({
    cols: 1,
    padY: 22,
    titleH: 56,
    rowH: 50,
    noteLineH: 40,
    noteMaxLines: 1,
    noteCharsPerLine: 12,
    setsPerRow: 2,
  }),
});

/** 分享圖每頁內容自動放大的最大倍率 */
const SHARE_SCALE_MAX = 1.45;

/**
 * 判斷單組欄位值或次數是否為空值
 * @param {unknown} val
 * @returns {boolean}
 */
function isEmptySetValue(val) {
  if (val === undefined || val === null) return true;
  if (typeof val === 'number' && Number.isNaN(val)) return true;
  if (typeof val === 'string' && val.trim() === '') return true;
  return false;
}

/**
 * 取得訓練紀錄的有效欄位：只保留在該筆任一組有填寫數值的欄位（維持原順序）
 * @param {object} log 訓練紀錄
 * @returns {Array<{ key: string, name?: string, unit?: string }>}
 */
export function activeFields(log) {
  const fields = Array.isArray(log?.fields) ? log.fields : [];
  const sets = Array.isArray(log?.sets) ? log.sets : [];
  if (fields.length === 0 || sets.length === 0) return [];

  return fields.filter((field) => {
    if (!field || !field.key) return false;
    return sets.some((set) => {
      if (!set || !set.values || typeof set.values !== 'object') return false;
      return !isEmptySetValue(set.values[field.key]);
    });
  });
}

/**
 * 產生分享圖器材卡片標題旁的單位標頭
 * - 記錄次數且有效欄位剛好 1 個：'{單位或欄位名} × 下'（單位空白時使用欄位名）
 * - 記錄次數且有效欄位為 0 個：'次數'
 * - 其他（非計次或有效欄位 ≥ 2 個）：''（不顯示）
 * @param {object} log 訓練紀錄
 * @returns {string}
 */
export function cardUnitHeader(log) {
  if (!log || typeof log !== 'object') return '';
  if (log.trackReps === false) return '';

  const fields = activeFields(log);
  if (fields.length === 0) return '次數';
  if (fields.length === 1) {
    const unit = String(fields[0].unit ?? '').trim();
    const name = String(fields[0].name ?? '').trim();
    const label = unit || name;
    return label ? `${label} × 下` : '次數';
  }
  return '';
}

/**
 * 將單組資料格式化為帶欄位名稱的易讀字串（供分享圖一般排版使用）
 * - 單一有效欄位且記錄次數時，沿用簡潔格式（如 '80 kg × 12 下'；無單位時補欄位名）
 * - 多欄位或非計次器材時，各欄位皆附上欄位名稱（如 '速度 6 km/h · 坡度 4 · 時間 15 分'）
 * @param {{ reps?: number | string, values?: Record<string, any> }} set
 * @param {Array<{ key: string, name?: string, unit?: string }>} [fields=[]]
 * @param {boolean} [trackReps=true]
 * @returns {string}
 */
export function formatSetLabeled(set, fields = [], trackReps = true) {
  if (!set || typeof set !== 'object') return '';

  const fieldList = Array.isArray(fields)
    ? fields.filter((f) => f && f.key)
    : [];
  const values = set.values && typeof set.values === 'object' ? set.values : {};
  const useReps = trackReps !== false;
  const showFieldName = !useReps || fieldList.length >= 2;
  const fieldParts = [];

  for (const field of fieldList) {
    const val = values[field.key];
    if (isEmptySetValue(val)) continue;
    const name = String(field.name ?? '').trim();
    const unit = String(field.unit ?? '').trim();

    if (showFieldName) {
      if (name && unit) {
        fieldParts.push(`${name} ${val} ${unit}`);
      } else if (name) {
        fieldParts.push(`${name} ${val}`);
      } else if (unit) {
        fieldParts.push(`${val} ${unit}`);
      } else {
        fieldParts.push(String(val));
      }
    } else if (unit) {
      fieldParts.push(`${val} ${unit}`);
    } else if (name) {
      fieldParts.push(`${name} ${val}`);
    } else {
      fieldParts.push(String(val));
    }
  }

  const hasReps = useReps && !isEmptySetValue(set.reps);
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
 * 計算緊湊模式下的單組文字（fields 傳有效欄位）
 * - 1 個有效欄位且記錄次數：輸出 '80×12'
 * - 0 個有效欄位且記錄次數：輸出 '20 下'
 * - 其他：每個有值的欄位為 '{欄位名} {值}{單位}'，以 ' · ' 連接，若記錄次數再加 ' × 12 下'
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

  // 1 個有效欄位且記錄次數時，單位已標示於卡片標題旁，直接輸出 '80×12'
  if (fieldList.length === 1 && useReps) {
    const val = values[fieldList[0].key];
    const hasVal = !isEmptySetValue(val);
    if (hasVal && hasReps) return `${val}×${set.reps}`;
    if (hasVal) return String(val);
    if (hasReps) return `${set.reps} 下`;
    return '';
  }

  // 0 個有效欄位且記錄次數時，直接輸出 '20 下'
  if (fieldList.length === 0 && useReps) {
    return hasReps ? `${set.reps} 下` : '';
  }

  // 其他情況（非計次或 ≥2 欄位）：各欄位以 '{欄位名} {值}{單位}' 呈現並以 ' · ' 連接
  const parts = [];
  for (const field of fieldList) {
    const val = values[field.key];
    if (isEmptySetValue(val)) continue;
    const name = String(field.name ?? '').trim();
    const unit = String(field.unit ?? '').trim();
    const valWithUnit = unit ? `${val}${unit}` : String(val);
    parts.push(name ? `${name} ${valWithUnit}` : valWithUnit);
  }

  if (hasReps) {
    if (parts.length > 0) {
      return `${parts.join(' · ')} × ${set.reps} 下`;
    }
    return `${set.reps} 下`;
  }

  return parts.join(' · ');
}

/**
 * 計算分享圖卡片每列顯示的組數
 * - normal 模式恆為 1
 * - compact 模式：有效欄位 ≤ 1 個時為 3，否則為 1
 * @param {object} log 訓練紀錄
 * @param {'normal' | 'compact'} [mode='normal'] 排版模式
 * @returns {number}
 */
export function setsPerRowFor(log, mode = 'normal') {
  if (mode !== 'compact') return 1;
  return activeFields(log).length <= 1 ? 3 : 1;
}

/**
 * 估計分享圖訓練部位標籤所佔列數
 * 每個標籤寬 = 字數 × tagCharW + tagPadW，標籤間加 tagGap，超過可用寬（width − 2×pad）則換列；無部位回傳 0。
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

  const maxW = metrics.width - 2 * metrics.pad;
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

  // 依 setsPerRowFor 與有效欄位決定每列組數（normal 恆為 1；compact 有效欄位 ≤ 1 為 3，否則 1）
  const perRow = setsPerRowFor(log, mode);
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
 * 公式：2×padY + titleH + 列數×rowH + 備註列數×noteLineH（列數依 setsPerRowFor 與有效欄位計算）
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
 * 依單頁可用高度計算縮放倍率（clamp 1~1.45），並產出放大後的卡片座標與高度
 * 卡片的 padY、titleH、rowH、noteLineH 與卡片間 gap 皆乘上 scale（故卡片總高 = 未縮放高 × scale）
 * @param {Array<{
 *   logIndex: number,
 *   unscaledH: number,
 *   rowsShown: number,
 *   totalRows: number,
 *   hiddenSets: number,
 *   setsPerRow: number
 * }>} rawCards
 * @param {number} bodyTop
 * @param {number} bodyH
 * @param {number} cardW
 * @param {typeof SHARE_METRICS} metrics
 * @returns {{ scale: number, cards: Array<object> }}
 */
function scalePageCards(rawCards, bodyTop, bodyH, cardW, metrics) {
  if (rawCards.length === 0) {
    return { scale: 1, cards: [] };
  }

  const totalCardsH = rawCards.reduce((sum, c) => sum + c.unscaledH, 0);
  const contentH =
    totalCardsH + Math.max(0, rawCards.length - 1) * metrics.gap;

  let scale =
    contentH > 0 ? Math.min(SHARE_SCALE_MAX, Math.max(1, bodyH / contentH)) : 1;

  const placeCards = (s) => {
    const scaledGap = metrics.gap * s;
    const placed = [];
    let cursorY = bodyTop;
    for (let i = 0; i < rawCards.length; i++) {
      const c = rawCards[i];
      const y = i === 0 ? cursorY : cursorY + scaledGap;
      const h = c.unscaledH * s;
      placed.push({
        logIndex: c.logIndex,
        x: metrics.pad,
        y,
        w: cardW,
        h,
        rowsShown: c.rowsShown,
        totalRows: c.totalRows,
        hiddenSets: c.hiddenSets,
        setsPerRow: c.setsPerRow,
      });
      cursorY = y + h;
    }
    return placed;
  };

  let cards = placeCards(scale);

  // 避免浮點數尾數誤差導致最後一張卡片下緣略微超出 bodyTop + bodyH
  const last = cards[cards.length - 1];
  if (last && last.y + last.h > bodyTop + bodyH && scale > 1) {
    const actualSpan = last.y + last.h - bodyTop;
    scale = Math.max(1, scale * (bodyH / actualSpan) - 1e-9);
    cards = placeCards(scale);
  }

  return { scale, cards };
}

/**
 * 規劃 9:16 直式分享圖的單欄排版模式（normal / compact）、每頁縮放倍率與各頁卡片座標
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
 *     scale: number,
 *     cards: Array<{
 *       logIndex: number,
 *       x: number,
 *       y: number,
 *       w: number,
 *       h: number,
 *       rowsShown: number,
 *       totalRows: number,
 *       hiddenSets: number,
 *       setsPerRow: number
 *     }>
 *   }>
 * }}
 */
export function planSharePages(daySummary, metrics = SHARE_METRICS) {
  const logs = Array.isArray(daySummary?.logs) ? daySummary.logs : [];
  const W = metrics.width - 2 * metrics.pad;
  const firstBodyTop = metrics.pad + firstHeaderHeight(daySummary, metrics);
  const firstBodyH =
    metrics.height - metrics.pad - metrics.footerH - firstBodyTop;

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
          scale: 1,
          cards: [],
        },
      ],
    };
  }

  // 1. 先嘗試 normal 單欄單頁：若全部卡片可放入第 1 張則放大填滿後回傳
  const normalRawCards = [];
  let normalUsedH = 0;
  let fitsNormal = true;

  for (let i = 0; i < logs.length; i++) {
    const meta = getCardLayoutMeta(logs[i], 'normal', metrics);
    const nextUsedH =
      normalUsedH === 0 ? meta.fullH : normalUsedH + metrics.gap + meta.fullH;
    if (nextUsedH > firstBodyH) {
      fitsNormal = false;
      break;
    }
    normalRawCards.push({
      logIndex: i,
      unscaledH: meta.fullH,
      rowsShown: meta.totalRows,
      totalRows: meta.totalRows,
      hiddenSets: 0,
      setsPerRow: meta.perRow,
    });
    normalUsedH = nextUsedH;
  }

  if (fitsNormal) {
    const { scale, cards } = scalePageCards(
      normalRawCards,
      firstBodyTop,
      firstBodyH,
      W,
      metrics
    );
    return {
      mode: 'normal',
      pages: [
        {
          pageNo: 1,
          total: 1,
          hasSummary: true,
          bodyTop: firstBodyTop,
          bodyH: firstBodyH,
          scale,
          cards,
        },
      ],
    };
  }

  // 2. 否則採用 compact 單欄模式，依序分頁並於單卡過高時截斷組數
  const otherBodyTop = metrics.pad + metrics.headerOtherH;
  const otherBodyH =
    metrics.height - metrics.pad - metrics.footerH - otherBodyTop;
  const compactCfg = metrics.compact;

  /**
   * 依序貪婪裝卡；cap 為每頁容量上限（用於頁面平衡），Infinity 表示只受 bodyH 限制
   * @param {number} cap
   * @returns {Array<object>}
   */
  function packCompact(cap) {
    const rawPages = [];

    /** 建立新頁（單欄） */
    function createRawPage(hasSummary) {
      const page = {
        hasSummary,
        bodyTop: hasSummary ? firstBodyTop : otherBodyTop,
        bodyH: hasSummary ? firstBodyH : otherBodyH,
        usedH: 0,
        rawCards: [],
      };
      rawPages.push(page);
      return page;
    }

    let current = createRawPage(true);

    for (let i = 0; i < logs.length; i++) {
      const meta = getCardLayoutMeta(logs[i], 'compact', metrics);

      // 空頁只受 bodyH 限制（避免不必要的截斷）；已有卡片時受 min(cap, bodyH) 限制
      const canFit = (page) => {
        const nextUsed =
          page.usedH === 0 ? meta.fullH : page.usedH + metrics.gap + meta.fullH;
        const limit = page.rawCards.length === 0 ? page.bodyH : Math.min(cap, page.bodyH);
        return nextUsed <= limit;
      };

      // 目前頁放不下且已有其他卡片 → 換新一頁（hasSummary: false）
      if (!canFit(current) && current.rawCards.length > 0) {
        current = createRawPage(false);
      }

      if (canFit(current)) {
        current.rawCards.push({
          logIndex: i,
          unscaledH: meta.fullH,
          rowsShown: meta.totalRows,
          totalRows: meta.totalRows,
          hiddenSets: 0,
          setsPerRow: meta.perRow,
        });
        current.usedH =
          current.usedH === 0
            ? meta.fullH
            : current.usedH + metrics.gap + meta.fullH;
        continue;
      }

      // 單張卡片比一整頁 bodyH 還高 → 截斷組數並保留 1 列顯示「…另 N 組」
      const availForRows = current.bodyH - meta.baseH;
      const maxTotalRows = Math.floor(availForRows / compactCfg.rowH);
      let rowsShown = meta.totalRows;
      let hiddenSets = 0;
      let unscaledH = meta.fullH;

      if (meta.totalRows > 1) {
        rowsShown = Math.max(1, Math.min(meta.totalRows - 1, maxTotalRows - 1));
        hiddenSets = Math.max(0, meta.setCount - rowsShown * meta.perRow);
        unscaledH = meta.baseH + (rowsShown + 1) * compactCfg.rowH;
      }

      current.rawCards.push({
        logIndex: i,
        unscaledH,
        rowsShown,
        totalRows: meta.totalRows,
        hiddenSets,
        setsPerRow: meta.perRow,
      });
      current.usedH = unscaledH;
    }
    return rawPages;
  }

  // 先用純貪婪法求頁數 N；N > 1 時做「頁面平衡」：
  // 二分搜尋最小容量上限 C，使依序裝卡仍在 N 頁內完成，避免最後一頁只剩一張卡
  let rawPages = packCompact(Infinity);
  const pageCount = rawPages.length;
  if (pageCount > 1) {
    const sumH = logs.reduce(
      (sum, log) => sum + getCardLayoutMeta(log, 'compact', metrics).fullH,
      0
    );
    let lo = Math.floor(sumH / pageCount);
    let hi = Math.max(firstBodyH, otherBodyH);
    let best = rawPages;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const trial = packCompact(mid);
      if (trial.length <= pageCount) {
        best = trial;
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    const finalTrial = packCompact(lo);
    rawPages = finalTrial.length <= pageCount ? finalTrial : best;
  }

  // 每頁分別計算縮放倍率並回填總頁數
  const totalPages = rawPages.length;
  const pages = rawPages.map((rawPage, idx) => {
    const { scale, cards } = scalePageCards(
      rawPage.rawCards,
      rawPage.bodyTop,
      rawPage.bodyH,
      W,
      metrics
    );
    return {
      pageNo: idx + 1,
      total: totalPages,
      hasSummary: rawPage.hasSummary,
      bodyTop: rawPage.bodyTop,
      bodyH: rawPage.bodyH,
      scale,
      cards,
    };
  });

  return {
    mode: 'compact',
    pages,
  };
}

/**
 * 將訓練部位集合依 BODY_PARTS 預設順序排序，自訂部位排在後面
 * @param {Iterable<string>} parts
 * @returns {string[]}
 */
function sortBodyParts(parts) {
  return Array.from(parts).sort((a, b) => {
    const idxA = BODY_PARTS.indexOf(a);
    const idxB = BODY_PARTS.indexOf(b);
    const inDefaultA = idxA !== -1;
    const inDefaultB = idxB !== -1;

    if (inDefaultA && inDefaultB) return idxA - idxB;
    if (inDefaultA) return -1;
    if (inDefaultB) return 1;
    return a.localeCompare(b, 'zh-Hant');
  });
}

/**
 * 依日期建立訓練紀錄索引：統計每日紀錄筆數與不重複訓練部位（依 BODY_PARTS 順序）
 * @param {Array<object>} logs 訓練紀錄陣列
 * @returns {Record<string, { count: number, bodyParts: string[] }>}
 */
export function logDateIndex(logs) {
  const index = {};
  if (!Array.isArray(logs) || logs.length === 0) return index;

  const partSets = new Map();
  const counts = new Map();

  for (const log of logs) {
    if (!log || typeof log !== 'object') continue;
    const date = typeof log.date === 'string' ? log.date.trim() : '';
    if (!date) continue;

    counts.set(date, (counts.get(date) || 0) + 1);
    if (!partSets.has(date)) {
      partSets.set(date, new Set());
    }
    const set = partSets.get(date);
    if (Array.isArray(log.bodyParts)) {
      for (const rawPart of log.bodyParts) {
        const part = typeof rawPart === 'string' ? rawPart.trim() : '';
        if (part) set.add(part);
      }
    }
  }

  for (const [date, count] of counts.entries()) {
    index[date] = {
      count,
      bodyParts: sortBodyParts(partSets.get(date)),
    };
  }

  return index;
}

/**
 * 計算增減月份後的年份與月份（month 為 1~12，跨年正確）
 * @param {number} year 年份
 * @param {number} month 月份（1~12）
 * @param {number} delta 月份偏移量（可正可負）
 * @returns {{ year: number, month: number }}
 */
export function shiftMonth(year, month, delta) {
  const totalMonths = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = (((totalMonths % 12) + 12) % 12) + 1;
  return { year: nextYear, month: nextMonth };
}

/**
 * 建立月曆格線資料：週一開始，補齊前後月份使每週 7 格（4~6 週）
 * @param {number} year 年份
 * @param {number} month 月份（1~12）
 * @param {Array<object>} [logs=[]] 訓練紀錄陣列
 * @param {string} [todayStr=toDateStr()] 今天日期字串 'YYYY-MM-DD'
 * @returns {{
 *   year: number,
 *   month: number,
 *   label: string,
 *   weeks: Array<Array<{
 *     date: string,
 *     day: number,
 *     inMonth: boolean,
 *     isToday: boolean,
 *     count: number,
 *     bodyParts: string[]
 *   }>>
 * }}
 */
export function buildMonthGrid(year, month, logs = [], todayStr = toDateStr()) {
  const index = logDateIndex(logs);
  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();

  // 以週一為每週第一天（週一=0、週二=1、…、週日=6）
  const startOffset = (firstDay.getDay() + 6) % 7;
  const weekCount = Math.ceil((startOffset + daysInMonth) / 7);

  const weeks = [];
  for (let w = 0; w < weekCount; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const cellDayOffset = w * 7 + d - startOffset;
      const cellDate = new Date(year, month - 1, 1 + cellDayOffset);
      const dateStr = toDateStr(cellDate);
      const entry = index[dateStr];
      week.push({
        date: dateStr,
        day: cellDate.getDate(),
        inMonth:
          cellDate.getFullYear() === year && cellDate.getMonth() === month - 1,
        isToday: dateStr === todayStr,
        count: entry ? entry.count : 0,
        bodyParts: entry ? [...entry.bodyParts] : [],
      });
    }
    weeks.push(week);
  }

  return {
    year,
    month,
    label: `${year} 年 ${month} 月`,
    weeks,
  };
}

/**
 * 建立器材清單匯出物件（供 JSON 匯出使用）
 * @param {Array<object>} equipment 器材陣列
 * @param {Date | string | number} [now=new Date()] 匯出時間
 * @returns {{ app: string, type: string, version: number, exportedAt: string, equipment: Array<object> }}
 */
export function buildEquipmentExport(equipment, now = new Date()) {
  const exportedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const list = Array.isArray(equipment)
    ? equipment
        .filter((eq) => eq && typeof eq === 'object')
        .map((eq) => structuredClone(eq))
    : [];

  return {
    app: 'fitness-log',
    type: 'equipment',
    version: 1,
    exportedAt,
    equipment: list,
  };
}

/**
 * 將器材訓練部位正規化為不重複字串陣列（支援陣列或逗號／頓號分隔字串）
 * @param {unknown} rawBodyParts
 * @returns {string[]}
 */
function normalizeBodyParts(rawBodyParts) {
  let list = [];
  if (Array.isArray(rawBodyParts)) {
    list = rawBodyParts
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter(Boolean);
  } else if (typeof rawBodyParts === 'string') {
    list = rawBodyParts
      .split(/[,，、]/)
      .map((p) => p.trim())
      .filter(Boolean);
  }
  return Array.from(new Set(list));
}

/**
 * 解析器材匯入 JSON 文字
 * 接受：器材匯出格式、純陣列、或完整備份 { equipment, logs }。
 * JSON 錯誤或找不到器材陣列時拋出正體中文 Error；不合格筆數會略過並記錄於 errors。
 * @param {string} text JSON 文字
 * @returns {{ equipment: Array<object>, errors: string[] }}
 */
export function parseEquipmentImport(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('匯入內容不可為空白');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSON 格式錯誤，無法解析匯入檔案');
  }

  let rawList = null;
  if (Array.isArray(parsed)) {
    rawList = parsed;
  } else if (
    parsed &&
    typeof parsed === 'object' &&
    Array.isArray(parsed.equipment)
  ) {
    rawList = parsed.equipment;
  }

  if (!rawList) {
    throw new Error('找不到器材陣列（請提供器材匯出檔、完整備份或器材陣列 JSON）');
  }

  const equipment = [];
  const errors = [];

  for (let i = 0; i < rawList.length; i++) {
    const raw = rawList[i];
    const rowLabel = `第 ${i + 1} 筆`;

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`${rowLabel}：器材資料格式不正確`);
      continue;
    }

    const fields = Array.isArray(raw.fields)
      ? raw.fields.map((f) => {
          if (!f || typeof f !== 'object') {
            return { key: makeId('f_'), name: '', unit: '' };
          }
          const key =
            typeof f.key === 'string' && f.key.trim()
              ? f.key.trim()
              : makeId('f_');
          const name = typeof f.name === 'string' ? f.name.trim() : '';
          const unit = typeof f.unit === 'string' ? f.unit.trim() : '';
          return { key, name, unit };
        })
      : [];

    const normalized = {
      name: typeof raw.name === 'string' ? raw.name.trim() : '',
      bodyParts: normalizeBodyParts(raw.bodyParts),
      instructions:
        typeof raw.instructions === 'string' ? raw.instructions : '',
      trackReps:
        raw.trackReps === undefined || raw.trackReps === null
          ? true
          : Boolean(raw.trackReps),
      fields,
    };

    if (typeof raw.id === 'string' && raw.id.trim()) {
      normalized.id = raw.id.trim();
    }
    if (typeof raw.createdAt === 'string' && raw.createdAt.trim()) {
      normalized.createdAt = raw.createdAt.trim();
    }
    if (typeof raw.updatedAt === 'string' && raw.updatedAt.trim()) {
      normalized.updatedAt = raw.updatedAt.trim();
    }

    const itemErrors = validateEquipment(normalized);
    if (itemErrors.length > 0) {
      errors.push(`${rowLabel}：${itemErrors.join('；')}`);
      continue;
    }

    equipment.push(normalized);
  }

  return { equipment, errors };
}

/**
 * 合併既有器材與匯入器材清單（永不刪除既有器材）
 * - 以器材名稱比對（去空白、不分大小寫）
 * - 匯入檔內重複同名只取第一筆（其餘計入 skipped）
 * - 同名器材：mode 為 'skip' 時略過；'update' 時保留既有 id、createdAt，同名詳細項目沿用既有 key，updatedAt 設為 now
 * - 新器材：若 id 缺漏或與既有 id 衝突則改用 makeId('eq_')，並補齊 createdAt／updatedAt
 * @param {Array<object>} existing 既有器材陣列
 * @param {Array<object>} incoming 匯入器材陣列
 * @param {'skip' | 'update'} [mode='skip'] 同名處理模式
 * @param {Date | string | number} [now=new Date()] 合併時間
 * @returns {{ toSave: Array<object>, added: number, updated: number, skipped: number }}
 */
export function mergeEquipment(
  existing,
  incoming,
  mode = 'skip',
  now = new Date()
) {
  const existingList = Array.isArray(existing)
    ? existing.filter((eq) => eq && typeof eq === 'object')
    : [];
  const incomingList = Array.isArray(incoming)
    ? incoming.filter((eq) => eq && typeof eq === 'object')
    : [];
  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();

  const normKey = (str) =>
    typeof str === 'string' ? str.trim().toLowerCase() : '';

  const existingByName = new Map();
  const usedIds = new Set();

  for (const eq of existingList) {
    if (typeof eq.id === 'string' && eq.id.trim()) {
      usedIds.add(eq.id.trim());
    }
    const nameKey = normKey(eq.name);
    if (nameKey && !existingByName.has(nameKey)) {
      existingByName.set(nameKey, eq);
    }
  }

  const seenIncomingNames = new Set();
  const toSave = [];
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of incomingList) {
    const nameKey = normKey(item.name);
    if (!nameKey) {
      skipped += 1;
      continue;
    }

    // 匯入檔內重複同名只取第一筆，其餘算略過
    if (seenIncomingNames.has(nameKey)) {
      skipped += 1;
      continue;
    }
    seenIncomingNames.add(nameKey);

    const rawFields = Array.isArray(item.fields) ? item.fields : [];
    const existingEq = existingByName.get(nameKey);

    if (existingEq) {
      if (mode !== 'update') {
        skipped += 1;
        continue;
      }

      // 建立既有詳細項目的「正規化名稱 → key」對照表，同名欄位沿用既有 key
      const prevKeyByFieldName = new Map();
      if (Array.isArray(existingEq.fields)) {
        for (const pf of existingEq.fields) {
          const fk = normKey(pf?.name);
          const pk = typeof pf?.key === 'string' ? pf.key.trim() : '';
          if (fk && pk && !prevKeyByFieldName.has(fk)) {
            prevKeyByFieldName.set(fk, pk);
          }
        }
      }

      // 先保留會被沿用的既有 key，避免新欄位與之衝突
      const reservedFieldKeys = new Set();
      for (const f of rawFields) {
        const fk = normKey(f?.name);
        if (fk && prevKeyByFieldName.has(fk)) {
          reservedFieldKeys.add(prevKeyByFieldName.get(fk));
        }
      }

      const usedFieldKeys = new Set(reservedFieldKeys);
      const mergedFields = rawFields.map((f) => {
        const fieldName = typeof f?.name === 'string' ? f.name.trim() : '';
        const unit = typeof f?.unit === 'string' ? f.unit.trim() : '';
        const fk = normKey(fieldName);
        let key;

        if (fk && prevKeyByFieldName.has(fk)) {
          key = prevKeyByFieldName.get(fk);
        } else {
          const candidate = typeof f?.key === 'string' ? f.key.trim() : '';
          if (candidate && !usedFieldKeys.has(candidate)) {
            key = candidate;
          } else {
            do {
              key = makeId('f_');
            } while (usedFieldKeys.has(key));
          }
          usedFieldKeys.add(key);
        }

        return { key, name: fieldName, unit };
      });

      toSave.push({
        id: existingEq.id,
        name: typeof item.name === 'string' ? item.name.trim() : existingEq.name,
        bodyParts: normalizeBodyParts(item.bodyParts),
        instructions:
          typeof item.instructions === 'string' ? item.instructions : '',
        trackReps:
          item.trackReps === undefined || item.trackReps === null
            ? true
            : Boolean(item.trackReps),
        fields: mergedFields,
        createdAt: existingEq.createdAt || nowIso,
        updatedAt: nowIso,
      });
      updated += 1;
      continue;
    }

    // 新器材：若 id 缺漏或與既有 id 衝突則重新產生
    let id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id || usedIds.has(id)) {
      do {
        id = makeId('eq_');
      } while (usedIds.has(id));
    }
    usedIds.add(id);

    const usedFieldKeys = new Set();
    const fields = rawFields.map((f) => {
      const fieldName = typeof f?.name === 'string' ? f.name.trim() : '';
      const unit = typeof f?.unit === 'string' ? f.unit.trim() : '';
      let key = typeof f?.key === 'string' ? f.key.trim() : '';
      if (!key || usedFieldKeys.has(key)) {
        do {
          key = makeId('f_');
        } while (usedFieldKeys.has(key));
      }
      usedFieldKeys.add(key);
      return { key, name: fieldName, unit };
    });

    const createdAt =
      typeof item.createdAt === 'string' && item.createdAt.trim()
        ? item.createdAt.trim()
        : nowIso;
    const updatedAt =
      typeof item.updatedAt === 'string' && item.updatedAt.trim()
        ? item.updatedAt.trim()
        : nowIso;

    toSave.push({
      id,
      name: item.name.trim(),
      bodyParts: normalizeBodyParts(item.bodyParts),
      instructions:
        typeof item.instructions === 'string' ? item.instructions : '',
      trackReps:
        item.trackReps === undefined || item.trackReps === null
          ? true
          : Boolean(item.trackReps),
      fields,
      createdAt,
      updatedAt,
    });
    added += 1;
  }

  return { toSave, added, updated, skipped };
}
