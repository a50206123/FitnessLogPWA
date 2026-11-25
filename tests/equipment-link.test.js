import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  blankSet,
  normName,
  findEquipmentForLog,
  resolveLogView,
  migrateLegacyLogs,
  diffEquipment,
  findEquipmentConflicts,
  applyEquipmentChange,
} from '../web/equipment-link.js';

// 建立測試用器材資料的輔助函式
function makeEq(overrides = {}) {
  return {
    id: 'eq_bench',
    name: '胸推機',
    bodyParts: ['胸', '手臂'],
    trackReps: true,
    fields: [
      { key: 'f_w', name: '重量', unit: 'kg' },
      { key: 'f_seat', name: '椅高', unit: '格' },
    ],
    ...overrides,
  };
}

// 建立測試用紀錄資料的輔助函式
function makeLog(overrides = {}) {
  return {
    id: 'log_1',
    date: '2026-11-20',
    equipmentId: 'eq_bench',
    equipmentName: '胸推機',
    bodyParts: ['胸', '手臂'],
    trackReps: true,
    fields: [
      { key: 'f_w', name: '重量', unit: 'kg' },
      { key: 'f_seat', name: '椅高', unit: '格' },
    ],
    sets: [
      { reps: 12, values: { f_w: 40, f_seat: 3 } },
      { reps: 10, values: { f_w: 45, f_seat: 3 } },
    ],
    note: '',
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('blankSet', () => {
  it('trackReps 預設為 true 時回傳含 reps 與各欄位空字串的組', () => {
    const fields = [
      { key: 'f_w', name: '重量', unit: 'kg' },
      { key: 'f_s', name: '椅高', unit: '格' },
    ];
    assert.deepEqual(blankSet(fields), { reps: '', values: { f_w: '', f_s: '' } });
    assert.deepEqual(blankSet([], true), { reps: '', values: {} });
  });

  it('trackReps 為 false 時回傳不含 reps 鍵的組', () => {
    const set = blankSet([{ key: 'f_spd', name: '速度', unit: 'km/h' }], false);
    assert.deepEqual(set, { values: { f_spd: '' } });
    assert.equal('reps' in set, false);
  });
});

describe('findEquipmentForLog 與 normName', () => {
  it('normName 會去頭尾空白並轉小寫', () => {
    assert.equal(normName('  Bench Press \t\n '), 'bench press');
    assert.equal(normName(null), '');
  });

  it('以 equipmentId 優先比對（即使名稱不同仍以 id 對應）', () => {
    const eq1 = makeEq({ id: 'eq_1', name: '新名稱胸推機' });
    const eq2 = makeEq({ id: 'eq_2', name: '胸推機' });
    const log = makeLog({ equipmentId: 'eq_1', equipmentName: '胸推機' });
    assert.equal(findEquipmentForLog(log, [eq1, eq2]), eq1);
  });

  it('找不到 id 或缺 id 時改以名稱後備比對（大小寫與空白不同也對得到）', () => {
    const eq = makeEq({ id: 'eq_run', name: '  Treadmill Pro  ' });
    const noIdLog = makeLog({ equipmentId: '', equipmentName: 'treadmill pro' });
    const staleIdLog = makeLog({ equipmentId: 'eq_deleted', equipmentName: ' TREADMILL PRO ' });
    assert.equal(findEquipmentForLog(noIdLog, [eq]), eq);
    assert.equal(findEquipmentForLog(staleIdLog, [eq]), eq);
  });

  it('id 與名稱皆對不到時回傳 null', () => {
    const eq = makeEq({ id: 'eq_1', name: '滑輪下拉' });
    const log = makeLog({ equipmentId: 'eq_missing', equipmentName: '腿推機' });
    assert.equal(findEquipmentForLog(log, [eq]), null);
  });
});

describe('resolveLogView', () => {
  it('器材改名與改部位後顯示最新值並附 _resolved: true', () => {
    const eq = makeEq({ id: 'eq_bench', name: '坐姿胸推機', bodyParts: ['胸', '肩'] });
    const log = makeLog({ equipmentName: '舊胸推機', bodyParts: ['胸'] });
    const view = resolveLogView(log, [eq]);
    assert.equal(view.equipmentId, 'eq_bench');
    assert.equal(view.equipmentName, '坐姿胸推機');
    assert.deepEqual(view.bodyParts, ['胸', '肩']);
    assert.equal(view._resolved, true);
  });

  it('欄位改名與改單位後，組數值仍以同 key 對應最新欄位定義', () => {
    const eq = makeEq({
      fields: [{ key: 'f_w', name: '負重', unit: 'lb' }],
    });
    const log = makeLog({
      fields: [{ key: 'f_w', name: '重量', unit: 'kg' }],
      sets: [{ reps: 10, values: { f_w: 80 } }],
    });
    const view = resolveLogView(log, [eq]);
    assert.deepEqual(view.fields, [{ key: 'f_w', name: '負重', unit: 'lb' }]);
    assert.equal(view.sets[0].values.f_w, 80);
  });

  it('已刪除欄位在紀錄中有值時以 orphan: true 顯示', () => {
    const eq = makeEq({ fields: [{ key: 'f_w', name: '重量', unit: 'kg' }] });
    const log = makeLog({
      sets: [{ reps: 12, values: { f_w: 40, f_seat: 0 } }],
    });
    const view = resolveLogView(log, [eq]);
    assert.deepEqual(view.fields, [
      { key: 'f_w', name: '重量', unit: 'kg' },
      { key: 'f_seat', name: '椅高', unit: '格', orphan: true },
    ]);
  });

  it('已刪除欄位在紀錄中無值時不顯示', () => {
    const eq = makeEq({ fields: [{ key: 'f_w', name: '重量', unit: 'kg' }] });
    const log = makeLog({
      sets: [{ reps: 12, values: { f_w: 40, f_seat: '' } }],
    });
    const view = resolveLogView(log, [eq]);
    assert.deepEqual(view.fields, [{ key: 'f_w', name: '重量', unit: 'kg' }]);
  });

  it('器材已刪除找不到時沿用紀錄快照並附 _resolved: true', () => {
    const log = makeLog({ equipmentId: 'eq_gone', equipmentName: '已刪器材' });
    const view = resolveLogView(log, [makeEq({ id: 'eq_other', name: '其他器材' })]);
    assert.equal(view.equipmentId, 'eq_gone');
    assert.equal(view.equipmentName, '已刪器材');
    assert.deepEqual(view.fields, log.fields);
    assert.equal(view._resolved, true);
  });

  it('器材關閉 trackReps 但紀錄仍有 reps 數值時，trackReps 仍為 true', () => {
    const eq = makeEq({ trackReps: false });
    const logWithReps = makeLog({ sets: [{ reps: 15, values: { f_w: 30 } }] });
    const logWithoutReps = makeLog({ sets: [{ reps: '', values: { f_w: 30 } }] });
    assert.equal(resolveLogView(logWithReps, [eq]).trackReps, true);
    assert.equal(resolveLogView(logWithoutReps, [eq]).trackReps, false);
  });

  it('不修改傳入的紀錄與器材物件', () => {
    const eq = makeEq({ name: '新名稱', bodyParts: ['背'] });
    const log = makeLog({ equipmentName: '舊名稱', bodyParts: ['胸'] });
    const eqSnap = structuredClone(eq);
    const logSnap = structuredClone(log);
    const view = resolveLogView(log, [eq]);
    view.bodyParts.push('核心');
    view.fields[0].name = '被改動';
    assert.deepEqual(eq, eqSnap);
    assert.deepEqual(log, logSnap);
    assert.equal('_resolved' in log, false);
  });
});

describe('migrateLegacyLogs', () => {
  it('只回傳缺 id 或 id 失效但名稱對得到器材的紀錄，且補上正確 equipmentId', () => {
    const eqList = [
      makeEq({ id: 'eq_a', name: '胸推機' }),
      makeEq({ id: 'eq_b', name: 'Leg Press' }),
    ];
    const logs = [
      makeLog({ id: 'ok', equipmentId: 'eq_a', equipmentName: '胸推機' }),
      makeLog({ id: 'no_id', equipmentId: '', equipmentName: ' 胸推機 ' }),
      makeLog({ id: 'bad_id', equipmentId: 'eq_old', equipmentName: 'leg press' }),
      makeLog({ id: 'unknown', equipmentId: '', equipmentName: '不存在的器材' }),
    ];
    const migrated = migrateLegacyLogs(logs, eqList);
    assert.deepEqual(
      migrated.map((l) => [l.id, l.equipmentId]),
      [
        ['no_id', 'eq_a'],
        ['bad_id', 'eq_b'],
      ]
    );
  });

  it('回傳新物件且不修改原始紀錄', () => {
    const eqList = [makeEq({ id: 'eq_a', name: '胸推機' })];
    const orig = makeLog({ id: 'legacy_1', equipmentId: '', equipmentName: '胸推機' });
    const [updated] = migrateLegacyLogs([orig], eqList);
    assert.notEqual(updated, orig);
    assert.equal(orig.equipmentId, '');
    assert.equal(updated.equipmentId, 'eq_a');
  });
});

describe('diffEquipment', () => {
  it('正確偵測 nameChanged（並忽略頭尾空白差異）', () => {
    const oldEq = makeEq({ name: '胸推機' });
    assert.equal(diffEquipment(oldEq, makeEq({ name: '坐姿胸推機' })).nameChanged, true);
    assert.equal(diffEquipment(oldEq, makeEq({ name: '  胸推機  ' })).nameChanged, false);
  });

  it('以 key 比對偵測 renamedFields、unitChanged、removedFields、addedFields', () => {
    const oldEq = makeEq({
      fields: [
        { key: 'f_w', name: '重量', unit: 'kg' },
        { key: 'f_seat', name: '椅高', unit: '格' },
        { key: 'f_old', name: '角度', unit: '度' },
      ],
    });
    const newEq = makeEq({
      fields: [
        { key: 'f_w', name: '負重', unit: 'lb' },
        { key: 'f_seat', name: '座椅高度', unit: '格' },
        { key: 'f_new', name: '握距', unit: '段' },
      ],
    });
    const diff = diffEquipment(oldEq, newEq);
    assert.deepEqual(diff.renamedFields, [
      { key: 'f_w', from: '重量', to: '負重' },
      { key: 'f_seat', from: '椅高', to: '座椅高度' },
    ]);
    assert.deepEqual(diff.unitChanged, [
      { key: 'f_w', name: '負重', fromUnit: 'kg', toUnit: 'lb' },
    ]);
    assert.deepEqual(diff.removedFields, [{ key: 'f_old', name: '角度', unit: '度' }]);
    assert.deepEqual(diff.addedFields, [{ key: 'f_new', name: '握距', unit: '段' }]);
  });

  it('僅在 trackReps 由開啟變為關閉時 repsTurnedOff 為 true', () => {
    assert.equal(
      diffEquipment(makeEq({ trackReps: true }), makeEq({ trackReps: false })).repsTurnedOff,
      true
    );
    assert.equal(
      diffEquipment(makeEq({ trackReps: false }), makeEq({ trackReps: false })).repsTurnedOff,
      false
    );
    assert.equal(
      diffEquipment(makeEq({ trackReps: false }), makeEq({ trackReps: true })).repsTurnedOff,
      false
    );
  });

  it('無實質變更時回傳空差異陣列且旗標皆為 false', () => {
    const eq = makeEq();
    assert.deepEqual(diffEquipment(eq, structuredClone(eq)), {
      nameChanged: false,
      renamedFields: [],
      unitChanged: [],
      removedFields: [],
      addedFields: [],
      repsTurnedOff: false,
    });
  });
});

describe('findEquipmentConflicts', () => {
  it('產生 removed、unit、reps 三種衝突型別與預設 keep', () => {
    const oldEq = makeEq();
    const newEq = makeEq({
      trackReps: false,
      fields: [{ key: 'f_w', name: '重量', unit: 'lb' }],
    });
    const logs = [makeLog({ id: 'l1', date: '2026-11-20' })];
    const conflicts = findEquipmentConflicts(oldEq, newEq, logs);

    assert.equal(conflicts.length, 3);
    const byType = Object.fromEntries(conflicts.map((c) => [c.type, c]));

    assert.equal(byType.removed.id, 'l1:f_seat');
    assert.deepEqual(byType.removed.actions, ['keep', 'map', 'delete']);
    assert.equal(byType.removed.defaultAction, 'keep');
    assert.equal(byType.removed.fromUnit, '格');
    assert.equal(byType.removed.toUnit, '');

    assert.equal(byType.unit.id, 'l1:f_w');
    assert.deepEqual(byType.unit.actions, ['keep', 'map', 'delete']);
    assert.equal(byType.unit.defaultAction, 'keep');
    assert.equal(byType.unit.fromUnit, 'kg');
    assert.equal(byType.unit.toUnit, 'lb');

    assert.equal(byType.reps.id, 'l1:__reps');
    assert.deepEqual(byType.reps.actions, ['keep', 'delete']);
    assert.equal(byType.reps.defaultAction, 'keep');
    assert.equal(byType.reps.fieldKey, '__reps');
  });

  it('logNo 依日期與 createdAt 由舊到新編號（從 1 起）並依序回傳', () => {
    const oldEq = makeEq();
    const newEq = makeEq({ fields: [{ key: 'f_w', name: '重量', unit: 'lb' }] });
    const logs = [
      makeLog({
        id: 'l_new',
        date: '2026-11-22',
        createdAt: '2026-11-22T08:00:00.000Z',
        sets: [{ reps: 10, values: { f_w: 50 } }],
      }),
      makeLog({
        id: 'l_old2',
        date: '2026-11-18',
        createdAt: '2026-11-18T18:00:00.000Z',
        sets: [{ reps: 10, values: { f_w: 45 } }],
      }),
      makeLog({
        id: 'l_old1',
        date: '2026-11-18',
        createdAt: '2026-11-18T09:00:00.000Z',
        sets: [{ reps: 10, values: { f_w: 40 } }],
      }),
    ];
    const conflicts = findEquipmentConflicts(oldEq, newEq, logs);
    assert.deepEqual(
      conflicts.map((c) => [c.logId, c.date, c.logNo]),
      [
        ['l_old1', '2026-11-18', 1],
        ['l_old2', '2026-11-18', 2],
        ['l_new', '2026-11-22', 3],
      ]
    );
  });

  it('values 正確記錄各組 setNo（含 0 值、略過空組）', () => {
    const oldEq = makeEq();
    const newEq = makeEq({ fields: [{ key: 'f_w', name: '重量', unit: 'kg' }] });
    const logs = [
      makeLog({
        id: 'l1',
        sets: [
          { reps: 12, values: { f_w: 40, f_seat: '' } },
          { reps: 10, values: { f_w: 45, f_seat: 0 } },
          { reps: 8, values: { f_w: 50, f_seat: 4 } },
        ],
      }),
    ];
    const [conflict] = findEquipmentConflicts(oldEq, newEq, logs);
    assert.equal(conflict.type, 'removed');
    assert.deepEqual(conflict.values, [
      { setNo: 2, value: 0 },
      { setNo: 3, value: 4 },
    ]);
  });

  it('無衝突性變更或受影響欄位皆無值時回傳空陣列', () => {
    const oldEq = makeEq();
    // 只改名稱與欄位名稱不產生衝突
    const renameOnly = makeEq({
      name: '新胸推機',
      fields: [
        { key: 'f_w', name: '負重', unit: 'kg' },
        { key: 'f_seat', name: '座椅', unit: '格' },
      ],
    });
    assert.deepEqual(findEquipmentConflicts(oldEq, renameOnly, [makeLog()]), []);

    // 刪除欄位但紀錄中該欄位皆為空也不產生衝突
    const removeSeat = makeEq({ fields: [{ key: 'f_w', name: '重量', unit: 'kg' }] });
    const emptySeatLog = makeLog({ sets: [{ reps: 12, values: { f_w: 40, f_seat: '' } }] });
    assert.deepEqual(findEquipmentConflicts(oldEq, removeSeat, [emptySeatLog]), []);
  });

  it('其他器材的紀錄不列入衝突且不影響 logNo 編號', () => {
    const oldEq = makeEq({ id: 'eq_bench', name: '胸推機' });
    const newEq = makeEq({
      id: 'eq_bench',
      name: '胸推機',
      fields: [{ key: 'f_w', name: '重量', unit: 'lb' }],
    });
    const logs = [
      makeLog({
        id: 'other_1',
        date: '2026-11-10',
        equipmentId: 'eq_squat',
        equipmentName: '深蹲架',
        sets: [{ reps: 8, values: { f_w: 100 } }],
      }),
      makeLog({
        id: 'target_1',
        date: '2026-11-20',
        equipmentId: 'eq_bench',
        sets: [{ reps: 10, values: { f_w: 40 } }],
      }),
    ];
    const conflicts = findEquipmentConflicts(oldEq, newEq, logs);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].logId, 'target_1');
    assert.equal(conflicts[0].logNo, 1);
  });
});

describe('applyEquipmentChange', () => {
  const fixedNow = new Date('2026-11-25T08:30:00.000Z');

  it('無衝突時改名、改部位與欄位改名會連動所有該器材紀錄（含無 id 的同名舊紀錄）', () => {
    const oldEq = makeEq();
    const newEq = makeEq({
      name: '坐姿胸推機',
      bodyParts: ['胸'],
      fields: [
        { key: 'f_w', name: '負重', unit: 'kg' },
        { key: 'f_seat', name: '椅高', unit: '格' },
      ],
    });
    const logs = [
      makeLog({ id: 'l1', equipmentId: 'eq_bench' }),
      makeLog({ id: 'l2', equipmentId: '', equipmentName: '胸推機' }),
    ];

    const updated = applyEquipmentChange(oldEq, newEq, logs, {}, fixedNow);
    assert.equal(updated.length, 2);
    for (const u of updated) {
      assert.equal(u.equipmentId, 'eq_bench');
      assert.equal(u.equipmentName, '坐姿胸推機');
      assert.deepEqual(u.bodyParts, ['胸']);
      assert.equal(u.fields[0].name, '負重');
      assert.equal(u.updatedAt, fixedNow.toISOString());
    }
  });

  it('衝突採 keep（含省略 resolution 時預設）會保留已刪欄位定義且不動原本數值', () => {
    const oldEq = makeEq();
    const newEq = makeEq({ fields: [{ key: 'f_w', name: '重量', unit: 'kg' }] });
    const logs = [makeLog({ id: 'l1' })];

    const [updated] = applyEquipmentChange(oldEq, newEq, logs, {}, fixedNow);
    // 沒有改變 fields 內容或數值時，因原本就有 f_seat 定義，確認若同時改名則 f_seat 定義被保留
    assert.equal(updated, undefined);

    const renamedNewEq = makeEq({
      name: '新胸推機',
      fields: [{ key: 'f_w', name: '重量', unit: 'kg' }],
    });
    const [kept] = applyEquipmentChange(
      oldEq,
      renamedNewEq,
      logs,
      { 'l1:f_seat': { action: 'keep' } },
      fixedNow
    );
    assert.deepEqual(kept.fields, [
      { key: 'f_w', name: '重量', unit: 'kg' },
      { key: 'f_seat', name: '椅高', unit: '格' },
    ]);
    assert.equal(kept.sets[0].values.f_seat, 3);
  });

  it('衝突採 map 時目標該組為空才搬移並移除來源鍵', () => {
    const oldEq = makeEq();
    const newEq = makeEq({
      fields: [
        { key: 'f_w', name: '重量', unit: 'kg' },
        { key: 'f_pos', name: '位置', unit: '段' },
      ],
    });
    const logs = [
      makeLog({
        id: 'l1',
        sets: [
          { reps: 12, values: { f_w: 40, f_seat: 3 } },
          { reps: 10, values: { f_w: 45, f_seat: 4, f_pos: '' } },
        ],
      }),
    ];

    const [updated] = applyEquipmentChange(
      oldEq,
      newEq,
      logs,
      { 'l1:f_seat': { action: 'map', targetKey: 'f_pos' } },
      fixedNow
    );
    assert.deepEqual(updated.sets[0].values, { f_w: 40, f_pos: 3 });
    assert.deepEqual(updated.sets[1].values, { f_w: 45, f_pos: 4 });
    assert.deepEqual(
      updated.fields.map((f) => f.key),
      ['f_w', 'f_pos']
    );
  });

  it('衝突採 map 時目標已有值不覆蓋，並保留來源值與來源欄位定義', () => {
    const oldEq = makeEq();
    const newEq = makeEq({
      fields: [
        { key: 'f_w', name: '重量', unit: 'kg' },
        { key: 'f_pos', name: '位置', unit: '段' },
      ],
    });
    const logs = [
      makeLog({
        id: 'l1',
        sets: [
          { reps: 12, values: { f_w: 40, f_seat: 3 } },
          { reps: 10, values: { f_w: 45, f_seat: 4, f_pos: 9 } },
        ],
      }),
    ];

    const [updated] = applyEquipmentChange(
      oldEq,
      newEq,
      logs,
      { 'l1:f_seat': { action: 'map', targetKey: 'f_pos' } },
      fixedNow
    );
    // 第 1 組目標為空 → 搬過去；第 2 組目標已有值 → 不覆蓋並保留來源 f_seat
    assert.deepEqual(updated.sets[0].values, { f_w: 40, f_pos: 3 });
    assert.deepEqual(updated.sets[1].values, { f_w: 45, f_seat: 4, f_pos: 9 });
    assert.deepEqual(
      updated.fields.map((f) => f.key),
      ['f_w', 'f_pos', 'f_seat']
    );
  });

  it('欄位衝突採 delete 時清除各組該欄位的值且不保留已刪欄位定義', () => {
    const oldEq = makeEq();
    const newEq = makeEq({ fields: [{ key: 'f_w', name: '重量', unit: 'kg' }] });
    const logs = [makeLog({ id: 'l1' })];

    const [updated] = applyEquipmentChange(
      oldEq,
      newEq,
      logs,
      { 'l1:f_seat': { action: 'delete' } },
      fixedNow
    );
    assert.deepEqual(updated.fields, [{ key: 'f_w', name: '重量', unit: 'kg' }]);
    assert.deepEqual(updated.sets[0].values, { f_w: 40 });
    assert.deepEqual(updated.sets[1].values, { f_w: 45 });
  });

  it('reps 衝突採 delete 時將各組 reps 設為空字串', () => {
    const oldEq = makeEq({ trackReps: true });
    const newEq = makeEq({ trackReps: false });
    const logs = [makeLog({ id: 'l1' })];

    const [updated] = applyEquipmentChange(
      oldEq,
      newEq,
      logs,
      { 'l1:__reps': { action: 'delete' } },
      fixedNow
    );
    assert.equal(updated.trackReps, false);
    assert.equal(updated.sets[0].reps, '');
    assert.equal(updated.sets[1].reps, '');
  });

  it('未變更的紀錄與其他器材紀錄不回傳，且有變更者的 updatedAt 使用傳入的 now', () => {
    const oldEq = makeEq();
    const sameEq = makeEq();
    const logs = [
      makeLog({ id: 'l_same', equipmentId: 'eq_bench' }),
      makeLog({ id: 'l_other', equipmentId: 'eq_squat', equipmentName: '深蹲架' }),
    ];
    assert.deepEqual(applyEquipmentChange(oldEq, sameEq, logs, {}, fixedNow), []);

    // 只有需要補 equipmentId 的紀錄才會被回傳，已是最新狀態者不回傳
    const mixedLogs = [
      makeLog({ id: 'l_already_latest', equipmentId: 'eq_bench' }),
      makeLog({ id: 'l_legacy', equipmentId: '', equipmentName: '胸推機' }),
    ];
    const updated = applyEquipmentChange(oldEq, sameEq, mixedLogs, {}, fixedNow);
    assert.deepEqual(
      updated.map((l) => [l.id, l.equipmentId, l.updatedAt]),
      [['l_legacy', 'eq_bench', '2026-11-25T08:30:00.000Z']]
    );
  });

  it('不修改傳入的 oldEq、newEq、logs 與 resolutions 物件', () => {
    const oldEq = makeEq();
    const newEq = makeEq({
      name: '新胸推機',
      trackReps: false,
      fields: [{ key: 'f_w', name: '負重', unit: 'lb' }],
    });
    const logs = [makeLog({ id: 'l1' })];
    const resolutions = {
      'l1:f_seat': { action: 'delete' },
      'l1:__reps': { action: 'delete' },
    };

    const oldSnap = structuredClone(oldEq);
    const newSnap = structuredClone(newEq);
    const logsSnap = structuredClone(logs);
    const resSnap = structuredClone(resolutions);

    const [updated] = applyEquipmentChange(oldEq, newEq, logs, resolutions, fixedNow);
    updated.bodyParts.push('核心');
    updated.sets[0].values.f_w = 999;

    assert.deepEqual(oldEq, oldSnap);
    assert.deepEqual(newEq, newSnap);
    assert.deepEqual(logs, logsSnap);
    assert.deepEqual(resolutions, resSnap);
  });
});
