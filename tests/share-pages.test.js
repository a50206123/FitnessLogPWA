import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeDay,
  SHARE_METRICS,
  activeFields,
  cardUnitHeader,
  formatSetLabeled,
  compactSetText,
  setsPerRowFor,
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
 * 驗證單欄＋縮放排版計畫的所有幾何不變量：
 * 1. 每頁 scale 介於 1 ~ 1.45
 * 2. 每張卡片皆為單欄全寬：x === pad、w === width − 2×pad
 * 3. 每張卡片皆位於內容區內：y ≥ bodyTop 且 y + h ≤ bodyTop + bodyH
 * 4. bodyTop + bodyH 對齊 height − pad − footerH
 * 5. 同頁相鄰卡片互不重疊且維持放大後間距 gap × scale
 * 6. pageNo 與 total 正確、僅第 1 頁 hasSummary 為 true
 * @param {ReturnType<typeof planSharePages>} plan
 * @param {typeof SHARE_METRICS} [metrics=SHARE_METRICS]
 */
function assertPlanGeometry(plan, metrics = SHARE_METRICS) {
  assert.ok(plan.pages.length >= 1, '至少應有 1 頁');
  const total = plan.pages.length;
  const expectedW = metrics.width - 2 * metrics.pad;

  for (let pIdx = 0; pIdx < total; pIdx++) {
    const page = plan.pages[pIdx];
    assert.equal(page.pageNo, pIdx + 1, 'pageNo 應從 1 依序遞增');
    assert.equal(page.total, total, '每頁 total 應等於總頁數');
    assert.equal(
      page.hasSummary,
      pIdx === 0,
      '僅第 1 頁 hasSummary 為 true，其餘為 false'
    );
    assert.equal(
      page.bodyTop + page.bodyH,
      metrics.height - metrics.pad - metrics.footerH,
      '內容區下緣應對齊 height - pad - footerH'
    );
    assert.ok(
      typeof page.scale === 'number' && page.scale >= 1 && page.scale <= 1.45,
      `第 ${page.pageNo} 頁 scale (${page.scale}) 應在 1 ~ 1.45 之間`
    );

    const expectedGap = metrics.gap * page.scale;
    for (let i = 0; i < page.cards.length; i++) {
      const card = page.cards[i];
      assert.equal(card.x, metrics.pad, `卡片 x (${card.x}) 應等於 pad (${metrics.pad})`);
      assert.equal(card.w, expectedW, `卡片 w (${card.w}) 應等於 width - 2*pad (${expectedW})`);
      assert.ok(card.y >= page.bodyTop, `卡片 y (${card.y}) 不可小於 bodyTop`);
      assert.ok(
        card.y + card.h <= page.bodyTop + page.bodyH,
        `卡片下緣 (${card.y + card.h}) 不可超過 bodyTop + bodyH (${page.bodyTop + page.bodyH})`
      );
      assert.ok(
        card.y + card.h <= metrics.height - metrics.pad - metrics.footerH,
        `卡片下緣 (${card.y + card.h}) 不可超過頁尾邊界 (${metrics.height - metrics.pad - metrics.footerH})`
      );
      assert.ok(
        card.setsPerRow === 1 || card.setsPerRow === 3,
        `卡片 setsPerRow (${card.setsPerRow}) 應為 1 或 3`
      );

      if (i > 0) {
        const prev = page.cards[i - 1];
        assert.ok(
          prev.y + prev.h <= card.y,
          `第 ${page.pageNo} 頁卡片重疊：${prev.y + prev.h} > ${card.y}`
        );
        const actualGap = card.y - (prev.y + prev.h);
        assert.ok(
          Math.abs(actualGap - expectedGap) < 1e-6,
          `第 ${page.pageNo} 頁卡片間距 (${actualGap}) 應等於 gap × scale (${expectedGap})`
        );
      }
    }
  }
}

describe('SHARE_METRICS', () => {
  it('定義符合 v4 規格的 1080×1920（9:16）單欄常數且為唯讀物件', () => {
    assert.equal(SHARE_METRICS.width, 1080);
    assert.equal(SHARE_METRICS.height, 1920);
    assert.equal(SHARE_METRICS.pad, 64);
    assert.equal(SHARE_METRICS.gap, 24);
    assert.equal(SHARE_METRICS.footerH, 72);
    assert.equal(SHARE_METRICS.headerOtherH, 120);
    assert.equal(SHARE_METRICS.dateH, 130);
    assert.equal(SHARE_METRICS.tagRowH, 64);
    assert.equal(SHARE_METRICS.tagCharW, 34);
    assert.equal(SHARE_METRICS.tagPadW, 52);
    assert.equal(SHARE_METRICS.tagGap, 14);
    assert.equal(SHARE_METRICS.statsH, 150);
    assert.equal(SHARE_METRICS.cardioH, 56);
    assert.deepEqual(SHARE_METRICS.normal, {
      cols: 1,
      padY: 22,
      titleH: 58,
      rowH: 46,
      noteLineH: 38,
      noteMaxLines: 2,
      noteCharsPerLine: 30,
      setsPerRow: 1,
    });
    assert.deepEqual(SHARE_METRICS.compact, {
      cols: 1,
      padY: 20,
      titleH: 54,
      rowH: 44,
      noteLineH: 38,
      noteMaxLines: 1,
      noteCharsPerLine: 30,
      setsPerRow: 2,
    });
    assert.ok(Object.isFrozen(SHARE_METRICS));
  });
});

describe('activeFields、cardUnitHeader、formatSetLabeled 與 compactSetText', () => {
  it('activeFields 只回傳任一組有數值的欄位（維持原順序，保留數值 0）', () => {
    const log = {
      fields: [
        { key: 'w', name: '重量', unit: 'kg' },
        { key: 'seat', name: '座椅', unit: '格' },
        { key: 'pin', name: '插銷', unit: '' },
      ],
      sets: [
        { reps: 12, values: { w: '', seat: null, pin: 0 } },
        { reps: 10, values: { w: 40, seat: '  ' } },
      ],
    };
    assert.deepEqual(activeFields(log), [
      { key: 'w', name: '重量', unit: 'kg' },
      { key: 'pin', name: '插銷', unit: '' },
    ]);

    assert.deepEqual(activeFields({ fields: [], sets: [] }), []);
    assert.deepEqual(activeFields(null), []);
  });

  it('跑步機類（速度、坡度無單位、時間 分，trackReps=false）→ compactSetText 與 formatSetLabeled 皆帶欄位名', () => {
    const treadmillFields = [
      { key: 'spd', name: '速度', unit: '' },
      { key: 'inc', name: '坡度', unit: '' },
      { key: 'min', name: '時間', unit: '分' },
    ];
    const set = { values: { spd: 6, inc: 4, min: 15 } };
    const log = makeLog(0, {
      equipmentName: '跑步機',
      bodyParts: ['有氧'],
      trackReps: false,
      fields: treadmillFields,
      sets: [set],
    });

    const active = activeFields(log);
    assert.equal(active.length, 3);
    assert.equal(cardUnitHeader(log), '');
    assert.equal(
      compactSetText(set, active, false),
      '速度 6 · 坡度 4 · 時間 15分'
    );
    assert.equal(
      formatSetLabeled(set, active, false),
      '速度 6 · 坡度 4 · 時間 15 分'
    );
  });

  it('只填次數的器材（有重量欄位但都空）→ cardUnitHeader 為「次數」、compactSetText 為「20 下」', () => {
    const log = makeLog(0, {
      equipmentName: '引體向上',
      bodyParts: ['背'],
      trackReps: true,
      fields: [{ key: 'w', name: '重量', unit: 'kg' }],
      sets: [
        { reps: 20, values: { w: '' } },
        { reps: 18, values: {} },
      ],
    });

    const active = activeFields(log);
    assert.deepEqual(active, []);
    assert.equal(cardUnitHeader(log), '次數');
    assert.equal(compactSetText(log.sets[0], active, true), '20 下');
    assert.equal(formatSetLabeled(log.sets[0], active, true), '20 下');
  });

  it('單一 kg 欄位 → cardUnitHeader 為「kg × 下」、compactSetText 為「80×12」', () => {
    const fields = [{ key: 'w', name: '重量', unit: 'kg' }];
    const log = makeLog(0, {
      equipmentName: '深蹲架',
      trackReps: true,
      fields,
      sets: [{ reps: 12, values: { w: 80 } }],
    });

    const active = activeFields(log);
    assert.equal(active.length, 1);
    assert.equal(cardUnitHeader(log), 'kg × 下');
    assert.equal(compactSetText(log.sets[0], active, true), '80×12');
    assert.equal(
      compactSetText({ reps: 0, values: { w: 0 } }, active, true),
      '0×0'
    );
    assert.equal(formatSetLabeled(log.sets[0], active, true), '80 kg × 12 下');

    // 單一欄位但無單位 → cardUnitHeader 改用欄位名
    const noUnitLog = makeLog(1, {
      trackReps: true,
      fields: [{ key: 'w', name: '重量', unit: '' }],
      sets: [{ reps: 12, values: { w: 5 } }],
    });
    assert.equal(cardUnitHeader(noUnitLog), '重量 × 下');
  });

  it('多欄位計次、單欄位非計次與空值略過皆正確處理', () => {
    // 多欄位計次（cardUnitHeader 為空字串，compactSetText 帶欄位名與 ' × 12 下'）
    const multiFields = [
      { key: 'w', name: '重量', unit: 'kg' },
      { key: 'seat', name: '座椅', unit: '格' },
    ];
    const multiLog = makeLog(0, {
      trackReps: true,
      fields: multiFields,
      sets: [{ reps: 12, values: { w: 40, seat: 4 } }],
    });
    assert.equal(cardUnitHeader(multiLog), '');
    assert.equal(
      compactSetText(multiLog.sets[0], multiFields, true),
      '重量 40kg · 座椅 4格 × 12 下'
    );

    // 單欄位但 trackReps=false → 帶欄位名與單位
    const cardioSingle = [{ key: 'min', name: '時間', unit: '分' }];
    assert.equal(
      compactSetText({ reps: 99, values: { min: 20 } }, cardioSingle, false),
      '時間 20分'
    );
    assert.equal(
      formatSetLabeled({ reps: 99, values: { min: 20 } }, cardioSingle, false),
      '時間 20 分'
    );

    // 部分欄位缺漏與全空組
    const treadmillUnits = [
      { key: 'spd', name: '速度', unit: 'km/h' },
      { key: 'inc', name: '坡度', unit: '%' },
      { key: 'min', name: '時間', unit: '分' },
    ];
    assert.equal(
      compactSetText({ values: { spd: 6, inc: 4, min: 15 } }, treadmillUnits, false),
      '速度 6km/h · 坡度 4% · 時間 15分'
    );
    assert.equal(
      compactSetText({ values: { spd: 8, inc: '', min: 10 } }, treadmillUnits, false),
      '速度 8km/h · 時間 10分'
    );
    assert.equal(
      compactSetText({ reps: '', values: {} }, [{ key: 'w', name: '重量', unit: 'kg' }], true),
      ''
    );
    assert.equal(compactSetText(null, [], true), '');
  });
});

describe('setsPerRowFor 與 estimateCardHeight', () => {
  it('setsPerRowFor：normal 恆 1；compact 有效欄位 ≤ 1 回 3，否則回 1', () => {
    const singleFieldLog = makeLog(0, { setCount: 5 });
    assert.equal(setsPerRowFor(singleFieldLog, 'normal'), 1);
    assert.equal(setsPerRowFor(singleFieldLog, 'compact'), 3);

    // 定義 2 個欄位但只有 1 個有填值 → 有效欄位為 1 → compact 回 3
    const oneActiveLog = makeLog(1, {
      fields: [
        { key: 'w', name: '重量', unit: 'kg' },
        { key: 'seat', name: '座椅', unit: '格' },
      ],
      sets: [
        { reps: 10, values: { w: 40, seat: '' } },
        { reps: 10, values: { w: 45 } },
      ],
    });
    assert.equal(setsPerRowFor(oneActiveLog, 'compact'), 3);

    // 0 個有效欄位（只填次數）→ compact 回 3
    const repsOnlyLog = makeLog(2, {
      fields: [{ key: 'w', name: '重量', unit: 'kg' }],
      sets: [{ reps: 20, values: {} }],
    });
    assert.equal(setsPerRowFor(repsOnlyLog, 'compact'), 3);

    // 2 個有效欄位 → compact 回 1
    const twoActiveLog = makeLog(3, {
      fields: [
        { key: 'w', name: '重量', unit: 'kg' },
        { key: 'seat', name: '座椅', unit: '格' },
      ],
      sets: [{ reps: 10, values: { w: 40, seat: 4 } }],
    });
    assert.equal(setsPerRowFor(twoActiveLog, 'normal'), 1);
    assert.equal(setsPerRowFor(twoActiveLog, 'compact'), 1);
  });

  it('estimateCardHeight 依 setsPerRowFor 與有效欄位計算高度（含備註折行上限）', () => {
    const m = SHARE_METRICS;
    const singleFieldLog = makeLog(0, { setCount: 5, note: '' });

    // normal 恆為每列 1 組 → 5 列
    assert.equal(
      estimateCardHeight(singleFieldLog, 'normal'),
      2 * m.normal.padY + m.normal.titleH + 5 * m.normal.rowH
    );

    // compact 且有效欄位 ≤ 1 → 每列 3 組 → ceil(5/3) = 2 列
    assert.equal(
      estimateCardHeight(singleFieldLog, 'compact'),
      2 * m.compact.padY + m.compact.titleH + 2 * m.compact.rowH
    );

    // 定義 2 個欄位但第 2 欄位都空 → 有效欄位為 1 → compact 仍為每列 3 組（ceil(5/3) = 2 列）
    const sparseTwoFieldLog = makeLog(1, {
      fields: [
        { key: 'w', name: '重量', unit: 'kg' },
        { key: 'seat', name: '座椅', unit: '格' },
      ],
      sets: Array.from({ length: 5 }, () => ({ reps: 10, values: { w: 50, seat: '' } })),
    });
    assert.equal(
      estimateCardHeight(sparseTwoFieldLog, 'compact'),
      2 * m.compact.padY + m.compact.titleH + 2 * m.compact.rowH
    );

    // 2 個有效欄位 → compact 每列 1 組 → 5 列
    const multiFieldLog = makeLog(2, {
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
    const longNoteLog = makeLog(3, {
      setCount: 3,
      note: '這是一段非常長的訓練備註文字，用來確認在正常與緊湊模式下都會依最大行數上限截斷計算高度，不會無限增加。',
    });
    assert.equal(
      estimateCardHeight(longNoteLog, 'normal'),
      2 * m.normal.padY +
        m.normal.titleH +
        3 * m.normal.rowH +
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

describe('shareTagRows 與 firstHeaderHeight', () => {
  it('無部位回傳 0，少量部位為 1 列，超出可用寬自動換列', () => {
    assert.equal(shareTagRows([]), 0);
    assert.equal(shareTagRows(null), 0);
    assert.equal(shareTagRows(['胸', '背', '手臂']), 1);

    // 可用寬 = 1080 - 2*64 = 952；每個 2 字標籤寬 = 2*34 + 52 = 120，間距 14
    // 7 個標籤寬度 = 7*120 + 6*14 = 924 ≤ 952（1 列）；第 8 個會超過 952 → 2 列
    const sevenTags = Array.from({ length: 7 }, (_, i) => `部${i}`);
    const eightTags = Array.from({ length: 8 }, (_, i) => `部${i}`);
    assert.equal(shareTagRows(sevenTags), 1);
    assert.equal(shareTagRows(eightTags), 2);
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

describe('planSharePages', () => {
  it('空陣列回傳 1 張只有總結的頁（cards 為空、scale 為 1）', () => {
    const summary = summarizeDay([]);
    const plan = planSharePages(summary);

    assert.equal(plan.mode, 'normal');
    assert.equal(plan.pages.length, 1);
    assert.equal(plan.pages[0].pageNo, 1);
    assert.equal(plan.pages[0].total, 1);
    assert.equal(plan.pages[0].hasSummary, true);
    assert.equal(plan.pages[0].scale, 1);
    assert.deepEqual(plan.pages[0].cards, []);
    assertPlanGeometry(plan);
  });

  it('少量紀錄不自動放大（scale 固定 1）、卡片由上往下排且最後一張卡 y+h ≤ bodyTop+bodyH', () => {
    const logs = [
      makeLog(0, { equipmentName: '胸推機', setCount: 3 }),
      makeLog(1, { equipmentName: '蝴蝶機', setCount: 3 }),
    ];
    const summary = summarizeDay(logs);
    const plan = planSharePages(summary);

    assert.equal(plan.mode, 'normal');
    assert.equal(plan.pages.length, 1);
    const page = plan.pages[0];
    assert.equal(page.total, 1);
    assert.equal(page.hasSummary, true);
    assert.equal(page.scale, 1, '取消自動放大後 scale 應固定為 1');
    assert.equal(page.cards.length, 2);
    assert.deepEqual(
      page.cards.map((c) => c.logIndex),
      [0, 1]
    );

    const expectedCardW = SHARE_METRICS.width - 2 * SHARE_METRICS.pad;
    const unscaledH0 = estimateCardHeight(logs[0], 'normal');
    const unscaledH1 = estimateCardHeight(logs[1], 'normal');

    assert.equal(page.cards[0].x, SHARE_METRICS.pad);
    assert.equal(page.cards[0].w, expectedCardW);
    assert.equal(page.cards[0].y, page.bodyTop);
    assert.ok(Math.abs(page.cards[0].h - unscaledH0 * page.scale) < 1e-6);
    assert.equal(page.cards[0].setsPerRow, 1);
    assert.equal(page.cards[0].hiddenSets, 0);
    assert.equal(page.cards[0].rowsShown, page.cards[0].totalRows);

    const expectedY1 =
      page.cards[0].y + page.cards[0].h + SHARE_METRICS.gap * page.scale;
    assert.ok(Math.abs(page.cards[1].y - expectedY1) < 1e-6);
    assert.ok(Math.abs(page.cards[1].h - unscaledH1 * page.scale) < 1e-6);

    const lastCard = page.cards[page.cards.length - 1];
    assert.ok(
      lastCard.y + lastCard.h <= page.bodyTop + page.bodyH,
      '最後一張卡下緣不可超過 bodyTop + bodyH'
    );
    assertPlanGeometry(plan);
  });

  it('中等紀錄在 normal 單頁內維持固定字級（scale 為 1）、下方可留白', () => {
    const logs = [
      makeLog(0, { setCount: 4 }),
      makeLog(1, { setCount: 4 }),
      makeLog(2, { setCount: 4 }),
    ];
    const summary = summarizeDay(logs);
    const plan = planSharePages(summary);

    assert.equal(plan.mode, 'normal');
    assert.equal(plan.pages.length, 1);
    const page = plan.pages[0];
    assert.equal(page.scale, 1);
    // 內容少時留白：卡片總高小於可用高度
    assert.ok(page.cards[page.cards.length - 1].y + page.cards[page.cards.length - 1].h < page.bodyTop + page.bodyH);
    const lastCard = page.cards[page.cards.length - 1];
    assert.ok(lastCard.y + lastCard.h <= page.bodyTop + page.bodyH);
    assertPlanGeometry(plan);
  });

  it('大量紀錄分頁：一律單欄（x=pad、w=width−2×pad）、同頁不重疊、依序覆蓋全部紀錄', () => {
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

    const expectedW = SHARE_METRICS.width - 2 * SHARE_METRICS.pad;
    const expectedOtherBodyTop =
      SHARE_METRICS.pad + SHARE_METRICS.headerOtherH;
    const expectedOtherBodyH =
      SHARE_METRICS.height -
      SHARE_METRICS.pad -
      SHARE_METRICS.footerH -
      expectedOtherBodyTop;

    for (let p = 0; p < plan.pages.length; p++) {
      const page = plan.pages[p];
      assert.equal(page.pageNo, p + 1);
      assert.equal(page.total, plan.pages.length);
      assert.equal(page.hasSummary, p === 0);
      assert.ok(page.scale >= 1 && page.scale <= 1.45);
      if (p > 0) {
        assert.equal(page.bodyTop, expectedOtherBodyTop);
        assert.equal(page.bodyH, expectedOtherBodyH);
      }

      for (let cIdx = 0; cIdx < page.cards.length; cIdx++) {
        const card = page.cards[cIdx];
        assert.equal(card.x, SHARE_METRICS.pad);
        assert.equal(card.w, expectedW);
        assert.equal(card.setsPerRow, 3);
        if (cIdx > 0) {
          const prev = page.cards[cIdx - 1];
          assert.ok(prev.y + prev.h <= card.y, '同頁卡片不可重疊');
        }
      }
    }

    // 確認所有紀錄依序覆蓋、無遺漏無重複
    const flatIndices = plan.pages.flatMap((p) =>
      p.cards.map((c) => c.logIndex)
    );
    assert.deepEqual(
      flatIndices,
      Array.from({ length: logs.length }, (_, i) => i)
    );

    assertPlanGeometry(plan);
  });

  it('compact 模式混合單欄位與多欄位器材：每張卡各自回傳正確的 setsPerRow（3 或 1）', () => {
    const logs = [
      makeLog(0, { setCount: 4 }),
      makeLog(1, {
        equipmentName: '跑步機',
        trackReps: false,
        bodyParts: ['有氧'],
        fields: [
          { key: 'spd', name: '速度', unit: '' },
          { key: 'inc', name: '坡度', unit: '' },
          { key: 'min', name: '時間', unit: '分' },
        ],
        sets: [
          { values: { spd: 6, inc: 4, min: 15 } },
          { values: { spd: 7, inc: 2, min: 10 } },
        ],
      }),
      makeLog(2, { setCount: 6 }),
      makeLog(3, { setCount: 6 }),
      makeLog(4, { setCount: 6 }),
    ];
    const summary = summarizeDay(logs);
    const plan = planSharePages(summary);

    assert.equal(plan.mode, 'compact');
    const allCards = plan.pages.flatMap((p) => p.cards);
    assert.equal(allCards[0].setsPerRow, 3);
    assert.equal(allCards[1].setsPerRow, 1);
    assert.equal(allCards[2].setsPerRow, 3);
    assertPlanGeometry(plan);
  });

  it('單一器材 100 組 → 超過整頁高度時自動截斷組數且 hiddenSets > 0、不溢出邊界', () => {
    const logs = [
      makeLog(0, {
        equipmentName: '深蹲架',
        setCount: 100,
        bodyParts: ['腿', '臀'],
      }),
    ];
    const summary = summarizeDay(logs);
    const plan = planSharePages(summary);

    assert.equal(plan.mode, 'compact');
    assert.equal(plan.pages.length, 1);
    assert.equal(plan.pages[0].cards.length, 1);

    const page = plan.pages[0];
    const card = page.cards[0];
    assert.equal(card.logIndex, 0);
    assert.equal(card.setsPerRow, 3);
    assert.equal(card.totalRows, Math.ceil(100 / 3)); // 1 有效欄位每列 3 組 → 34 列
    assert.ok(card.rowsShown >= 1 && card.rowsShown < card.totalRows);
    assert.ok(card.hiddenSets > 0, '應有被截斷隱藏的組數');
    assert.equal(card.hiddenSets, 100 - card.rowsShown * 3);

    // 截斷後卡片高度應包含保留給「…另 N 組」的 1 列並乘上頁面 scale，且不超出內容區
    const c = SHARE_METRICS.compact;
    const expectedUnscaledH = 2 * c.padY + c.titleH + (card.rowsShown + 1) * c.rowH;
    assert.ok(Math.abs(card.h - expectedUnscaledH * page.scale) < 1e-6);
    assertPlanGeometry(plan);
  });

  it('多器材中夾雜 100 組超長紀錄 → 自動換頁後截斷且所有卡片不重疊、不超界', () => {
    const logs = [
      makeLog(0, { setCount: 4 }),
      makeLog(1, { setCount: 4 }),
      makeLog(2, { setCount: 100, note: '耐力挑戰日' }),
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
    assert.equal(hugeCard.setsPerRow, 3);
    assertPlanGeometry(plan);
  });
});
