import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bostonToday, buildInstructions} from './instructions';

test('today is the Boston calendar date, not UTC', () => {
  // 03:30 UTC on Sep 13 is still the evening of Sep 12 in Boston (EDT, UTC-4).
  assert.deepEqual(bostonToday(new Date('2026-09-13T03:30:00Z')), {ymd: '20260912', weekday: 'Saturday'});
  assert.deepEqual(bostonToday(new Date('2026-09-13T04:30:00Z')), {ymd: '20260913', weekday: 'Sunday'});
  assert.match(buildInstructions(new Date('2026-09-13T03:30:00Z')), /Today is 20260912 \(Saturday\) in Boston/);
});
