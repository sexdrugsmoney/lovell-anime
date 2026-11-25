import {test} from 'node:test';
import assert from 'node:assert/strict';
import {titleHit} from '../lib/titles.js';
import {groupAiring, weekBounds, istanbulParts} from '../lib/week.js';

test('aynı seri başlığı eşleşir, alakasız başlık eşleşmez', () => {
  assert.equal(titleHit('Solo Leveling', 'Solo Leveling'), true);
  assert.equal(titleHit('Ore dake Level Up na Ken', 'Ore dake Level Up na Ken Season 2'), true);
  assert.equal(titleHit('俺だけレベルアップな件', '俺だけレベルアップな件'), true);
  assert.equal(titleHit('Solo Leveling', 'One Piece'), false);
  assert.equal(titleHit('Naruto', 'Boruto'), false);
});

test('haftalık yayınlar güne göre dizilir', () => {
  const now = Date.parse('2026-10-26T12:00:00+03:00');
  const bounds = weekBounds(now);
  assert.equal(istanbulParts(bounds.start).date, '2026-10-26');
  assert.equal(bounds.end - bounds.start, 7 * 86400000);
  const days = groupAiring([
    {at: Date.parse('2026-10-27T22:00:00+03:00'), date: '2026-10-27', time: '22:00', title: 'Yarın'},
    {at: Date.parse('2026-10-26T09:00:00+03:00'), date: '2026-10-26', time: '09:00', title: 'Geçti'},
    {at: Date.parse('2026-10-26T21:00:00+03:00'), date: '2026-10-26', time: '21:00', title: 'Akşam'},
  ], now);
  assert.equal(days.length, 2);
  assert.equal(days[0].date, '2026-10-26');
  assert.equal(days[0].items[0].title, 'Geçti');
  assert.equal(days[0].items[0].past, true);
  assert.equal(days[0].items[1].past, false);
  assert.equal(days[1].items[0].title, 'Yarın');
});
