export const FEED = {
  agency: 'MBTA',
  version: 'Fall 2026, version D',
  start: '2026-09-04',
  end: '2026-12-12',
  source: 'https://cdn.mbta.com/MBTA_GTFS.zip',
  downloaded: '2026-09-12',
} as const;

/** Tables loaded into the browser. `shapes` is folded into `shape_lines` (one LineString per shape_id). */
export const GTFS_TABLES = [
  'agency',
  'routes',
  'trips',
  'stop_times',
  'stops',
  'calendar',
  'calendar_dates',
  'route_patterns',
  'directions',
  'feed_info',
  'shape_lines',
] as const;

export type GtfsTable = (typeof GTFS_TABLES)[number];

/** sqlrooms data-source config. DuckDB-WASM needs absolute URLs, so pass `window.location.origin`. */
export function gtfsDataSources(origin: string) {
  return GTFS_TABLES.map((tableName) => ({
    type: 'url' as const,
    tableName,
    url: `${origin}/gtfs/${tableName}.parquet`,
    loadOptions: {method: 'read_parquet' as const},
  }));
}
