import assert from 'node:assert/strict';
import test from 'node:test';
import {assertReadOnly, withLimit} from './sql-guard';

test('accepts SELECT and WITH, strips trailing semicolon', () => {
  assert.equal(assertReadOnly('SELECT 1;'), 'SELECT 1');
  assert.equal(assertReadOnly('  with a as (select 1) select * from a'), 'with a as (select 1) select * from a');
});

test('rejects non-SELECT and multiple statements', () => {
  assert.throws(() => assertReadOnly('DROP TABLE trips'), /Only SELECT/);
  assert.throws(() => assertReadOnly('SELECT 1; SELECT 2'), /One statement/);
});

test('withLimit appends LIMIT only when absent', () => {
  assert.equal(withLimit('SELECT * FROM routes'), 'SELECT * FROM (SELECT * FROM routes) AS __q LIMIT 1000');
  assert.equal(withLimit('SELECT * FROM routes LIMIT 5'), 'SELECT * FROM routes LIMIT 5');
});
