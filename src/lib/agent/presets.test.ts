import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MODEL_PRESETS, presetAt} from './presets';

test('presets fill defaults for omitted fields', () => {
  for (const p of MODEL_PRESETS) {
    assert.ok(p.model && p.label && p.effort && p.api);
  }
});

test('presetAt accepts only listed indexes', () => {
  assert.equal(presetAt('0'), MODEL_PRESETS[0]);
  for (const bad of [null, undefined, '', 'server', '-1', '1.5', ' 0', String(MODEL_PRESETS.length)]) {
    assert.equal(presetAt(bad), undefined, String(bad));
  }
});
