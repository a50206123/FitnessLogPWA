import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { logDateIndex, shiftMonth, buildMonthGrid } from '../web/logic.js';

describe('logDateIndex', () => {
  it('空陣列與無效輸入回傳空物件', () => {
    assert.deepEqual(logDateIndex([]), {});
    assert.deepEqual(logDateIndex(null), {});
    assert.deepEqual(logDateIndex(undefined), {});
  });

  it('正確彙整各日紀錄數與不重複訓練部位（依 BODY_PARTS 順序，自訂部位在後）', () => {
    const logs = [
      { id: 'l1', date: '2026-11-23', bodyParts: ['手臂', '胸', '前臂'] },
      { id: 'l2', date: '2026-11-23', bodyParts: ['胸', '背', '小腿', ''] },
      { id: 'l3', date: '2026-11-20', bodyParts: ['腿', '臀'] },
      { id: 'l4', date: '', bodyParts: ['胸'] },
      null,
    ];

    assert.deepEqual(logDateIndex(logs), {
      '2026-11-23': {
        count: 2,
        bodyParts: ['胸', '背', '手臂', '小腿', '前臂'],
      },
      '2026-11-20': {
        count: 1,
        bodyParts: ['腿', '臀'],
      },
    });
  });
});

describe('shiftMonth', () => {
  it('同年度加減月份正確計算', () => {
    assert.deepEqual(shiftMonth(2026, 11, 0), { year: 2026, month: 11 });
    assert.deepEqual(shiftMonth(2026, 5, 1), { year: 2026, month: 6 });
    assert.deepEqual(shiftMonth(2026, 5, -1), { year: 2026, month: 4 });
  });

  it('跨年進位與退位正確（含跨多年）', () => {
    assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
    assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
    assert.deepEqual(shiftMonth(2026, 11, 14), { year: 2028, month: 1 });
    assert.deepEqual(shiftMonth(2026, 2, -14), { year: 2024, month: 12 });
    assert.deepEqual(shiftMonth(2026, 1, -12), { year: 2025, month: 1 });
  });
});

describe('buildMonthGrid', () => {
  it('2026-11 週日開始、首格 11/01、包含整月 30 天（共 5 週）、正確標記今天與有紀錄日期的 count', () => {
    const logs = [
      { id: 'l1', date: '2026-11-23', bodyParts: ['手臂', '胸'] },
      { id: 'l2', date: '2026-11-23', bodyParts: ['胸', '肩'] },
      { id: 'l3', date: '2026-11-23', bodyParts: ['背'] },
      { id: 'l4', date: '2026-11-01', bodyParts: ['有氧'] },
      { id: 'l5', date: '2026-12-05', bodyParts: ['腿'] },
    ];

    const grid = buildMonthGrid(2026, 11, logs, '2026-11-23');

    assert.equal(grid.year, 2026);
    assert.equal(grid.month, 11);
    assert.equal(grid.label, '2026 年 11 月');

    // 2026-11-01 為週日、2026-11-30 為週一 → 週日起始涵蓋 11/01~12/05 共 5 週
    assert.equal(grid.weeks.length, 5);
    for (const week of grid.weeks) {
      assert.equal(week.length, 7);
    }

    // 首格為週日 2026-11-01（本月）
    const nov1 = grid.weeks[0][0];
    assert.equal(nov1.date, '2026-11-01');
    assert.equal(nov1.day, 1);
    assert.equal(nov1.inMonth, true);
    assert.equal(nov1.isToday, false);
    assert.equal(nov1.count, 1);
    assert.deepEqual(nov1.bodyParts, ['有氧']);

    // 第 1 週週六為 2026-11-07
    assert.equal(grid.weeks[0][6].date, '2026-11-07');

    // 末週週一為 2026-11-30（本月）、末格週六為 2026-12-05（非本月，有紀錄）
    assert.equal(grid.weeks[4][0].date, '2026-11-29');
    assert.equal(grid.weeks[4][1].date, '2026-11-30');
    assert.equal(grid.weeks[4][1].inMonth, true);
    const lastCell = grid.weeks[4][6];
    assert.equal(lastCell.date, '2026-12-05');
    assert.equal(lastCell.inMonth, false);
    assert.equal(lastCell.count, 1);
    assert.deepEqual(lastCell.bodyParts, ['腿']);

    // 驗證整個月 30 天皆被標記為 inMonth
    const allCells = grid.weeks.flat();
    const inMonthCells = allCells.filter((c) => c.inMonth);
    assert.equal(inMonthCells.length, 30);

    // 驗證「今天」僅標記在 2026-11-23 且有紀錄 count 與排序後部位正確
    const todayCells = allCells.filter((c) => c.isToday);
    assert.equal(todayCells.length, 1);
    assert.equal(todayCells[0].date, '2026-11-23');
    assert.equal(todayCells[0].day, 23);
    assert.equal(todayCells[0].count, 3);
    assert.deepEqual(todayCells[0].bodyParts, ['胸', '背', '肩', '手臂']);

    // 無紀錄日期 count 為 0、bodyParts 為空陣列
    const emptyCell = allCells.find((c) => c.date === '2026-11-10');
    assert.equal(emptyCell.count, 0);
    assert.deepEqual(emptyCell.bodyParts, []);
  });

  it('支援 5 週（2026-12）、4 週（2015-02）與 6 週（2026-08）月份格線（週日開始）', () => {
    // 2026-12-01 為週二、31 天 → 首格 11/29（週日）、末格 2027/01/02（週六），共 5 週
    const dec2026 = buildMonthGrid(2026, 12, [], '2026-12-15');
    assert.equal(dec2026.label, '2026 年 12 月');
    assert.equal(dec2026.weeks.length, 5);
    assert.equal(dec2026.weeks[0][0].date, '2026-11-29');
    assert.equal(dec2026.weeks[0][0].inMonth, false);
    assert.equal(dec2026.weeks[0][2].date, '2026-12-01');
    assert.equal(dec2026.weeks[4][6].date, '2027-01-02');
    assert.equal(dec2026.weeks[4][6].inMonth, false);

    // 2015-02-01 為週日、28 天 → 剛好 4 週
    const feb2015 = buildMonthGrid(2015, 2, [], '2026-11-23');
    assert.equal(feb2015.label, '2015 年 2 月');
    assert.equal(feb2015.weeks.length, 4);
    assert.equal(feb2015.weeks[0][0].date, '2015-02-01');
    assert.equal(feb2015.weeks[3][6].date, '2015-02-28');
    assert.ok(feb2015.weeks.flat().every((c) => c.inMonth && !c.isToday));

    // 2026-08-01 為週六、31 天 → 首格 07/26、末格 09/05，共 6 週
    const aug2026 = buildMonthGrid(2026, 8, [], '2026-11-23');
    assert.equal(aug2026.weeks.length, 6);
    assert.equal(aug2026.weeks[0][0].date, '2026-07-26');
    assert.equal(aug2026.weeks[0][6].date, '2026-08-01');
    assert.equal(aug2026.weeks[5][6].date, '2026-09-05');
  });

  it('每週第一格皆為週日', () => {
    const grid = buildMonthGrid(2026, 11, [], '2026-11-23');
    for (const week of grid.weeks) {
      const [y, m, d] = week[0].date.split('-').map(Number);
      assert.equal(new Date(y, m - 1, d).getDay(), 0);
    }
  });
});
