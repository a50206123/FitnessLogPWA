/**
 * 健身記錄 PWA 示範假資料產生模組
 * 產生固定可重現的示範器材與近期訓練紀錄（不使用 Math.random）。
 */

import { toDateStr } from './logic.js';

/**
 * 依據基準日期往前推算指定天數，並設定本地時間，回傳 Date 物件
 * @param {Date} baseDate 基準日期
 * @param {number} daysAgo 往前推算的天數（0 表示當天）
 * @param {number} hour 小時（0-23）
 * @param {number} minute 分鐘（0-59）
 * @returns {Date}
 */
function shiftLocalDate(baseDate, daysAgo, hour = 19, minute = 0) {
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate() - daysAgo,
    hour,
    minute,
    0,
    0
  );
}

/**
 * 建立固定器材清單（共 7 種器材）
 * @param {string} createdIso 建立與更新時間 ISO 字串
 * @returns {Array<object>}
 */
function buildEquipmentList(createdIso) {
  return [
    {
      id: 'demo_eq_treadmill',
      name: '跑步機',
      bodyParts: ['有氧'],
      instructions:
        '先雙腳站上兩側踏板並夾好安全夾，啟動後從慢走開始熱身；跑步時保持核心穩定、視線平視前方，避免扶把手影響步態。',
      trackReps: false,
      fields: [
        { key: 'f_speed', name: '速度', unit: 'km/h' },
        { key: 'f_incline', name: '坡度', unit: '%' },
        { key: 'f_time', name: '時間', unit: '分' },
      ],
      createdAt: createdIso,
      updatedAt: createdIso,
    },
    {
      id: 'demo_eq_chest_press',
      name: '胸推機',
      bodyParts: ['胸', '手臂'],
      instructions:
        '調整座椅高度使握把對齊胸線中段，肩胛骨後收貼緊靠背；吐氣往前推至手肘微彎不鎖死，吸氣慢速控制回放。',
      trackReps: true,
      fields: [{ key: 'f_weight', name: '重量', unit: 'kg' }],
      createdAt: createdIso,
      updatedAt: createdIso,
    },
    {
      id: 'demo_eq_lat_pulldown',
      name: '滑輪下拉',
      bodyParts: ['背', '手臂'],
      instructions:
        '調整大腿固定墊壓穩雙腿，寬握拉桿並微仰上半身；沉肩啟動背部肌群將拉桿拉至鎖骨前緣，停頓一秒後控制還原。',
      trackReps: true,
      fields: [{ key: 'f_weight', name: '重量', unit: 'kg' }],
      createdAt: createdIso,
      updatedAt: createdIso,
    },
    {
      id: 'demo_eq_leg_press',
      name: '腿推機',
      bodyParts: ['腿', '臀'],
      instructions:
        '雙腳與肩同寬踩在踏板中段，下背與臀部全程貼緊靠墊；屈膝下放至約 90 度後以腳跟發力推起，頂點膝蓋保持微彎不鎖死。',
      trackReps: true,
      fields: [{ key: 'f_weight', name: '重量', unit: 'kg' }],
      createdAt: createdIso,
      updatedAt: createdIso,
    },
    {
      id: 'demo_eq_lateral_raise',
      name: '啞鈴側平舉',
      bodyParts: ['肩'],
      instructions:
        '站姿核心收緊、手肘微彎，將啞鈴沿身體兩側微前傾約 30 度舉至與肩同高；全程避免聳肩借力，慢速下放感受側三角肌張力。',
      trackReps: true,
      fields: [{ key: 'f_weight', name: '重量', unit: 'kg' }],
      createdAt: createdIso,
      updatedAt: createdIso,
    },
    {
      id: 'demo_eq_seated_row',
      name: '坐姿划船機',
      bodyParts: ['背', '手臂'],
      instructions:
        '調整胸墊位置使手臂自然伸直可握到握把，挺胸不圓背；吐氣將手肘往後帶並夾緊肩胛骨，回放時控制速度不聳肩。',
      trackReps: true,
      fields: [{ key: 'f_weight', name: '重量', unit: 'kg' }],
      createdAt: createdIso,
      updatedAt: createdIso,
    },
    {
      id: 'demo_eq_ab_crunch',
      name: '腹肌捲腹機',
      bodyParts: ['核心'],
      instructions:
        '調整座椅讓轉軸對齊腰部，雙手輕扶握把不拉扯頸部；吐氣收縮腹部帶動胸口往骨盆捲曲，停頓一秒後緩慢還原。',
      trackReps: true,
      fields: [{ key: 'f_weight', name: '重量', unit: 'kg' }],
      createdAt: createdIso,
      updatedAt: createdIso,
    },
  ];
}

/**
 * 快速建立重量訓練組數陣列
 * @param {Array<[number, number]>} pairs 每組為 [重量kg, 次數]
 */
function weightSets(pairs) {
  return pairs.map(([weight, reps]) => ({
    reps,
    values: { f_weight: weight },
  }));
}

/**
 * 快速建立跑步機組數陣列（熱身／主訓練／緩和）
 * @param {Array<[number, number, number]>} triples 每組為 [速度km/h, 坡度%, 時間分]
 */
function treadmillSets(triples) {
  return triples.map(([speed, incline, time]) => ({
    values: {
      f_speed: speed,
      f_incline: incline,
      f_time: time,
    },
  }));
}

/**
 * 21 天內共 9 個訓練日的固定課表（重量與速度隨時間微幅漸進）
 */
const DEMO_SESSIONS = [
  {
    daysAgo: 20,
    startHour: 19,
    entries: [
      {
        equipmentId: 'demo_eq_chest_press',
        sets: weightSets([
          [35, 12],
          [35, 12],
          [40, 10],
        ]),
        note: '暖身後狀態不錯，最後一組收尾穩定',
      },
      {
        equipmentId: 'demo_eq_lateral_raise',
        sets: weightSets([
          [6, 12],
          [6, 12],
          [6, 12],
        ]),
        note: '',
      },
      {
        equipmentId: 'demo_eq_ab_crunch',
        sets: weightSets([
          [25, 15],
          [25, 15],
          [25, 12],
        ]),
        note: '慢速控制捲腹感受度佳',
      },
    ],
  },
  {
    daysAgo: 18,
    startHour: 19,
    entries: [
      {
        equipmentId: 'demo_eq_lat_pulldown',
        sets: weightSets([
          [35, 12],
          [35, 12],
          [40, 10],
        ]),
        note: '專注肩胛下沉帶動',
      },
      {
        equipmentId: 'demo_eq_seated_row',
        sets: weightSets([
          [35, 12],
          [35, 12],
          [35, 10],
        ]),
        note: '',
      },
      {
        equipmentId: 'demo_eq_treadmill',
        sets: treadmillSets([
          [5.5, 1, 5],
          [8, 1, 18],
          [5, 0, 5],
        ]),
        note: '熱身 5 分、主跑 18 分、緩和快走 5 分',
      },
    ],
  },
  {
    daysAgo: 15,
    startHour: 10,
    entries: [
      {
        equipmentId: 'demo_eq_leg_press',
        sets: weightSets([
          [70, 12],
          [75, 12],
          [80, 10],
          [80, 10],
        ]),
        note: '腳跟穩定推起，膝蓋角度控制良好',
      },
      {
        equipmentId: 'demo_eq_ab_crunch',
        sets: weightSets([
          [25, 15],
          [30, 12],
          [30, 12],
        ]),
        note: '',
      },
      {
        equipmentId: 'demo_eq_treadmill',
        sets: treadmillSets([
          [5.5, 1, 5],
          [8, 2, 20],
          [5, 0, 5],
        ]),
        note: '坡度調高到 2%，心率維持有氧區間',
      },
    ],
  },
  {
    daysAgo: 13,
    startHour: 19,
    entries: [
      {
        equipmentId: 'demo_eq_chest_press',
        sets: weightSets([
          [35, 12],
          [40, 12],
          [40, 10],
          [40, 10],
        ]),
        note: '40 kg 可穩定完成三組',
      },
      {
        equipmentId: 'demo_eq_lat_pulldown',
        sets: weightSets([
          [35, 12],
          [40, 10],
          [40, 10],
        ]),
        note: '',
      },
      {
        equipmentId: 'demo_eq_lateral_raise',
        sets: weightSets([
          [6, 15],
          [7, 12],
          [7, 12],
        ]),
        note: '嘗試升級 7 kg，組間休息 75 秒',
      },
      {
        equipmentId: 'demo_eq_ab_crunch',
        sets: weightSets([
          [30, 15],
          [30, 12],
          [30, 12],
        ]),
        note: '',
      },
    ],
  },
  {
    daysAgo: 10,
    startHour: 19,
    entries: [
      {
        equipmentId: 'demo_eq_leg_press',
        sets: weightSets([
          [75, 12],
          [80, 12],
          [85, 10],
          [85, 10],
        ]),
        note: '重量順利推上 85 kg',
      },
      {
        equipmentId: 'demo_eq_seated_row',
        sets: weightSets([
          [35, 12],
          [40, 12],
          [40, 10],
        ]),
        note: '頂峰收縮停頓 1 秒',
      },
      {
        equipmentId: 'demo_eq_treadmill',
        sets: treadmillSets([
          [6, 1, 5],
          [8.5, 2, 20],
          [5, 0, 5],
        ]),
        note: '主段速度提升至 8.5 km/h',
      },
    ],
  },
  {
    daysAgo: 8,
    startHour: 10,
    entries: [
      {
        equipmentId: 'demo_eq_chest_press',
        sets: weightSets([
          [40, 12],
          [40, 12],
          [42.5, 10],
          [42.5, 10],
        ]),
        note: '加 2.5 kg 微調插片，胸肌充血明顯',
      },
      {
        equipmentId: 'demo_eq_lateral_raise',
        sets: weightSets([
          [6, 15],
          [7, 12],
          [7, 12],
          [7, 10],
        ]),
        note: '',
      },
      {
        equipmentId: 'demo_eq_ab_crunch',
        sets: weightSets([
          [30, 15],
          [30, 15],
          [35, 12],
        ]),
        note: '最後一組挑戰 35 kg 成功',
      },
    ],
  },
  {
    daysAgo: 5,
    startHour: 19,
    entries: [
      {
        equipmentId: 'demo_eq_lat_pulldown',
        sets: weightSets([
          [40, 12],
          [40, 12],
          [42.5, 10],
          [42.5, 10],
        ]),
        note: '背部發力感比上週更好',
      },
      {
        equipmentId: 'demo_eq_seated_row',
        sets: weightSets([
          [40, 12],
          [40, 12],
          [42.5, 10],
          [42.5, 10],
        ]),
        note: '',
      },
      {
        equipmentId: 'demo_eq_treadmill',
        sets: treadmillSets([
          [6, 1, 5],
          [8.5, 2.5, 22],
          [5.5, 0, 5],
        ]),
        note: '拉長主跑時間至 22 分鐘',
      },
    ],
  },
  {
    daysAgo: 2,
    startHour: 18,
    entries: [
      {
        equipmentId: 'demo_eq_leg_press',
        sets: weightSets([
          [80, 12],
          [85, 12],
          [90, 10],
          [90, 10],
        ]),
        note: '突破 90 kg，動作幅度完整',
      },
      {
        equipmentId: 'demo_eq_lateral_raise',
        sets: weightSets([
          [7, 12],
          [8, 10],
          [8, 10],
        ]),
        note: '升至 8 kg，最後兩下保持慢放',
      },
      {
        equipmentId: 'demo_eq_ab_crunch',
        sets: weightSets([
          [30, 15],
          [35, 12],
          [35, 12],
          [35, 12],
        ]),
        note: '',
      },
      {
        equipmentId: 'demo_eq_treadmill',
        sets: treadmillSets([
          [6, 1, 5],
          [9, 2, 20],
          [5.5, 0, 5],
        ]),
        note: '速度順利上到 9 km/h，呼吸節奏平穩',
      },
    ],
  },
  {
    daysAgo: 0,
    startHour: 18,
    entries: [
      {
        equipmentId: 'demo_eq_chest_press',
        sets: weightSets([
          [40, 12],
          [42.5, 10],
          [45, 10],
          [45, 8],
        ]),
        note: '今日推上 45 kg 新高！',
      },
      {
        equipmentId: 'demo_eq_lat_pulldown',
        sets: weightSets([
          [40, 12],
          [42.5, 10],
          [45, 10],
          [45, 8],
        ]),
        note: '最後一組稍重但姿勢維持穩定',
      },
      {
        equipmentId: 'demo_eq_seated_row',
        sets: weightSets([
          [40, 12],
          [45, 10],
          [45, 10],
        ]),
        note: '',
      },
      {
        equipmentId: 'demo_eq_ab_crunch',
        sets: weightSets([
          [35, 15],
          [35, 12],
          [35, 12],
        ]),
        note: '今日收操核心訓練完成',
      },
    ],
  },
];

/**
 * 產生示範用的器材清單與近期訓練紀錄
 * @param {Date | string | number} [today=new Date()] 作為「今天」的基準日期
 * @returns {{ equipment: Array<object>, logs: Array<object> }}
 */
export function buildDemoData(today = new Date()) {
  const baseDate = today instanceof Date ? today : new Date(today);
  const equipmentCreatedIso = shiftLocalDate(baseDate, 25, 9, 0).toISOString();
  const equipment = buildEquipmentList(equipmentCreatedIso);
  const eqById = new Map(equipment.map((eq) => [eq.id, eq]));

  const logs = [];
  DEMO_SESSIONS.forEach((session, sessionIdx) => {
    const sessionNum = String(sessionIdx + 1).padStart(2, '0');
    session.entries.forEach((entry, entryIdx) => {
      const eq = eqById.get(entry.equipmentId);
      if (!eq) return;

      const entryNum = String(entryIdx + 1).padStart(2, '0');
      const logTime = shiftLocalDate(
        baseDate,
        session.daysAgo,
        session.startHour,
        entryIdx * 15
      );
      const iso = logTime.toISOString();

      logs.push({
        id: `demo_log_${sessionNum}_${entryNum}`,
        date: toDateStr(logTime),
        equipmentId: eq.id,
        equipmentName: eq.name,
        bodyParts: [...eq.bodyParts],
        trackReps: eq.trackReps,
        fields: eq.fields.map((f) => ({ ...f })),
        sets: entry.sets.map((s) => ({
          ...(s.reps !== undefined ? { reps: s.reps } : {}),
          values: { ...s.values },
        })),
        note: entry.note || '',
        createdAt: iso,
        updatedAt: iso,
      });
    });
  });

  return { equipment, logs };
}
