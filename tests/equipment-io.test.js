import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEquipmentExport,
  parseEquipmentImport,
  mergeEquipment,
} from '../web/logic.js';

describe('buildEquipmentExport', () => {
  it('產生符合規格的器材匯出結構並深拷貝原始資料', () => {
    const now = new Date('2026-11-23T12:00:00.000Z');
    const source = [
      {
        id: 'eq_1',
        name: '胸推機',
        bodyParts: ['胸', '手臂'],
        instructions: '座椅調至第 4 格',
        trackReps: true,
        fields: [{ key: 'f_w', name: '重量', unit: 'kg' }],
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    ];

    const exported = buildEquipmentExport(source, now);

    assert.equal(exported.app, 'fitness-log');
    assert.equal(exported.type, 'equipment');
    assert.equal(exported.version, 1);
    assert.equal(exported.exportedAt, '2026-11-23T12:00:00.000Z');
    assert.deepEqual(exported.equipment, source);

    // 修改匯出物件不影響原陣列
    exported.equipment[0].name = '改名';
    exported.equipment[0].fields[0].unit = 'lb';
    assert.equal(source[0].name, '胸推機');
    assert.equal(source[0].fields[0].unit, 'kg');
  });
});

describe('parseEquipmentImport', () => {
  it('接受三種格式：器材匯出檔、純陣列與完整備份 { equipment, logs }', () => {
    const sampleEq = {
      id: 'eq_bench',
      name: '胸推機',
      bodyParts: ['胸', '手臂'],
      instructions: '肩胛骨收緊',
      trackReps: true,
      fields: [{ key: 'f_weight', name: '重量', unit: 'kg' }],
    };

    // 1. 器材匯出格式
    const exportText = JSON.stringify(buildEquipmentExport([sampleEq]));
    const res1 = parseEquipmentImport(exportText);
    assert.equal(res1.errors.length, 0);
    assert.equal(res1.equipment.length, 1);
    assert.equal(res1.equipment[0].name, '胸推機');
    assert.equal(res1.equipment[0].fields[0].key, 'f_weight');

    // 2. 純陣列格式
    const arrayText = JSON.stringify([sampleEq]);
    const res2 = parseEquipmentImport(arrayText);
    assert.equal(res2.errors.length, 0);
    assert.equal(res2.equipment.length, 1);
    assert.equal(res2.equipment[0].id, 'eq_bench');

    // 3. 完整備份格式
    const backupText = JSON.stringify({
      equipment: [sampleEq],
      logs: [{ id: 'log_1', date: '2026-11-23' }],
    });
    const res3 = parseEquipmentImport(backupText);
    assert.equal(res3.errors.length, 0);
    assert.equal(res3.equipment.length, 1);
    assert.equal(res3.equipment[0].name, '胸推機');
  });

  it('JSON 語法錯誤、空白內容或找不到器材陣列時拋出正體中文 Error', () => {
    assert.throws(() => parseEquipmentImport(''), (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /空白/);
      return true;
    });

    assert.throws(() => parseEquipmentImport('{invalid json'), (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /JSON/);
      return true;
    });

    assert.throws(() => parseEquipmentImport('{"logs": []}'), (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /找不到器材陣列/);
      return true;
    });
  });

  it('不合格筆數略過並記入 errors；欄位缺 key 自動補 f_ 前綴；bodyParts 字串轉陣列；trackReps 預設 true', () => {
    const payload = [
      {
        name: '跑步機',
        bodyParts: '有氧、腿',
        trackReps: false,
        fields: [
          { name: '速度', unit: 'km/h' },
          { key: 'f_keep', name: '坡度', unit: '%' },
        ],
      },
      {
        name: '啞鈴',
        bodyParts: '手臂',
        // 未指定 trackReps，應預設為 true
        fields: [{ name: '重量', unit: 'kg' }],
      },
      {
        // 第 3 筆：名稱空白
        name: '   ',
        bodyParts: ['胸'],
        fields: [],
      },
      {
        // 第 4 筆：缺少部位且欄位名稱重複
        name: '滑輪下拉',
        bodyParts: [],
        fields: [
          { name: '重量', unit: 'kg' },
          { name: '重量', unit: 'lb' },
        ],
      },
      '非物件資料',
    ];

    const result = parseEquipmentImport(JSON.stringify(payload));

    assert.equal(result.equipment.length, 2);
    assert.equal(result.errors.length, 3);

    // 驗證第一筆（字串部位、補 key、保留既有 key、trackReps=false）
    const treadmill = result.equipment[0];
    assert.equal(treadmill.name, '跑步機');
    assert.deepEqual(treadmill.bodyParts, ['有氧', '腿']);
    assert.equal(treadmill.trackReps, false);
    assert.ok(treadmill.fields[0].key.startsWith('f_'));
    assert.equal(treadmill.fields[1].key, 'f_keep');

    // 驗證第二筆（單一字串部位、trackReps 預設 true、補 key）
    const dumbbell = result.equipment[1];
    assert.deepEqual(dumbbell.bodyParts, ['手臂']);
    assert.equal(dumbbell.trackReps, true);
    assert.ok(dumbbell.fields[0].key.startsWith('f_'));

    // 驗證錯誤訊息含正確筆數編號
    assert.match(result.errors[0], /^第 3 筆：/);
    assert.match(result.errors[1], /^第 4 筆：/);
    assert.match(result.errors[2], /^第 5 筆：/);
  });
});

describe('mergeEquipment', () => {
  const fixedNow = new Date('2026-11-23T15:00:00.000Z');
  const existing = [
    {
      id: 'eq_1',
      name: 'Chest Press',
      bodyParts: ['胸'],
      instructions: '舊說明',
      trackReps: true,
      fields: [
        { key: 'f_orig_weight', name: '重量', unit: 'kg' },
        { key: 'f_orig_seat', name: '座椅', unit: '格' },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
    {
      id: 'eq_keep',
      name: '深蹲架',
      bodyParts: ['腿', '臀'],
      instructions: '保留不刪除',
      trackReps: true,
      fields: [{ key: 'f_sq', name: '重量', unit: 'kg' }],
      createdAt: '2026-01-05T00:00:00.000Z',
      updatedAt: '2026-01-05T00:00:00.000Z',
    },
  ];

  it('mode=skip（預設）：同名略過（去空白、不分大小寫），新器材加入且不刪除既有器材', () => {
    const existingSnapshot = structuredClone(existing);
    const incoming = [
      {
        id: 'eq_other',
        name: '  chest press ',
        bodyParts: ['胸', '手臂'],
        instructions: '新說明',
        trackReps: true,
        fields: [{ key: 'f_new', name: '重量', unit: 'lb' }],
      },
      {
        id: 'eq_new_1',
        name: '划船機',
        bodyParts: ['背'],
        instructions: '挺胸拉至腹部',
        trackReps: true,
        fields: [{ key: 'f_row_w', name: '重量', unit: 'kg' }],
      },
    ];

    const res = mergeEquipment(existing, incoming, 'skip', fixedNow);

    assert.equal(res.added, 1);
    assert.equal(res.updated, 0);
    assert.equal(res.skipped, 1);
    assert.equal(res.toSave.length, 1);
    assert.equal(res.toSave[0].id, 'eq_new_1');
    assert.equal(res.toSave[0].name, '划船機');
    assert.equal(res.toSave[0].createdAt, fixedNow.toISOString());
    assert.equal(res.toSave[0].updatedAt, fixedNow.toISOString());

    // 確認未修改既有陣列，且以 toSave 套用後既有器材（含深蹲架）皆完整保留
    assert.deepEqual(existing, existingSnapshot);
    const afterMap = new Map(existing.map((e) => [e.id, e]));
    for (const eq of res.toSave) afterMap.set(eq.id, eq);
    assert.equal(afterMap.size, 3);
    assert.ok(afterMap.has('eq_keep'));
    assert.equal(afterMap.get('eq_1').instructions, '舊說明');
  });

  it('mode=update：同名保留既有 id、createdAt 與同名欄位 key，更新其餘欄位與 updatedAt', () => {
    const incoming = [
      {
        id: 'eq_different_id',
        name: '  CHEST PRESS  ',
        bodyParts: ['胸', '手臂'],
        instructions: '更新後的使用說明',
        trackReps: false,
        fields: [
          { key: 'f_import_weight', name: ' 重量 ', unit: 'lb' },
          { key: 'f_orig_weight', name: '阻力', unit: '段' }, // 故意與保留 key 衝突，應自動換新 key
          { key: 'f_pin', name: '插銷', unit: '格' },
        ],
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-02T00:00:00.000Z',
      },
    ];

    const res = mergeEquipment(existing, incoming, 'update', fixedNow);

    assert.equal(res.added, 0);
    assert.equal(res.updated, 1);
    assert.equal(res.skipped, 0);
    assert.equal(res.toSave.length, 1);

    const saved = res.toSave[0];
    assert.equal(saved.id, 'eq_1');
    assert.equal(saved.createdAt, '2026-01-01T00:00:00.000Z');
    assert.equal(saved.updatedAt, fixedNow.toISOString());
    assert.equal(saved.name, 'CHEST PRESS');
    assert.deepEqual(saved.bodyParts, ['胸', '手臂']);
    assert.equal(saved.instructions, '更新後的使用說明');
    assert.equal(saved.trackReps, false);

    // 「重量」必須沿用既有 key；衝突的新欄位「阻力」應換新 f_ key；「插銷」沿用不衝突的匯入 key
    assert.equal(saved.fields[0].key, 'f_orig_weight');
    assert.equal(saved.fields[0].name, '重量');
    assert.equal(saved.fields[0].unit, 'lb');
    assert.notEqual(saved.fields[1].key, 'f_orig_weight');
    assert.ok(saved.fields[1].key.startsWith('f_'));
    assert.equal(saved.fields[2].key, 'f_pin');
  });

  it('新器材 id 與既有 id 衝突時自動改為新 eq_ id，並補齊時間戳', () => {
    const incoming = [
      {
        id: 'eq_1', // 與既有 Chest Press 衝突
        name: '飛鳥機',
        bodyParts: ['胸'],
        fields: [{ name: '重量', unit: 'kg' }],
      },
      {
        id: 'eq_dup_new',
        name: '蝴蝶機',
        bodyParts: ['胸'],
        fields: [],
      },
      {
        id: 'eq_dup_new', // 與前一個新器材衝突
        name: '拉背機',
        bodyParts: ['背'],
        fields: [],
      },
    ];

    const res = mergeEquipment(existing, incoming, 'skip', fixedNow);

    assert.equal(res.added, 3);
    assert.equal(res.updated, 0);
    assert.equal(res.skipped, 0);

    const [fly, pec, lat] = res.toSave;
    assert.notEqual(fly.id, 'eq_1');
    assert.ok(fly.id.startsWith('eq_'));
    assert.equal(fly.createdAt, fixedNow.toISOString());
    assert.equal(fly.updatedAt, fixedNow.toISOString());
    assert.ok(fly.fields[0].key.startsWith('f_'));

    assert.equal(pec.id, 'eq_dup_new');
    assert.notEqual(lat.id, 'eq_dup_new');
    assert.ok(lat.id.startsWith('eq_'));

    // 確認所有 id（既有 + 新增）皆唯一
    const allIds = new Set([
      ...existing.map((e) => e.id),
      ...res.toSave.map((e) => e.id),
    ]);
    assert.equal(allIds.size, existing.length + res.toSave.length);
  });

  it('匯入檔內重複同名只取第一筆，其餘計入 skipped（skip 與 update 模式皆適用）', () => {
    const incoming = [
      {
        id: 'eq_a',
        name: '腿推機',
        bodyParts: ['腿'],
        instructions: '第一筆',
        fields: [],
      },
      {
        id: 'eq_b',
        name: ' 腿推機 ',
        bodyParts: ['腿', '臀'],
        instructions: '重複的第二筆',
        fields: [],
      },
      {
        name: 'chest press',
        bodyParts: ['胸'],
        instructions: '更新第一筆',
        fields: [],
      },
      {
        name: 'CHEST PRESS',
        bodyParts: ['胸', '肩'],
        instructions: '更新重複第二筆',
        fields: [],
      },
    ];

    const resUpdate = mergeEquipment(existing, incoming, 'update', fixedNow);
    assert.equal(resUpdate.added, 1);
    assert.equal(resUpdate.updated, 1);
    assert.equal(resUpdate.skipped, 2);
    assert.equal(resUpdate.toSave.length, 2);
    assert.equal(resUpdate.toSave[0].instructions, '第一筆');
    assert.equal(resUpdate.toSave[1].instructions, '更新第一筆');

    const resSkip = mergeEquipment(existing, incoming, 'skip', fixedNow);
    assert.equal(resSkip.added, 1);
    assert.equal(resSkip.updated, 0);
    assert.equal(resSkip.skipped, 3);
    assert.equal(resSkip.toSave.length, 1);
    assert.equal(resSkip.toSave[0].instructions, '第一筆');
  });
});
