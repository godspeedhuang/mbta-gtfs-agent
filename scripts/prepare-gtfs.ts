import {DuckDBInstance} from '@duckdb/node-api';
import {mkdirSync} from 'node:fs';
import {FEED} from '../src/lib/gtfs/feed';

// Usage: pnpm prepare-gtfs [src-dir] [out-dir]; defaults build the bundled feed.
const [SRC = 'data/gtfs', OUT = 'public/gtfs'] = process.argv.slice(2);
// Raw GTFS files exported 1:1. `shapes` is read but only exported as `shape_lines`.
const RAW = ['agency', 'routes', 'trips', 'stop_times', 'stops', 'calendar', 'calendar_dates', 'route_patterns', 'directions', 'feed_info'];

const instance = await DuckDBInstance.create(':memory:');
const db = await instance.connect();
await db.run('INSTALL spatial; LOAD spatial;');
mkdirSync(OUT, {recursive: true});

for (const t of [...RAW, 'shapes']) {
  // all_varchar: GTFS times exceed 24:00 and ids are strings. quote: trips.txt has quoted commas.
  await db.run(`CREATE TABLE ${t} AS SELECT * FROM read_csv('${SRC}/${t}.txt', all_varchar=true, quote='"')`);
}
for (const t of RAW) {
  await db.run(`COPY ${t} TO '${OUT}/${t}.parquet' (FORMAT parquet, COMPRESSION zstd)`);
}
await db.run(`
  CREATE TABLE shape_lines AS
  SELECT shape_id,
         ST_AsWKB(ST_MakeLine(list(ST_Point(shape_pt_lon::double, shape_pt_lat::double) ORDER BY shape_pt_sequence::int))) AS geom
  FROM shapes GROUP BY shape_id`);
await db.run(`COPY shape_lines TO '${OUT}/shape_lines.parquet' (FORMAT parquet, COMPRESSION zstd)`);

// Self-check: fail loudly if the feed is not what the app assumes.
const check = await db.runAndReadAll(`
  SELECT (SELECT count(*) FROM stop_times) AS stop_times,
         (SELECT count(*) FROM shape_lines) AS shape_lines,
         (SELECT count(DISTINCT ST_GeometryType(ST_GeomFromWKB(geom))) FROM shape_lines) AS geom_types,
         (SELECT feed_version FROM feed_info) AS feed_version,
         (SELECT feed_start_date FROM feed_info) AS feed_start_date,
         (SELECT feed_end_date FROM feed_info) AS feed_end_date`);
const [row] = check.getRowObjectsJson() as Array<Record<string, unknown>>;
console.log(row);
if (Number(row.stop_times) < 1_000_000) throw new Error(`stop_times too small: ${row.stop_times}`);
if (Number(row.geom_types) !== 1) throw new Error('shape_lines must be LINESTRING only');
// Only the bundled feed must match the pinned FEED; other seasons are prepared for upload.
const [expectedStart, expectedEnd] = [FEED.start, FEED.end].map((d) => d.replaceAll('-', ''));
if (OUT === 'public/gtfs' && (row.feed_start_date !== expectedStart || row.feed_end_date !== expectedEnd)) {
  throw new Error(`feed dates ${row.feed_start_date}-${row.feed_end_date} do not match pinned FEED ${expectedStart}-${expectedEnd}`);
}
