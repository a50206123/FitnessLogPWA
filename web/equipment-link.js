/**
 * 健身記錄 PWA 器材連動與紀錄遷移純邏輯模組（不碰 DOM／localStorage）
 */

// 判斷單一數值是否為有效非空值（0 視為有效值）
function hasValue(val) {
  if (val === '' || val === null || val === undefined) return false;
  if (typeof val === 'string') return val.trim() !== '';
  if (typeof val === 'number') return Number.isFinite(val);
  return true;
}

// 判斷次數 reps 是否為有效數字
function hasRepsValue(val) {
  return hasValue(val) && Number.isFinite(Number(val));
}

// 正規化並拷貝欄位定義
function cloneField(field, extra) {
  const base = {
    key: String(field.key),
    name: String(field.name ?? '').trim(),
    unit: String(field.unit ?? '').trim(),
  };
  return extra ? { ...base, ...extra } : base;
}

// 拷貝組數陣列與各組 values
function cloneSets(sets) {
  if (!Array.isArray(sets)) return [];
  return sets.map((s) => {
    if (!s || typeof s !== 'object') return { values: {} };
    const values = s.values && typeof s.values === 'object' ? { ...s.values } : {};
    return { ...s, values };
  });
}

// 檢查組數中是否有任一組在指定欄位有值
function hasFieldValueInSets(sets, key) {
  return Array.isArray(sets) && Boolean(key) && sets.some((s) => hasValue(s?.values?.[key]));
}

// 檢查組數中是否有任一組有次數數值
function hasAnyRepsInSets(sets) {
  return Array.isArray(sets) && sets.some((s) => hasRepsValue(s?.reps));
}

// 判斷紀錄是否屬於指定器材（有 id 比對 id，無 id 才比對名稱）
function logBelongsToEquipment(log, eq) {
  if (!log || typeof log !== 'object' || !eq || typeof eq !== 'object') return false;
  const logEqId = typeof log.equipmentId === 'string' ? log.equipmentId.trim() : '';
  const eqId = typeof eq.id === 'string' ? eq.id.trim() : '';
  if (logEqId) return Boolean(eqId) && logEqId === eqId;
  const eqName = normName(eq.name);
  return Boolean(eqName) && normName(log.equipmentName) === eqName;
}

// 依日期與建立時間由舊到新排序紀錄
function compareLogsAsc(a, b) {
  const d = String(a?.date || '').localeCompare(String(b?.date || ''));
  if (d !== 0) return d;
  const c = String(a?.createdAt || '').localeCompare(String(b?.createdAt || ''));
  if (c !== 0) return c;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

// 比較兩組字串陣列是否相同
function stringArraysEqual(a, b) {
  const la = Array.isArray(a) ? a : [];
  const lb = Array.isArray(b) ? b : [];
  return la.length === lb.length && la.every((v, i) => v === lb[i]);
}

// 比較兩組欄位定義陣列是否相同
function fieldsEqual(a, b) {
  const la = Array.isArray(a) ? a : [];
  const lb = Array.isArray(b) ? b : [];
  if (la.length !== lb.length) return false;
  return la.every((fa, i) => {
    const fb = lb[i];
    return Boolean(
      fa && fb &&
      fa.key === fb.key &&
      String(fa.name ?? '') === String(fb.name ?? '') &&
      String(fa.unit ?? '') === String(fb.unit ?? '')
    );
  });
}

// 比較兩組組數陣列是否相同
function setsEqual(a, b) {
  const la = Array.isArray(a) ? a : [];
  const lb = Array.isArray(b) ? b : [];
  if (la.length !== lb.length) return false;
  return la.every((sa = {}, i) => {
    const sb = lb[i] || {};
    if (sa.reps !== sb.reps) return false;
    const va = sa.values && typeof sa.values === 'object' ? sa.values : {};
    const vb = sb.values && typeof sb.values === 'object' ? sb.values : {};
    const ka = Object.keys(va);
    return ka.length === Object.keys(vb).length && ka.every((k) => k in vb && va[k] === vb[k]);
  });
}

// 建立空白組（trackReps=false 時不含 reps）
export function blankSet(fields = [], trackReps = true) {
  const values = {};
  if (Array.isArray(fields)) {
    for (const field of fields) {
      if (field && field.key) values[field.key] = '';
    }
  }
  return trackReps === false ? { values } : { reps: '', values };
}

// 正規化名稱（去頭尾空白並轉小寫）
export function normName(s) {
  return typeof s === 'string' ? s.trim().toLowerCase() : '';
}

// 為紀錄找對應器材：先用 equipmentId，找不到再以名稱比對
export function findEquipmentForLog(log, equipmentList) {
  if (!log || typeof log !== 'object' || !Array.isArray(equipmentList)) return null;
  const eqId = typeof log.equipmentId === 'string' ? log.equipmentId.trim() : '';
  if (eqId) {
    const byId = equipmentList.find(
      (eq) => eq && typeof eq.id === 'string' && eq.id.trim() === eqId
    );
    if (byId) return byId;
  }
  const targetName = normName(log.equipmentName);
  if (targetName) {
    const byName = equipmentList.find((eq) => eq && normName(eq.name) === targetName);
    if (byName) return byName;
  }
  return null;
}

// 產生供畫面顯示的紀錄檢視物件（不修改原物件，附 _resolved: true）
export function resolveLogView(log, equipmentList) {
  if (!log || typeof log !== 'object') return log;

  const eq = findEquipmentForLog(log, equipmentList);
  if (!eq) {
    return {
      ...log,
      bodyParts: Array.isArray(log.bodyParts) ? [...log.bodyParts] : [],
      fields: Array.isArray(log.fields)
        ? log.fields.filter((f) => f && f.key).map((f) => ({ ...f }))
        : [],
      _resolved: true,
    };
  }

  const resolvedFields = [];
  const seenKeys = new Set();
  for (const f of Array.isArray(eq.fields) ? eq.fields : []) {
    if (!f || !f.key || seenKeys.has(f.key)) continue;
    seenKeys.add(f.key);
    resolvedFields.push(cloneField(f));
  }

  // 補上紀錄裡仍有值的已刪除舊欄位
  for (const lf of Array.isArray(log.fields) ? log.fields : []) {
    if (!lf || !lf.key || seenKeys.has(lf.key)) continue;
    if (hasFieldValueInSets(log.sets, lf.key)) {
      seenKeys.add(lf.key);
      resolvedFields.push(cloneField(lf, { orphan: true }));
    }
  }

  return {
    ...log,
    equipmentId: eq.id,
    equipmentName: eq.name,
    bodyParts: Array.isArray(eq.bodyParts) ? [...eq.bodyParts] : [],
    fields: resolvedFields,
    trackReps: eq.trackReps !== false || hasAnyRepsInSets(log.sets),
    _resolved: true,
  };
}

// 找出缺 equipmentId 或 id 失效但名稱對應得到器材的舊紀錄，回傳補好 id 的新物件陣列
export function migrateLegacyLogs(logs, equipmentList) {
  if (!Array.isArray(logs) || !Array.isArray(equipmentList) || equipmentList.length === 0) {
    return [];
  }

  const validIds = new Set();
  const byName = new Map();
  for (const eq of equipmentList) {
    if (!eq || typeof eq !== 'object') continue;
    const id = typeof eq.id === 'string' ? eq.id.trim() : '';
    if (id) validIds.add(id);
    const key = normName(eq.name);
    if (key && id && !byName.has(key)) byName.set(key, eq);
  }

  const migrated = [];
  for (const log of logs) {
    if (!log || typeof log !== 'object') continue;
    const eqId = typeof log.equipmentId === 'string' ? log.equipmentId.trim() : '';
    if (eqId && validIds.has(eqId)) continue;
    const matched = byName.get(normName(log.equipmentName));
    if (matched) migrated.push({ ...log, equipmentId: matched.id });
  }
  return migrated;
}

// 正規化器材欄位陣列
function normalizeFields(fields) {
  return Array.isArray(fields)
    ? fields.filter((f) => f && f.key).map((f) => cloneField(f))
    : [];
}

// 比較器材修改前後差異（欄位以 key 比對）
export function diffEquipment(oldEq, newEq) {
  const oldFields = normalizeFields(oldEq?.fields);
  const newFields = normalizeFields(newEq?.fields);
  const oldMap = new Map(oldFields.map((f) => [f.key, f]));
  const newMap = new Map(newFields.map((f) => [f.key, f]));
  const renamedFields = [];
  const unitChanged = [];
  const removedFields = [];
  const addedFields = [];

  for (const ofield of oldFields) {
    const nfield = newMap.get(ofield.key);
    if (!nfield) {
      removedFields.push({ key: ofield.key, name: ofield.name, unit: ofield.unit });
      continue;
    }
    if (ofield.name !== nfield.name) {
      renamedFields.push({ key: ofield.key, from: ofield.name, to: nfield.name });
    }
    if (ofield.unit !== nfield.unit) {
      unitChanged.push({
        key: ofield.key,
        name: nfield.name || ofield.name,
        fromUnit: ofield.unit,
        toUnit: nfield.unit,
      });
    }
  }

  for (const nfield of newFields) {
    if (!oldMap.has(nfield.key)) {
      addedFields.push({ key: nfield.key, name: nfield.name, unit: nfield.unit });
    }
  }

  return {
    nameChanged: String(oldEq?.name ?? '').trim() !== String(newEq?.name ?? '').trim(),
    renamedFields,
    unitChanged,
    removedFields,
    addedFields,
    repsTurnedOff: oldEq?.trackReps !== false && newEq?.trackReps === false,
  };
}

// 蒐集各組中指定取值函式有值的項目（setNo 從 1 起）
function collectSetValues(sets, getter, checker) {
  const values = [];
  for (let s = 0; s < sets.length; s++) {
    const val = getter(sets[s]);
    if (checker(val)) values.push({ setNo: s + 1, value: val });
  }
  return values;
}

// 找出受器材變更影響的歷史紀錄衝突（依 date、logNo 排序）
export function findEquipmentConflicts(oldEq, newEq, logs) {
  if (!oldEq || !newEq || !Array.isArray(logs) || logs.length === 0) return [];

  const diff = diffEquipment(oldEq, newEq);
  if (!diff.removedFields.length && !diff.unitChanged.length && !diff.repsTurnedOff) {
    return [];
  }

  const matchedLogs = logs
    .filter((log) => logBelongsToEquipment(log, oldEq))
    .sort(compareLogsAsc);
  const conflicts = [];

  for (let i = 0; i < matchedLogs.length; i++) {
    const log = matchedLogs[i];
    const logNo = i + 1;
    const logId = log.id;
    const date = log.date || '';
    const sets = Array.isArray(log.sets) ? log.sets : [];

    const addConflict = (type, fieldKey, fieldName, fromUnit, toUnit, values, actions) => {
      if (values.length === 0) return;
      conflicts.push({
        id: `${logId}:${fieldKey}`,
        type,
        logId,
        date,
        logNo,
        fieldKey,
        fieldName,
        fromUnit,
        toUnit,
        values,
        actions,
        defaultAction: 'keep',
      });
    };

    for (const rf of diff.removedFields) {
      const values = collectSetValues(sets, (st) => st?.values?.[rf.key], hasValue);
      addConflict('removed', rf.key, rf.name, rf.unit, '', values, ['keep', 'map', 'delete']);
    }

    for (const uf of diff.unitChanged) {
      const values = collectSetValues(sets, (st) => st?.values?.[uf.key], hasValue);
      addConflict('unit', uf.key, uf.name, uf.fromUnit, uf.toUnit, values, ['keep', 'map', 'delete']);
    }

    if (diff.repsTurnedOff) {
      const values = collectSetValues(sets, (st) => st?.reps, hasRepsValue);
      addConflict('reps', '__reps', '次數', '下', '', values, ['keep', 'delete']);
    }
  }

  return conflicts;
}

// 套用器材變更與衝突方案至歷史紀錄，只回傳有變更的新物件陣列
export function applyEquipmentChange(oldEq, newEq, logs, resolutions = {}, now = new Date()) {
  if (!oldEq || !newEq || !Array.isArray(logs) || logs.length === 0) return [];

  const resMap = resolutions && typeof resolutions === 'object' ? resolutions : {};
  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();
  const newEqId = newEq.id || oldEq.id || '';
  const newName = String(newEq.name ?? '');
  const newBodyParts = Array.isArray(newEq.bodyParts) ? [...newEq.bodyParts] : [];
  const newTrackReps = newEq.trackReps !== false;
  const newEqFields = normalizeFields(newEq.fields);
  const oldEqFields = normalizeFields(oldEq.fields);

  const newFieldMap = new Map(newEqFields.map((f) => [f.key, f]));
  const oldFieldMap = new Map(oldEqFields.map((f) => [f.key, f]));
  const conflictsByLogId = new Map();

  for (const conflict of findEquipmentConflicts(oldEq, newEq, logs)) {
    if (!conflictsByLogId.has(conflict.logId)) conflictsByLogId.set(conflict.logId, []);
    conflictsByLogId.get(conflict.logId).push(conflict);
  }

  const updatedLogs = [];

  for (const log of logs) {
    if (!logBelongsToEquipment(log, oldEq)) continue;

    const newSets = cloneSets(log.sets);
    const logConflicts = conflictsByLogId.get(log.id) || [];
    const keptOrphanMap = new Map();

    for (const conflict of logConflicts) {
      const res = resMap[conflict.id];
      const action = res?.action || conflict.defaultAction || 'keep';

      if (conflict.type === 'reps') {
        if (action === 'delete') {
          for (const set of newSets) {
            if ('reps' in set || hasValue(set.reps)) set.reps = '';
          }
        }
        continue;
      }

      const key = conflict.fieldKey;
      const srcDef = oldFieldMap.get(key) || {
        key, name: conflict.fieldName, unit: conflict.fromUnit,
      };
      const isRemoved = conflict.type === 'removed';

      if (action === 'delete') {
        for (const set of newSets) delete set.values[key];
      } else if (action === 'map') {
        const targetKey = res?.targetKey;
        if (targetKey && targetKey !== key && newFieldMap.has(targetKey)) {
          let hasUnmoved = false;
          for (const set of newSets) {
            if (hasValue(set.values[key])) {
              // 目標該組為空才搬移；已有值則不覆蓋，來源當舊欄位保留
              if (!hasValue(set.values[targetKey])) {
                set.values[targetKey] = set.values[key];
                delete set.values[key];
              } else {
                hasUnmoved = true;
              }
            } else if (isRemoved) {
              delete set.values[key];
            }
          }
          if (hasUnmoved && isRemoved) keptOrphanMap.set(key, cloneField(srcDef));
        } else if (isRemoved) {
          keptOrphanMap.set(key, cloneField(srcDef));
        }
      } else if (isRemoved) {
        keptOrphanMap.set(key, cloneField(srcDef));
      }
    }

    // 組合最終欄位：新器材欄位 ＋ 被保留的已刪除欄位 ＋ 原本即存在的有值舊欄位
    const finalFields = newEqFields.map((f) => ({ ...f }));
    const seenKeys = new Set(finalFields.map((f) => f.key));

    for (const orphan of keptOrphanMap.values()) {
      if (!seenKeys.has(orphan.key)) {
        seenKeys.add(orphan.key);
        finalFields.push({ ...orphan });
      }
    }
    for (const lf of Array.isArray(log.fields) ? log.fields : []) {
      if (!lf || !lf.key || seenKeys.has(lf.key) || oldFieldMap.has(lf.key)) continue;
      if (hasFieldValueInSets(newSets, lf.key)) {
        seenKeys.add(lf.key);
        finalFields.push(cloneField(lf));
      }
    }

    const changed =
      (log.equipmentId || '') !== newEqId ||
      String(log.equipmentName ?? '') !== newName ||
      !stringArraysEqual(log.bodyParts, newBodyParts) ||
      (log.trackReps !== false) !== newTrackReps ||
      !fieldsEqual(log.fields, finalFields) ||
      !setsEqual(log.sets, newSets);

    if (!changed) continue;

    updatedLogs.push({
      ...log,
      equipmentId: newEqId,
      equipmentName: newName,
      bodyParts: newBodyParts,
      trackReps: newTrackReps,
      fields: finalFields,
      sets: newSets,
      updatedAt: nowIso,
    });
  }

  return updatedLogs;
}
