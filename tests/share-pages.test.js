import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeDay,
  SHARE_METRICS,
  compactSetText,
  shareTagRows,
  firstHeaderHeight,
  estimateCardHeight,
  planSharePages,
} from '../web/logic.js';

/**
 * 建立測試用的單筆重訓紀錄（預設 1 個重量欄位、記錄次數）
 * @param {number} idx 序號
 * @param {object} [opts] 客製選項
 */
function makeLog(idx, opts = {}) {
  const setCount = opts.setCount ?? 4;
  const trackReps = opts.trackReps ?? true;
  const fields =
    opts.fields ?? [{ key: 'w', name: '重量', unit: 'kg' }];
  const bodyParts = opts.bodyParts ?? ['胸'];
  const sets =
    opts.sets ??
    Array.from({ length: setCount }, (_, s) => ({
      ...(trackReps ? { reps: 10 } : {}),
      values: Object.fromEntries(fields.map((f) => [f.key, 40 + s * 5])),
    }));

  return {
    id: `log_${idx}`,
    date: '2026-11-23',
    equipmentId: opts.equipmentId ?? `eq_${idx}`,
    equipmentName: opts.equipmentName ?? `器材 ${idx + 1}`,
    bodyParts,
    trackReps,
    fields,
    sets,
    note: opts.note ?? '',
    createdAt: `2026-11-23T${String(10 + Math.floor(idx / 60)).padStart(2, '0')}:${String(idx % 60).padStart(2, '0')}:00Z`,
  };
}

/**
 * 驗證排版計畫的所有幾何不變量：
 * 1. 每張卡片皆位於內容區內：y + h ≤ bodyTop + bodyH 且 x + w ≤ size − pad（且 x ≥ pad、y ≥ bodyTop）
 * 2. 同頁同欄卡片互不重疊且維持間距 gap
 * 3. pageNo 與 total 正確、第 1 張 hasSummary 為 true 其餘為 false
 * @param {ReturnType<typeof planSharePages>} plan
 * @param {typeof SHARE_METRICS} [metrics=SHARE_METRICS]
 */
function assertPlanGeometry(plan, metrics = SHARE_METRICS) {
  assert.ok(plan.pages.length >= 1, '至少應有 1 頁');
  const total = plan.pages.length;

  for (let pIdx = 0; pIdx < total; pIdx++) {
    const page = plan.pages[pIdx];
    assert.equal(page.pageNo, pIdx + 1, 'pageNo 應從 1 依序遞增');
    assert.equal(page.total, total, '每頁 total 應等於總頁數');
    assert.equal(
      page.hasSummary,
      pIdx === 0,
      '僅第 1 頁 hasSummary 為 true，其餘為 false'
    );

    const byCol = new Map();
    for (const card of page.cards) {
      assert.ok(card.x >= metrics.pad, `卡片 x (${card.x}) 不可小於左邊距`);
      assert.ok(
        card.x + card.w <= metrics.size - metrics.pad,
        `卡片右緣 (${card.x + card.w}) 不可超過 size - pad (${metrics.size - metrics.pad})`
      );
      assert.ok(card.y >= page.bodyTop, `卡片 y (${card.y}) 不可小於 bodyTop`);
      assert.ok(
        card.y + card.h <= page.bodyTop + page.bodyH,
        `卡片下緣 (${card.y + card.h}) 不可超過 bodyTop + bodyH (${page.bodyTop + page.bodyH})`
      );

      if (!byCol.has(card.col)) byCol.set(card.col, []);
      byCol.get(card.col).push(card);
    }

    for (const [col, colCards] of byCol.entries()) {
      const sorted = [...colCards].sort((a, b) => a.y - b.y);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        assert.ok(
          prev.y + prev.h <= curr.y,
          `第 ${page.pageNo} 頁第 ${col} 欄卡片重疊：${prev.y + prev.h} > ${curr.y}`
        );
        assert.equal(
          curr.y - (prev.y + prev.h),
          metrics.gap,
          `第 ${page.pageNo} 頁第 ${col} 欄卡片間距應為 gap (${metrics.gap})`
        );
      }
    }
  }
}

describe('SHARE_METRICS', () => {
  it('定義符合規格的 1080×1080 常數且為唯讀物件', () => {
    assert.equal(SHARE_METRICS.size, 1080);
    assert.equal(SHARE_METRICS.pad, 56);
    assert.equal(SHARE_METRICS.gap, 20);
    assert.equal(SHARE_METRICS.footerH, 56);
    assert.equal(SHARE_METRICS.headerOtherH, 92);
    assert.equal(SHARE_METRICS.normal.cols, 1);
    assert.equal(SHARE_METRICS.normal.setsPerRow, 1);
    assert.equal(SHARE_METRICS.compact.cols, 2);
    assert.equal(SHARE_METRICS.compact.setsPerRow, 2);
    assert.ok(Object.isFrozen(SHARE_METRICS));
  });
});

describe('compactSetText', () => {
  it('只有 1 個欄位且 trackReps=true 時輸出「值×次數」（不含單位）', () => {
    const fields = [{ key: 'w', name: '重量', unit: 'kg' }];
    assert.equal(
      compactSetText({ reps: 12, values: { w: 80 } }, fields, true),
      '80×12'
    );
    assert.equal(
      compactSetText({ reps: 0, values: { w: 0 } }, fields, true),
      '0×0'
    );
  });

  it('多欄位且 trackReps=false 時以「值+單位」空白連接', () => {
    const fields = [
      { key: 'spd', name: '速度', unit: 'km/h' },
      { key: 'inc', name: '坡度', unit: '%' },
      { key: 'min', name: '時間', unit: '分' },
    ];
    assert.equal(
      compactSetText({ values: { spd: 6, inc: 1, min: 5 } }, fields, false),
      '6km/h 1% 5分'
    );
  });

  it('多欄位且 trackReps=true 時於末尾附加「 ×次數」', () => {
    const fields = [
      { key: 'w', name: '重量', unit: 'kg' },
      { key: 'seat', name: '座椅', unit: '格' },
    ];
    assert.equal(
      compactSetText({ reps: 12, values: { w: 40, seat: 4 } }, fields, true),
      '40kg 4格 ×12'
    );
  });

  it('單欄位但 trackReps=false 時保留單位輸出「值+單位」', () => {
    const fields = [{ key: 'min', name: '時間', unit: '分' }];
    assert.equal(
      compactSetText({ reps: 99, values: { min: 20 } }, fields, false),
      '20分'
    );
  });

  it('空值略過（部分欄位缺漏、徒手訓練無欄位、欄位無單位與全空組）', () => {
    const multiFields = [
      { key: 'spd', name: '速度', unit: 'km/h' },
      { key: 'inc', name: '坡度', unit: '%' },
      { key: 'lvl', name: '強度', unit: '' },
    ];
    assert.equal(
      compactSetText({ values: { spd: 8, inc: '', lvl: 3 } }, multiFields, false),
      '8km/h 3'
    );
    assert.equal(
      compactSetText({ reps: 10, values: { spd: '', inc: null, lvl: 5 } }, multiFields, true),
      '5 ×10'
    );

    const singleField = [{ key: 'w', name: '重量', unit: 'kg' }];
    assert.equal(
      compactSetText({ reps: '', values: { w: 60 } }, singleField, true),
      '60'
    );
    assert.equal(
      compactSetText({ reps: 12, values: { w: '' } }, singleField, true),
      '12下'
    );

    // 徒手訓練（無自訂欄位）
    assert.equal(compactSetText({ reps: 15, values: {} }, [], true), '15下');

    // 全空或無效輸入
    assert.equal(compactSetText({ reps: '', values: {} }, singleField, true), '');
    assert.equal(compactSetText(null, singleField, true), '');
  });
});

describe('shareTagRows 與 firstHeaderHeight', () => {
  it('無部位回傳 0，少量部位為 1 列，超出可用寬自動換列', () => {
    assert.equal(shareTagRows([]), 0);
    assert.equal(shareTagRows(null), 0);
    assert.equal(shareTagRows(['胸', '背', '手臂']), 1);

    // 可用寬 = 1080 - 2*56 = 968；每個 2 字標籤寬 = 2*28 + 44 = 100，間距 12
    // 8 個標籤寬度 = 8*100 + 7*12 = 884 ≤ 968（1 列）；第 9 個會超過 968 → 2 列
    const eightTags = Array.from({ length: 8 }, (_, i) => `部${i}`);
    const nineTags = Array.from({ length: 9 }, (_, i) => `部${i}`);
    assert.equal(shareTagRows(eightTags), 1);
    assert.equal(shareTagRows(nineTags), 2);
  });

  it('firstHeaderHeight 依公式計算（含無 cardio、有 cardio 與多列標籤）', () => {
    const m = SHARE_METRICS;
    // 1 列標籤、無有氧
    const h1 = firstHeaderHeight({ bodyParts: ['胸', '手臂'], cardio: [] });
    assert.equal(
      h1,
      m.dateH + m.gap + 1 * m.tagRowH + m.gap + m.statsH + m.gap
    );

    // 1 列標籤、有有氧
    const h2 = firstHeaderHeight({
      bodyParts: ['有氧'],
      cardio: [{ name: '時間', unit: '分', total: 30 }],
    });
    assert.equal(h2, h1 + m.cardioH);

    // 無部位、無有氧
    const h0 = firstHeaderHeight({ bodyParts: [], cardio: [] });
    assert.equal(h0, m.dateH + m.gap + 0 + m.gap + m.statsH + m.gap);
  });
});

describe('estimateCardHeight', () => {
  it('依 normal 與 compact 模式公式計算卡片高度（含每列組數與備註折行上限）', () => {
    const m = SHARE_METRICS;
    const singleFieldLog = makeLog(0, { setCount: 5, note: '' });

    // normal 恆為每列 1 組 → 5 列
    assert.equal(
      estimateCardHeight(singleFieldLog, 'normal'),
      2 * m.normal.padY + m.normal.titleH + 5 * m.normal.rowH
    );

    // compact 且 fields.length ≤ 1 → 每列 2 組 → ceil(5/2) = 3 列
    assert.equal(
      estimateCardHeight(singleFieldLog, 'compact'),
      2 * m.compact.padY + m.compact.titleH + 3 * m.compact.rowH
    );

    // compact 但 fields.length > 1 → 每列 1 組 → 5 列
    const multiFieldLog = makeLog(1, {
      setCount: 5,
      fields: [
        { key: 'w', name: '重量', unit: 'kg' },
        { key: 'seat', name: '座椅', unit: '格' },
      ],
    });
    assert.equal(
      estimateCardHeight(multiFieldLog, 'compact'),
      2 * m.compact.padY + m.compact.titleH + 5 * m.compact.rowH
    );

    // 長備註應受 noteMaxLines 限制（normal 上限 2 列、compact 上限 1 列）
    const longNoteLog = makeLog(2, {
      setCount: 2,
      note: '這是一段非常長的訓練備註文字，用來確認在正常與緊湊模式下都會依最大行數上限截斷計算高度，不會無限增加。',
    });
    assert.equal(
      estimateCardHeight(longNoteLog, 'normal'),
      2 * m.normal.padY +
        m.normal.titleH +
        2 * m.normal.rowH +
        m.normal.noteMaxLines * m.normal.noteLineH
    );
    assert.equal(
      estimateCardHeight(longNoteLog, 'compact'),
      2 * m.compact.padY +
        m.compact.titleH +
        1 * m.compact.rowH +
        m.compact.noteMaxLines * m.compact.noteLineH
    );
  });
});

describe('planSharePages', () => {
  it('空陣列回傳 1 張只有總結的頁（cards 為空）', () => {
    const summary = summarizeDay([]);
    const plan = planSharePages(summary);

    assert.equal(plan.mode, 'normal');
    assert.equal(plan.pages.length, 1);
    assert.equal(plan.pages[0].pageNo, 1);
    assert.equal(plan.pages[0].total, 1);
    assert.equal(plan.pages[0].hasSummary, true);
    assert.deepEqual(plan.pages[0].cards, []);
    assertPlanGeometry(plan);
  });

  it('少量紀錄 → normal 模式 1 張完成排版', () => {
    const logs = [
      makeLog(0, { equipmentName: '胸推機', setCount: 3 }),
      makeLog(1, { equipmentName: '蝴蝶機', setCount: 3 }),
    ];
    const summary = summarizeDay(logs);
    const plan = planSharePages(summary);

    assert.equal(plan.mode, 'normal');
    assert.equal(plan.pages.length, 1);
    assert.equal(plan.pages[0].total, 1);
    assert.equal(plan.pages[0].hasSummary, true);
    assert.equal(plan.pages[0].cards.length, 2);
    assert.deepEqual(
      plan.pages[0].cards.map((c) => c.logIndex),
      [0, 1]
    );
    for (const card of plan.pages[0].cards) {
      assert.equal(card.col, 0);
      assert.equal(card.x, SHARE_METRICS.pad);
      assert.equal(card.w, SHARE_METRICS.size - 2 * SHARE_METRICS.pad);
      assert.equal(card.hiddenSets, 0);
      assert.equal(card.rowsShown, card.totalRows);
    }
    assertPlanGeometry(plan);
  });

  it('8 台器材各 4 組 → 自動切換 compact 兩欄模式且排版不超出邊界', () => {
    const logs = Array.from({ length: 8 }, (_, i) =>
      makeLog(i, { setCount: 4, bodyParts: ['胸', '背'] })
    );
    const summary = summarizeDay(logs);
    const plan = planSharePages(summary);

    assert.equal(plan.mode, 'compact');
    const allCards = plan.pages.flatMap((p) => p.cards);
    assert.equal(allCards.length, 8);
    assert.deepEqual(
      allCards.map((c) => c.logIndex),
      [0, 1, 2, 3, 4, 5, 6, 7]
    );

    const expectedColW =
      (SHARE_METRICS.size - 2 * SHARE_METRICS.pad - SHARE_METRICS.gap) / 2;
    const colsUsed = new Set(allCards.map((c) => c.col));
    assert.ok(colsUsed.has(0) && colsUsed.has(1), 'compact 模式應使用雙欄');
    for (const card of allCards) {
      assert.equal(card.w, expectedColW);
      assert.equal(card.hiddenSets, 0);
    }
    assertPlanGeometry(plan);
  });

  it('12 台以上器材 → 多張分頁、total 正確、僅第 1 張 hasSummary、logIndex 依頁依序遞增覆蓋全部', () => {
    const logs = Array.from({ length: 14 }, (_, i) =>
      makeLog(i, {
        setCount: i % 3 === 0 ? 5 : 4,
        bodyParts: i % 2 === 0 ? ['胸', '手臂'] : ['背', '肩'],
        note: i % 4 === 0 ? '維持穩定節奏與完整行程' : '',
      })
    );
    const summary = summarizeDay(logs);
    const plan = planSharePages(summary);

    assert.equal(plan.mode, 'compact');
    assert.ok(plan.pages.length >= 2, '14 台器材應自動分成多張');

    // 檢查頁數、hasSummary 與第 2 張以後的 bodyTop
    const expectedOtherBodyTop =
      SHARE_METRICS.pad + SHARE_METRICS.headerOtherH;
    const expectedOtherBodyH =
      SHARE_METRICS.size -
      SHARE_METRICS.pad -
      SHARE_METRICS.footerH -
      expectedOtherBodyTop;

    for (let p = 0; p < plan.pages.length; p++) {
      const page = plan.pages[p];
      assert.equal(page.pageNo, p + 1);
      assert.equal(page.total, plan.pages.length);
      assert.equal(page.hasSummary, p === 0);
      if (p > 0) {
        assert.equal(page.bodyTop, expectedOtherBodyTop);
        assert.equal(page.bodyH, expectedOtherBodyH);
      }
    }

    // 確認所有紀錄依序覆蓋、無遺漏無重複且 logIndex 依頁依序遞增
    const flatIndices = plan.pages.flatMap((p) =>
      p.cards.map((c) => c.logIndex)
    );
    assert.deepEqual(
      flatIndices,
      Array.from({ length: logs.length }, (_, i) => i)
    );

    assertPlanGeometry(plan);
  });

  it('單一器材 40 組 → 超過整頁高度時自動截斷組數且 hiddenSets > 0、不溢出邊界', () => {
    const logs = [
      makeLog(0, {
        equipmentName: '深蹲架',
        setCount: 40,
        bodyParts: ['腿', '臀'],
      }),
    ];
    const summary = summarizeDay(logs);
    const plan = planSharePages(summary);

    assert.equal(plan.mode, 'compact');
    assert.equal(plan.pages.length, 1);
    assert.equal(plan.pages[0].cards.length, 1);

    const card = plan.pages[0].cards[0];
    assert.equal(card.logIndex, 0);
    assert.equal(card.totalRows, 20); // 1 欄位每列 2 組 → 40 / 2 = 20 列
    assert.ok(card.rowsShown >= 1 && card.rowsShown < card.totalRows);
    assert.ok(card.hiddenSets > 0, '應有被截斷隱藏的組數');
    assert.equal(card.hiddenSets, 40 - card.rowsShown * 2);

    // 截斷後卡片高度應包含保留給「…另 N 組」的 1 列，且不超出內容區
    const c = SHARE_METRICS.compact;
    const expectedH = 2 * c.padY + c.titleH + (card.rowsShown + 1) * c.rowH;
    assert.equal(card.h, expectedH);
    assertPlanGeometry(plan);
  });

  it('多器材中夾雜 40 組超長紀錄 → 自動換頁後截斷且所有卡片不重疊、不超界', () => {
    const logs = [
      makeLog(0, { setCount: 4 }),
      makeLog(1, { setCount: 4 }),
      makeLog(2, { setCount: 40, note: '耐力挑戰日' }),
      makeLog(3, { setCount: 4 }),
    ];
    const summary = summarizeDay(logs);
    const plan = planSharePages(summary);

    assert.equal(plan.mode, 'compact');
    assert.ok(plan.pages.length >= 2);

    const allCards = plan.pages.flatMap((p) => p.cards);
    assert.deepEqual(
      allCards.map((c) => c.logIndex),
      [0, 1, 2, 3]
    );

    const hugeCard = allCards.find((c) => c.logIndex === 2);
    assert.ok(hugeCard.hiddenSets > 0);
    assert.ok(hugeCard.rowsShown < hugeCard.totalRows);
    assertPlanGeometry(plan);
  });
});
