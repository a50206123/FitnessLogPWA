import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDay, formatNumber } from '../web/logic.js';

describe('summarizeDay', () => {
  it('空陣列與無效輸入回傳預設空摘要', () => {
    const expected = {
      date: '',
      logs: [],
      bodyParts: [],
      equipmentCount: 0,
      totalSets: 0,
      totalReps: 0,
      totalVolumeKg: 0,
      cardio: [],
    };

    assert.deepEqual(summarizeDay([]), expected);
    assert.deepEqual(summarizeDay(null), expected);
    assert.deepEqual(summarizeDay(undefined), expected);
  });

  it('多器材多組彙整：依 createdAt 舊到新排序、計算器材數／總組數／總次數／總訓練量，且不修改原陣列', () => {
    const rawLogs = [
      {
        id: 'l2',
        date: '2026-11-23',
        equipmentId: 'eq_row',
        equipmentName: '坐姿划船',
        bodyParts: ['背', '手臂'],
        trackReps: true,
        fields: [{ key: 'w', name: '重量', unit: 'kg' }],
        sets: [
          { reps: 10, values: { w: 45 } },
          { reps: 10, values: { w: 50.55 } },
        ],
        createdAt: '2026-11-23T19:00:00Z',
      },
      {
        id: 'l1',
        date: '2026-11-23',
        equipmentId: 'eq_bench',
        equipmentName: '胸推機',
        bodyParts: ['胸', '手臂'],
        trackReps: true,
        fields: [
          { key: 'w', name: '重量', unit: 'kg' },
          { key: 'seat', name: '座椅', unit: '格' },
        ],
        sets: [
          { reps: 12, values: { w: 30, seat: 4 } },
          { reps: 10, values: { w: 40, seat: 4 } },
          { reps: 8, values: { w: 40, seat: 5 } },
        ],
        createdAt: '2026-11-23T18:30:00Z',
      },
      {
        // 同器材當日第二筆紀錄，equipmentCount 應只算一次
        id: 'l3',
        date: '2026-11-23',
        equipmentId: 'eq_bench',
        equipmentName: '胸推機',
        bodyParts: ['胸'],
        trackReps: true,
        fields: [{ key: 'w', name: '重量', unit: 'kg' }],
        sets: [{ reps: 15, values: { w: 20 } }],
        createdAt: '2026-11-23T19:30:00Z',
      },
    ];
    const originalOrder = rawLogs.map((l) => l.id);

    const summary = summarizeDay(rawLogs);

    assert.equal(summary.date, '2026-11-23');
    assert.deepEqual(
      summary.logs.map((l) => l.id),
      ['l1', 'l2', 'l3']
    );
    // 確認沒有修改原始輸入陣列順序
    assert.deepEqual(
      rawLogs.map((l) => l.id),
      originalOrder
    );
    assert.deepEqual(summary.bodyParts, ['胸', '背', '手臂']);
    assert.equal(summary.equipmentCount, 2);
    assert.equal(summary.totalSets, 6);
    assert.equal(summary.totalReps, 12 + 10 + 8 + 10 + 10 + 15);
    // l1: 360 + 400 + 320 = 1080；l2: 450 + 505.5 = 955.5；l3: 300；合計 2335.5
    assert.equal(summary.totalVolumeKg, 2335.5);
    assert.deepEqual(summary.cardio, []);
  });

  it('trackReps=false 的有氧紀錄不計入總次數與訓練量（即使含 kg 或 reps 值）', () => {
    const logs = [
      {
        id: 'c1',
        date: '2026-11-23',
        equipmentId: 'eq_run',
        equipmentName: '跑步機',
        bodyParts: ['有氧', '腿'],
        trackReps: false,
        fields: [
          { key: 'spd', name: '速度', unit: 'km/h' },
          { key: 'min', name: '時間', unit: '分' },
          { key: 'vest', name: '負重', unit: 'kg' },
        ],
        sets: [
          { reps: 99, values: { spd: 8, min: 20, vest: 10 } },
          { reps: 50, values: { spd: 9, min: 15, vest: 10 } },
        ],
        createdAt: '2026-11-23T08:00:00Z',
      },
      {
        id: 'w1',
        date: '2026-11-23',
        equipmentId: 'eq_squat',
        equipmentName: '深蹲架',
        bodyParts: ['腿'],
        trackReps: true,
        fields: [{ key: 'w', name: '重量', unit: 'kg' }],
        sets: [{ reps: 10, values: { w: 60 } }],
        createdAt: '2026-11-23T09:00:00Z',
      },
    ];

    const summary = summarizeDay(logs);

    assert.equal(summary.totalSets, 3);
    assert.equal(summary.totalReps, 10);
    assert.equal(summary.totalVolumeKg, 600);
    assert.deepEqual(summary.cardio, [{ name: '時間', unit: '分', total: 35 }]);
  });

  it('只有 kg 單位（不分大小寫、去空白）計入訓練量，lb 與其他單位不算，且四捨五入到小數 1 位', () => {
    const logs = [
      {
        id: 'l_lb',
        date: '2026-11-23',
        equipmentId: 'eq_lb',
        equipmentName: '美規啞鈴',
        bodyParts: ['手臂'],
        trackReps: true,
        fields: [{ key: 'w', name: '重量', unit: 'lb' }],
        sets: [
          { reps: 12, values: { w: 50 } },
          { reps: 10, values: { w: 55 } },
        ],
        createdAt: '2026-11-23T10:00:00Z',
      },
      {
        id: 'l_lb_upper',
        date: '2026-11-23',
        equipmentId: 'eq_lb2',
        equipmentName: '纜繩機',
        bodyParts: ['背'],
        trackReps: true,
        fields: [{ key: 'w', name: '重量', unit: ' LB ' }],
        sets: [{ reps: 15, values: { w: 40 } }],
        createdAt: '2026-11-23T10:15:00Z',
      },
      {
        id: 'l_kg_mixed',
        date: '2026-11-23',
        equipmentId: 'eq_kg',
        equipmentName: '滑輪下拉',
        bodyParts: ['背'],
        trackReps: true,
        fields: [
          { key: 'w1', name: '主重量', unit: ' KG ' },
          { key: 'w2', name: '微調配重', unit: 'Kg' },
          { key: 'lv', name: '阻力', unit: '段' },
        ],
        sets: [
          { reps: 3, values: { w1: 12.25, w2: 1.25, lv: 5 } }, // (12.25 + 1.25) * 3 = 40.5
          { reps: 1, values: { w1: 10.16, w2: 0, lv: 5 } },    // 10.16 -> 合計 50.66 → 50.7
        ],
        createdAt: '2026-11-23T10:30:00Z',
      },
    ];

    const summary = summarizeDay(logs);

    assert.equal(summary.totalSets, 5);
    assert.equal(summary.totalReps, 12 + 10 + 15 + 3 + 1);
    assert.equal(summary.totalVolumeKg, 50.7);
  });

  it('cardio 依 name+unit 合併、保留首次出現順序、正確處理小數四捨五入到 2 位與各種時間距離單位', () => {
    const logs = [
      {
        id: 'c2',
        date: '2026-11-23',
        equipmentId: 'eq_bike',
        equipmentName: '飛輪車',
        bodyParts: ['有氧'],
        trackReps: false,
        fields: [
          { key: 't', name: '時間', unit: '分' },
          { key: 'd', name: '距離', unit: 'km' },
          { key: 's', name: '衝刺', unit: 'sec' },
          { key: 'm', name: '距離', unit: 'm' }, // 同名稱但不同單位不應與 km 合併
        ],
        sets: [
          { values: { t: 15.5, d: 4.125, s: 30, m: 400 } },
          { values: { t: 10.256, d: 2.333, s: 45, m: '' } },
        ],
        createdAt: '2026-11-23T19:00:00Z',
      },
      {
        id: 'c1',
        date: '2026-11-23',
        equipmentId: 'eq_run',
        equipmentName: '跑步機',
        bodyParts: ['有氧'],
        trackReps: false,
        fields: [
          { key: 'd', name: '距離', unit: 'km' },
          { key: 't', name: '時間', unit: '分' },
          { key: 'spd', name: '速度', unit: 'km/h' }, // 非時間／距離單位，不應計入 cardio
          { key: 'hr', name: '健行', unit: 'hr' },
        ],
        sets: [
          { values: { d: 0.1, t: 20, spd: 8, hr: 0.5 } },
          { values: { d: 0.2, t: 5.5, spd: 9, hr: 0.25 } },
        ],
        createdAt: '2026-11-23T18:00:00Z',
      },
    ];

    const summary = summarizeDay(logs);

    // c1 較早（18:00），首次出現順序為：距離(km) → 時間(分) → 健行(hr) → 衝刺(sec) → 距離(m)
    // 距離(km): 0.1 + 0.2 + 4.125 + 2.333 = 6.758 → 6.76
    // 時間(分): 20 + 5.5 + 15.5 + 10.256 = 51.256 → 51.26
    assert.deepEqual(summary.cardio, [
      { name: '距離', unit: 'km', total: 6.76 },
      { name: '時間', unit: '分', total: 51.26 },
      { name: '健行', unit: 'hr', total: 0.75 },
      { name: '衝刺', unit: 'sec', total: 75 },
      { name: '距離', unit: 'm', total: 400 },
    ]);
  });

  it('部位去重並依 BODY_PARTS 順序排列，自訂部位排在後面', () => {
    const logs = [
      {
        id: 'l1',
        date: '2026-11-23',
        equipmentId: 'eq1',
        bodyParts: ['全身', '前臂', '腿', '胸'],
        sets: [{ reps: 10, values: {} }],
        createdAt: '2026-11-23T08:00:00Z',
      },
      {
        id: 'l2',
        date: '2026-11-23',
        equipmentId: 'eq2',
        bodyParts: ['小腿', '胸', '有氧', '核心', ' 臀 ', ''],
        sets: [{ reps: 10, values: {} }],
        createdAt: '2026-11-23T09:00:00Z',
      },
      {
        id: 'l3',
        date: '2026-11-23',
        equipmentId: 'eq3',
        bodyParts: ['手臂', '肩', '背'],
        sets: [{ reps: 10, values: {} }],
        createdAt: '2026-11-23T10:00:00Z',
      },
    ];

    const summary = summarizeDay(logs);

    assert.deepEqual(summary.bodyParts, [
      '胸',
      '背',
      '肩',
      '手臂',
      '腿',
      '臀',
      '核心',
      '有氧',
      '全身',
      '小腿',
      '前臂',
    ]);
  });
});

describe('formatNumber', () => {
  it('整數加上千分位且不補小數點', () => {
    assert.equal(formatNumber(0), '0');
    assert.equal(formatNumber(7), '7');
    assert.equal(formatNumber(999), '999');
    assert.equal(formatNumber(1000), '1,000');
    assert.equal(formatNumber(12345), '12,345');
    assert.equal(formatNumber(1234567), '1,234,567');
  });

  it('最多保留 1 位小數並去掉多餘的 .0', () => {
    assert.equal(formatNumber(12345.0), '12,345');
    assert.equal(formatNumber(1234.5), '1,234.5');
    assert.equal(formatNumber(1234.56), '1,234.6');
    assert.equal(formatNumber(1234.96), '1,235');
    assert.equal(formatNumber(1234.04), '1,234');
    assert.equal(formatNumber(0.05), '0.1');
    assert.equal(formatNumber(0.04), '0');
  });

  it('正確處理負數、-0、數字字串與無效輸入', () => {
    assert.equal(formatNumber(-0), '0');
    assert.equal(formatNumber(-0.04), '0');
    assert.equal(formatNumber(-1000), '-1,000');
    assert.equal(formatNumber(-12345.67), '-12,345.7');
    assert.equal(formatNumber('1234.56'), '1,234.6');
    assert.equal(formatNumber(NaN), '0');
    assert.equal(formatNumber(Infinity), '0');
    assert.equal(formatNumber(null), '0');
    assert.equal(formatNumber(undefined), '0');
    assert.equal(formatNumber(''), '0');
  });
});
