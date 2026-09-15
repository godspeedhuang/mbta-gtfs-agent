import type {DuckDbConnector} from '@sqlrooms/duckdb';
import {arrowTableToJson} from '@sqlrooms/duckdb';
import {FEED, GTFS_TABLES, type GtfsTable} from './feed';

/** A GTFS feed loaded in DuckDB. `main` is the bundled feed; uploads get their own schema. */
export type LoadedFeed = {schema: string; version: string; start: string; end: string};

export const MAIN_FEED: LoadedFeed = {schema: 'main', version: FEED.version, start: FEED.start, end: FEED.end};

/** "Summer 2026, 2026-08-19T21:11:39+00:00, version D" → "summer_2026". Text before the first comma, as a SQL identifier. */
export function feedSchemaName(feedVersion: string): string {
  const name = feedVersion.split(',')[0]!.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(name) ? name : `feed_${name}`;
}

/** YYYYMMDD → YYYY-MM-DD */
const iso = (ymd: string) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;

/** Which of the 11 required parquet files are absent from a selection. */
export function missingTables(fileNames: string[]): GtfsTable[] {
  const names = new Set(fileNames);
  return GTFS_TABLES.filter((t) => !names.has(`${t}.parquet`));
}

/**
 * Load one feed's parquet files into their own schema, named after feed_info.feed_version.
 * Re-uploading the same season replaces its tables.
 */
export async function loadFeedFiles(connector: DuckDbConnector, files: File[]): Promise<LoadedFeed> {
  const missing = missingTables(files.map((f) => f.name));
  if (missing.length) throw new Error(`Missing ${missing.map((t) => `${t}.parquet`).join(', ')}. Pick all ${GTFS_TABLES.length} files.`);
  const byTable = new Map(files.map((f) => [f.name.replace(/\.parquet$/, ''), f]));

  // feed_info first: it names the schema for everything else.
  // Not TEMP: the connector's temp tables are not visible from its query connection.
  await connector.loadFile(byTable.get('feed_info')!, 'uploaded_feed_info', {method: 'read_parquet', replace: true});
  const [info] = arrowTableToJson(await connector.query('SELECT feed_version, feed_start_date, feed_end_date FROM uploaded_feed_info')) as Array<
    Record<string, string>
  >;
  await connector.query('DROP TABLE uploaded_feed_info');
  if (!info?.feed_version) throw new Error('feed_info.parquet has no feed_version.');
  const schema = feedSchemaName(info.feed_version);

  for (const t of GTFS_TABLES) {
    await connector.loadFile(byTable.get(t)!, t, {method: 'read_parquet', schema, replace: true});
  }
  // The window is the calendar's, not feed_info's: MBTA republishes often, so feed_info covers days while calendar covers the season.
  const [win] = arrowTableToJson(await connector.query(`SELECT min(start_date) s, max(end_date) e FROM ${schema}.calendar`)) as Array<Record<string, string>>;
  return {schema, version: info.feed_version.replace(/, \d{4}-\d{2}-\d{2}T[^,]*/, ''), start: iso(win!.s), end: iso(win!.e)};
}
