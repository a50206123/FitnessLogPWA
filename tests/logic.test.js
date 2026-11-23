import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BODY_PARTS,
  makeId,
  toDateStr,
  formatDateLabel,
  newSetFrom,
  cleanSets,
  summarizeLog,
  formatLogSummary,
  formatSet,
  formatSetLabeled,
  groupByDate,
  groupByEquipment,
  groupByBodyPart,
  lastLogForEquipment,
  validateEquipment,
  parseFirebaseConfig,
} from '../web/logic.js';

describe('BODY_PARTS', () => {
  it('包含預設的 9 個訓練部位且順序正確', () => {
    assert.deepEqual(BODY_PARTS, [
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
  });
});

describe('makeId', () => {
  it('產生帶前綴的唯一識別碼', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      const id = makeId('eq_');
      assert.ok(id.startsWith('eq_'));
      assert.ok(id.length > 8);
      ids.add(id);
    }
    assert.equal(ids.size, 100);
  });

  it('不傳前綴時可正常產生非空字串', () => {
    const id = makeId();
    assert.equal(typeof id, 'string');
    assert.ok(id.length >= 8);
  });
});

describe('toDateStr', () => {
  it('回傳本地日期 YYYY-MM-DD（含補零）', () => {
    assert.equal(toDateStr(new Date(2026, 0, 5)), '2026-01-05');
    assert.equal(toDateStr(new Date(2026, 10, 23)), '2026-11-23');
  });

  it('預設參數使用今天日期且格式正確', () => {
    assert.match(toDateStr(), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('formatDateLabel', () => {
  it('今年日期顯示 月/日（星期）', () => {
    const ref2026 = new Date(2026, 10, 23);
    assert.equal(formatDateLabel('2026-11-23', ref2026), '11/23（一）');
    assert.equal(formatDateLabel('2026-03-05', ref2026), '3/5（四）');
  });

  it('非今年日期加上年份顯示', () => {
    const ref2026 = new Date(2026, 10, 23);
    assert.equal(formatDateLabel('2025-11-23', ref2026), '2025/11/23（日）');
    assert.equal(formatDateLabel('2027-01-01', ref2026), '2027/1/1（五）');
  });

  it('處理空值或非標準格式字串', () => {
    assert.equal(formatDateLabel(''), '');
    assert.equal(formatDateLabel(null), '');
    assert.equal(formatDateLabel('invalid'), 'invalid');
  });
});

describe('newSetFrom', () => {
  const fields = [
    { key: 'f_w', name: '重量', unit: 'kg' },
    { key: 'f_r', name: '阻力', unit: '段' },
  ];

  it('無上一組時 reps 與各欄位皆為空字串', () => {
    assert.deepEqual(newSetFrom(null, fields), {
      reps: '',
      values: { f_w: '', f_r: '' },
    });
    assert.deepEqual(newSetFrom(undefined, []), {
      reps: '',
      values: {},
    });
  });

  it('有上一組時沿用 reps 與 values 且深拷貝不互相汙染', () => {
    const prev = { reps: 12, values: { f_w: 40 } };
    const next = newSetFrom(prev, fields);

    assert.deepEqual(next, { reps: 12, values: { f_w: 40, f_r: '' } });

    next.reps = 15;
    next.values.f_w = 50;
    assert.equal(prev.reps, 12);
    assert.equal(prev.values.f_w, 40);
  });

  it('上一組值為 0 時正確保留 0', () => {
    const prev = { reps: 0, values: { f_w: 0, f_r: 0 } };
    assert.deepEqual(newSetFrom(prev, fields), {
      reps: 0,
      values: { f_w: 0, f_r: 0 },
    });
  });
});

describe('cleanSets', () => {
  const fields = [
    { key: 'w', name: '重量', unit: 'kg' },
    { key: 'inc', name: '坡度', unit: '%' },
  ];

  it('字串轉數字、移除全空的組，且不修改原陣列', () => {
    const original = [
      { reps: '12', values: { w: '40.5', inc: '' } },
      { reps: '', values: { w: '', inc: '   ' } },
      { reps: '10', values: { w: '0', inc: '0' } },
      { reps: 'abc', values: { w: 'NaN', inc: null } },
    ];
    const snapshot = structuredClone(original);

    const cleaned = cleanSets(original, fields, true);
    assert.deepEqual(cleaned, [
      { reps: 12, values: { w: 40.5 } },
      { reps: 10, values: { w: 0, inc: 0 } },
    ]);
    assert.deepEqual(original, snapshot);
  });

  it('trackReps 為 false 時忽略 reps，僅含 reps 的組會被移除', () => {
    const sets = [
      { reps: '12', values: { w: '', inc: '' } },
      { reps: '15', values: { w: '8', inc: '3' } },
    ];
    assert.deepEqual(cleanSets(sets, fields, false), [
      { values: { w: 8, inc: 3 } },
    ]);
  });

  it('無自訂欄位時（徒手訓練）仍保留有效 reps 的組', () => {
    const sets = [
      { reps: '20', values: {} },
      { reps: '', values: {} },
    ];
    assert.deepEqual(cleanSets(sets, [], true), [{ reps: 20, values: {} }]);
  });
});

describe('summarizeLog', () => {
  it('計算組數、總次數、各欄位最大值與總訓練量（kg）', () => {
    const log = {
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
    };

    assert.deepEqual(summarizeLog(log), {
      setCount: 3,
      totalReps: 30,
      maxByField: { w: 40, seat: 5 },
      volume: 12 * 30 + 10 * 40 + 8 * 40,
    });
  });

  it('重量單位支援 lb（不分大小寫），並取第一個符合 kg/lb 的欄位', () => {
    const log = {
      trackReps: true,
      fields: [
        { key: 'w1', name: '主重量', unit: 'LB' },
        { key: 'w2', name: '附加重量', unit: 'kg' },
      ],
      sets: [{ reps: 10, values: { w1: 50, w2: 5 } }],
    };

    const summary = summarizeLog(log);
    assert.equal(summary.volume, 500);
    assert.deepEqual(summary.maxByField, { w1: 50, w2: 5 });
  });

  it('無 kg/lb 欄位或 trackReps 為 false 時 volume 為 0', () => {
    const cardioLog = {
      trackReps: false,
      fields: [
        { key: 'spd', name: '速度', unit: 'km/h' },
        { key: 'inc', name: '坡度', unit: '%' },
      ],
      sets: [{ values: { spd: 8, inc: 3 } }],
    };

    assert.deepEqual(summarizeLog(cardioLog), {
      setCount: 1,
      totalReps: 0,
      maxByField: { spd: 8, inc: 3 },
      volume: 0,
    });
  });
});

describe('formatLogSummary', () => {
  it('重訓紀錄顯示組數、總次數與各欄位最高值', () => {
    const log = {
      trackReps: true,
      fields: [{ key: 'w', name: '重量', unit: 'kg' }],
      sets: [
        { reps: 10, values: { w: 35 } },
        { reps: 10, values: { w: 40 } },
        { reps: 10, values: { w: 40 } },
      ],
    };
    assert.equal(formatLogSummary(log), '3 組 · 共 30 下 · 重量最高 40 kg');
  });

  it('trackReps 為 false 時不顯示次數，改列各欄位最高值', () => {
    const log = {
      trackReps: false,
      fields: [
        { key: 'spd', name: '速度', unit: 'km/h' },
        { key: 'inc', name: '坡度', unit: '%' },
      ],
      sets: [{ values: { spd: 8, inc: 3 } }],
    };
    assert.equal(formatLogSummary(log), '1 組 · 速度最高 8 km/h · 坡度最高 3 %');
  });

  it('欄位無單位且值為 0 時仍正確格式化', () => {
    const log = {
      trackReps: false,
      fields: [{ key: 'lvl', name: '等級', unit: '' }],
      sets: [{ values: { lvl: 0 } }],
    };
    assert.equal(formatLogSummary(log), '1 組 · 等級最高 0');
  });
});

describe('formatSet', () => {
  it('重訓組顯示重量與次數', () => {
    const fields = [{ key: 'w', name: '重量', unit: 'kg' }];
    assert.equal(
      formatSet({ reps: 12, values: { w: 40 } }, fields, true),
      '40 kg × 12 下'
    );
  });

  it('有氧組（trackReps=false）以中點分隔各欄位', () => {
    const fields = [
      { key: 'spd', name: '速度', unit: 'km/h' },
      { key: 'inc', name: '坡度', unit: '%' },
      { key: 'min', name: '時間', unit: '分' },
    ];
    assert.equal(
      formatSet({ values: { spd: 8, inc: 3, min: 20 } }, fields, false),
      '8 km/h · 3 % · 20 分'
    );
  });

  it('無自訂欄位時僅顯示次數', () => {
    assert.equal(formatSet({ reps: 15, values: {} }, [], true), '15 下');
  });
});

describe('formatSetLabeled', () => {
  it('跑步機多欄位（含無單位與有單位、trackReps=false）皆附上欄位名稱', () => {
    const fieldsNoSpdUnit = [
      { key: 'spd', name: '速度', unit: '' },
      { key: 'inc', name: '坡度', unit: '' },
      { key: 'min', name: '時間', unit: '分' },
    ];
    assert.equal(
      formatSetLabeled(
        { values: { spd: 6, inc: 4, min: 15 } },
        fieldsNoSpdUnit,
        false
      ),
      '速度 6 · 坡度 4 · 時間 15 分'
    );

    const fieldsWithSpdUnit = [
      { key: 'spd', name: '速度', unit: 'km/h' },
      { key: 'inc', name: '坡度', unit: '' },
      { key: 'min', name: '時間', unit: '分' },
    ];
    assert.equal(
      formatSetLabeled(
        { values: { spd: 6, inc: 4, min: 15 } },
        fieldsWithSpdUnit,
        false
      ),
      '速度 6 km/h · 坡度 4 · 時間 15 分'
    );
  });

  it('多欄位且記錄次數時帶欄位名與次數，單欄位計次沿用簡潔格式', () => {
    const multiFields = [
      { key: 'w', name: '重量', unit: 'kg' },
      { key: 'seat', name: '座椅', unit: '格' },
    ];
    assert.equal(
      formatSetLabeled({ reps: 12, values: { w: 40, seat: 4 } }, multiFields, true),
      '重量 40 kg · 座椅 4 格 × 12 下'
    );

    const singleField = [{ key: 'w', name: '重量', unit: 'kg' }];
    assert.equal(
      formatSetLabeled({ reps: 12, values: { w: 80 } }, singleField, true),
      '80 kg × 12 下'
    );

    assert.equal(formatSetLabeled({ reps: 20, values: {} }, [], true), '20 下');
  });
});

describe('groupByDate', () => {
  it('日期新到舊排序，同日依 createdAt 舊到新排序', () => {
    const logs = [
      { id: 'l1', date: '2026-11-20', createdAt: '2026-11-20T09:00:00Z' },
      { id: 'l2', date: '2026-11-23', createdAt: '2026-11-23T18:30:00Z' },
      { id: 'l3', date: '2026-11-23', createdAt: '2026-11-23T18:00:00Z' },
      { id: 'l4', date: '2026-11-21', createdAt: '2026-11-21T10:00:00Z' },
    ];

    const grouped = groupByDate(logs);
    assert.deepEqual(
      grouped.map((g) => g.date),
      ['2026-11-23', '2026-11-21', '2026-11-20']
    );
    assert.deepEqual(
      grouped[0].logs.map((l) => l.id),
      ['l3', 'l2']
    );
  });

  it('空陣列回傳空陣列', () => {
    assert.deepEqual(groupByDate([]), []);
  });
});

describe('groupByEquipment', () => {
  const equipmentList = [
    { id: 'eq1', name: '胸推機（新版）', bodyParts: ['胸', '手臂'] },
    { id: 'eq2', name: '跑步機', bodyParts: ['有氧', '腿'] },
    { id: 'eq3', name: '深蹲架', bodyParts: ['腿', '臀'] },
  ];

  const logs = [
    {
      id: 'l1',
      date: '2026-11-20',
      equipmentId: 'eq1',
      equipmentName: '胸推機',
      bodyParts: ['胸'],
      createdAt: '2026-11-20T10:00:00Z',
    },
    {
      id: 'l2',
      date: '2026-11-23',
      equipmentId: 'eq1',
      equipmentName: '胸推機',
      bodyParts: ['胸'],
      createdAt: '2026-11-23T10:00:00Z',
    },
    {
      id: 'l3',
      date: '2026-11-22',
      equipmentId: 'eq_deleted',
      equipmentName: '舊划船機',
      bodyParts: ['背'],
      createdAt: '2026-11-22T10:00:00Z',
    },
  ];

  it('依 lastDate 新到舊排序、保留已刪除器材快照、無紀錄器材排最後', () => {
    const grouped = groupByEquipment(logs, equipmentList);

    assert.deepEqual(
      grouped.map((g) => ({
        id: g.equipmentId,
        name: g.name,
        count: g.count,
        lastDate: g.lastDate,
      })),
      [
        { id: 'eq1', name: '胸推機（新版）', count: 2, lastDate: '2026-11-23' },
        { id: 'eq_deleted', name: '舊划船機', count: 1, lastDate: '2026-11-22' },
        { id: 'eq2', name: '跑步機', count: 0, lastDate: null },
        { id: 'eq3', name: '深蹲架', count: 0, lastDate: null },
      ]
    );

    // 同一器材內的 logs 為新到舊
    assert.deepEqual(
      grouped[0].logs.map((l) => l.id),
      ['l2', 'l1']
    );
    // 已刪除器材保留快照的 bodyParts
    assert.deepEqual(grouped[1].bodyParts, ['背']);
  });
});

describe('groupByBodyPart', () => {
  it('多部位紀錄出現在每個部位、依 BODY_PARTS 排序且自訂部位在後、正確計算不重複天數', () => {
    const logs = [
      {
        id: 'l1',
        date: '2026-11-23',
        bodyParts: ['胸', '手臂'],
        createdAt: '2026-11-23T10:00:00Z',
      },
      {
        id: 'l2',
        date: '2026-11-23',
        bodyParts: ['胸', '前臂'],
        createdAt: '2026-11-23T11:00:00Z',
      },
      {
        id: 'l3',
        date: '2026-11-21',
        bodyParts: ['胸', '腿'],
        createdAt: '2026-11-21T10:00:00Z',
      },
      {
        id: 'l4',
        date: '2026-11-22',
        bodyParts: ['小腿'],
        createdAt: '2026-11-22T10:00:00Z',
      },
    ];

    const grouped = groupByBodyPart(logs);
    assert.deepEqual(
      grouped.map((g) => g.part),
      ['胸', '手臂', '腿', '小腿', '前臂']
    );

    const chest = grouped[0];
    assert.equal(chest.count, 3);
    assert.equal(chest.days, 2); // 11-23（兩筆）與 11-21（一筆）
    assert.deepEqual(
      chest.logs.map((l) => l.id),
      ['l2', 'l1', 'l3']
    );
  });
});

describe('lastLogForEquipment', () => {
  const logs = [
    { id: 'l1', equipmentId: 'eq1', date: '2026-11-18', createdAt: '2026-11-18T10:00:00Z' },
    { id: 'l2', equipmentId: 'eq1', date: '2026-11-20', createdAt: '2026-11-20T09:00:00Z' },
    { id: 'l3', equipmentId: 'eq1', date: '2026-11-20', createdAt: '2026-11-20T15:00:00Z' },
    { id: 'l4', equipmentId: 'eq1', date: '2026-11-23', createdAt: '2026-11-23T10:00:00Z' },
    { id: 'l5', equipmentId: 'eq2', date: '2026-11-23', createdAt: '2026-11-23T11:00:00Z' },
  ];

  it('取得該器材最近一筆紀錄', () => {
    assert.equal(lastLogForEquipment(logs, 'eq1')?.id, 'l4');
  });

  it('提供 beforeDate 時取該日期之前最近一筆（同日取較晚建立者）', () => {
    assert.equal(lastLogForEquipment(logs, 'eq1', '2026-11-23')?.id, 'l3');
    assert.equal(lastLogForEquipment(logs, 'eq1', '2026-11-20')?.id, 'l1');
    assert.equal(lastLogForEquipment(logs, 'eq1', '2026-11-18'), null);
  });

  it('查無紀錄時回傳 null', () => {
    assert.equal(lastLogForEquipment(logs, 'eq999'), null);
  });
});

describe('validateEquipment', () => {
  it('有效器材回傳空陣列', () => {
    const errors = validateEquipment({
      name: '胸推機',
      bodyParts: ['胸', '手臂'],
      fields: [
        { key: 'f1', name: '重量', unit: 'kg' },
        { key: 'f2', name: '座椅', unit: '格' },
      ],
    });
    assert.deepEqual(errors, []);
  });

  it('無自訂欄位（徒手訓練）仍視為有效', () => {
    assert.deepEqual(
      validateEquipment({ name: '伏地挺身', bodyParts: ['胸'], fields: [] }),
      []
    );
  });

  it('名稱空白、無部位、欄位空白或重複皆回傳錯誤訊息', () => {
    const errors = validateEquipment({
      name: '   ',
      bodyParts: [],
      fields: [
        { key: 'f1', name: '重量', unit: 'kg' },
        { key: 'f2', name: ' 重量 ', unit: 'lb' },
        { key: 'f3', name: '  ', unit: '' },
      ],
    });

    assert.equal(errors.length, 4);
    assert.ok(errors.some((e) => e.includes('名稱')));
    assert.ok(errors.some((e) => e.includes('部位')));
    assert.ok(errors.some((e) => e.includes('重複')));
    assert.ok(errors.some((e) => e.includes('空白')));
  });
});

describe('parseFirebaseConfig', () => {
  it('解析純 JSON 設定', () => {
    const json = JSON.stringify({
      apiKey: 'AIzaSyTestKey',
      authDomain: 'demo.firebaseapp.com',
      projectId: 'demo-project',
      appId: '1:123456:web:abcdef',
    });

    const cfg = parseFirebaseConfig(json);
    assert.equal(cfg.apiKey, 'AIzaSyTestKey');
    assert.equal(cfg.authDomain, 'demo.firebaseapp.com');
    assert.equal(cfg.projectId, 'demo-project');
    assert.equal(cfg.appId, '1:123456:web:abcdef');
  });

  it('解析 Firebase 主控台複製的 JS 片段（未加引號 key、單引號、結尾逗號、註解與 URL）', () => {
    const snippet = `
      // Import the functions you need from the SDKs you need
      import { initializeApp } from "firebase/app";
      /* Your web app's Firebase configuration */
      const firebaseConfig = {
        apiKey: 'AIzaSyConsoleKey',
        authDomain: "demo.firebaseapp.com",
        databaseURL: "https://demo-default-rtdb.firebaseio.com",
        projectId: 'demo-project',
        storageBucket: "demo.firebasestorage.app",
        messagingSenderId: "123456789",
        appId: "1:123456789:web:abcdef012345",
      };
      const app = initializeApp(firebaseConfig);
    `;

    const cfg = parseFirebaseConfig(snippet);
    assert.equal(cfg.apiKey, 'AIzaSyConsoleKey');
    assert.equal(cfg.authDomain, 'demo.firebaseapp.com');
    assert.equal(cfg.databaseURL, 'https://demo-default-rtdb.firebaseio.com');
    assert.equal(cfg.projectId, 'demo-project');
    assert.equal(cfg.appId, '1:123456789:web:abcdef012345');
  });

  it('缺少必要欄位時丟出正體中文 Error', () => {
    assert.throws(
      () =>
        parseFirebaseConfig(
          `const firebaseConfig = { apiKey: "k", projectId: "p" };`
        ),
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /缺少必要欄位/);
        assert.match(err.message, /authDomain/);
        assert.match(err.message, /appId/);
        return true;
      }
    );
  });

  it('空白或無效內容時丟出正體中文 Error', () => {
    assert.throws(() => parseFirebaseConfig(''), /請貼上/);
    assert.throws(() => parseFirebaseConfig('not a config'), /無法解析/);
  });
});
