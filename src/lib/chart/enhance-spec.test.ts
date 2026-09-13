import assert from 'node:assert/strict';
import test from 'node:test';
import {enhanceSpec, routeColorMap} from './enhance-spec';

const line = {mark: 'line', encoding: {x: {field: 'hour'}, color: {field: 'route', type: 'nominal'}}};

test('adds legend highlight and keeps the rest of the spec', () => {
  const out = enhanceSpec(line) as typeof line & {params: unknown; encoding: {opacity: unknown}};
  assert.equal(out.mark, 'line');
  assert.deepEqual(out.encoding.x, {field: 'hour'});
  assert.ok(Array.isArray(out.params));
  assert.ok(out.encoding.opacity);
  assert.equal('opacity' in line.encoding, false, 'input not mutated');
});

test('leaves specs with params, opacity, layers or no colour field alone', () => {
  for (const s of <Array<Record<string, unknown>>>[
    {...line, params: []},
    {...line, encoding: {...line.encoding, opacity: {value: 1}}},
    {layer: [line]},
    {mark: 'line', encoding: {color: {value: 'red'}}},
  ]) {
    assert.equal(JSON.stringify(enhanceSpec(s).params), JSON.stringify(s.params));
  }
  const layered = {layer: [line]};
  assert.equal(enhanceSpec(layered), layered, 'composite spec returned untouched');
});

test('route colours only when every value has a distinct colour', () => {
  assert.equal(routeColorMap([{v: '1', c: 'FFC72C'}, {v: '66', c: 'FFC72C'}]), undefined);
  assert.equal(routeColorMap([{v: 'Red', c: 'DA291C'}, {v: 'x', c: null}]), undefined);
  const m = routeColorMap([{v: 'Red', c: 'DA291C'}, {v: 'Orange', c: 'ED8B00'}])!;
  const out = enhanceSpec(line, m) as {encoding: {color: {scale: unknown}}};
  assert.deepEqual(out.encoding.color.scale, {domain: ['Red', 'Orange'], range: ['#DA291C', '#ED8B00']});
  const kept = enhanceSpec({...line, encoding: {...line.encoding, color: {field: 'route', scale: {scheme: 'x'}}}}, m) as {encoding: {color: {scale: unknown}}};
  assert.deepEqual(kept.encoding.color.scale, {scheme: 'x'});
});
