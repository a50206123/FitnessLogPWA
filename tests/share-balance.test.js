// 分享圖分頁「頁面平衡」測試：避免最後一頁只剩一張卡
import test from 'node:test';
import assert from 'node:assert/strict';
import { planSharePages, summarizeDay, SHARE_METRICS } from '../web/logic.js';

/** 產生一筆單一 kg 欄位的紀錄 */
function mkLog(i, setCount) {
  return {
    id: 'l' + i, date: '2026-11-19', equipmentId: 'e' + i, equipmentName: '器材' + i,
    bodyParts: ['胸'], trackReps: true, fields: [{ key: 'w', name: '重量', unit: 'kg' }],
    sets: Array.from({ length: setCount }, () => ({ reps: 10, values: { w: 20 } })),
    note: i % 3 ? '' : '備註測試', createdAt: `2026-11-19T10:${String(10 + i).padStart(2, '0')}:00.000Z`,
  };
}

for (const n of [10, 12, 16, 20, 30]) {
  test(`${n} 筆紀錄分頁後各頁平衡、順序不變、不超界`, () => {
    const logs = Array.from({ length: n }, (_, i) => mkLog(i, 3 + (i % 3)));
    const plan = planSharePages(summarizeDay(logs));
    const pages = plan.pages;
    if (pages.length < 2) return;
    const order = pages.flatMap((p) => p.cards.map((c) => c.logIndex));
    assert.deepEqual(order, Array.from({ length: n }, (_, i) => i));
    const counts = pages.map((p) => p.cards.length);
    // 最後一頁至少 2 張，且各頁張數差距不大
    assert.ok(counts[counts.length - 1] >= 2, `最後一頁張數 ${counts}`);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 3, `張數 ${counts}`);
    for (const p of pages) {
      assert.ok(p.scale >= 1 && p.scale <= 1.45);
      for (const c of p.cards) {
        assert.equal(c.x, SHARE_METRICS.pad);
        assert.equal(c.w, SHARE_METRICS.width - 2 * SHARE_METRICS.pad);
        assert.ok(c.y + c.h <= p.bodyTop + p.bodyH + 1e-6);
        assert.equal(c.hiddenSets, 0);
      }
      assert.equal(p.total, pages.length);
    }
  });
}
