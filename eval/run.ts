import {DuckDBInstance} from '@duckdb/node-api';
import {readFileSync} from 'node:fs';
import {GTFS_TABLES} from '../src/lib/gtfs/feed';

type Question = {id: string; prompt: string; tools: string[]; referenceSql?: string; expect: Array<string | number>};
const questions = JSON.parse(readFileSync(new URL('./questions.json', import.meta.url), 'utf8')) as Question[];

export async function openGtfs() {
  const db = await (await DuckDBInstance.create(':memory:')).connect();
  for (const t of GTFS_TABLES) await db.run(`CREATE VIEW ${t} AS SELECT * FROM read_parquet('public/gtfs/${t}.parquet')`);
  return db;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const containsAll = (text: string, expect: Array<string | number>) =>
  expect.filter((e) => !new RegExp('(?<![A-Za-z0-9.])' + escapeRegExp(String(e)) + '(?![A-Za-z0-9]|\\.\\d)', 'i').test(text));

const db = await openGtfs();
let failed = 0;
console.log('== data check (reference SQL) ==');
for (const q of questions) {
  if (!q.referenceSql) continue;
  const rows = (await db.runAndReadAll(q.referenceSql)).getRowObjectsJson();
  const missing = containsAll(JSON.stringify(rows), q.expect);
  console.log(`${missing.length ? 'FAIL' : 'ok  '} ${q.id} rows=${rows.length}${missing.length ? ' missing=' + missing.join(',') : ''}`);
  if (process.argv.includes('--show')) console.table(rows);
  if (missing.length) failed++;
}
if (process.argv.includes('--data-only')) process.exit(failed ? 1 : 0);
// agent mode: Task 10
process.exit(failed ? 1 : 0);
