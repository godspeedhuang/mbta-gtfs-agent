import {arrowTableToJson, type DuckDbSliceState} from '@sqlrooms/duckdb';
import type {StoreApi} from '@sqlrooms/room-shell';
import {tool} from 'ai';
import {assertReadOnly} from '@/lib/agent/sql-guard';
import {MapLayerParams, requiredMapColumns, TOOL_DESCRIPTIONS} from '@/lib/agent/tool-schemas';
import type {AppSliceState} from '@/lib/app-slice';

export type MapLayerToolOutput = {success: boolean; layerId?: string; rows?: number; details?: string; error?: string};

export function createMapLayerTool(store: StoreApi<DuckDbSliceState & AppSliceState>) {
  return tool({
    description: TOOL_DESCRIPTIONS.map_layer,
    inputSchema: MapLayerParams,
    execute: async ({sqlQuery, kind, title}): Promise<MapLayerToolOutput> => {
      try {
        const sql = assertReadOnly(sqlQuery);
        const connector = await store.getState().db.getConnector();
        const probe = await connector.query(`SELECT * FROM (${sql}) AS q LIMIT 1`);
        const cols = probe.schema.fields.map((f) => f.name.toLowerCase());
        const missing = requiredMapColumns(kind).filter((c) => !cols.includes(c));
        if (missing.length) {
          return {success: false, error: `Missing columns for kind=${kind}: ${missing.join(', ')}. Required: ${requiredMapColumns(kind).join(', ')}.`};
        }
        // Count with the exact SQL the map renders, so a shape_id that matches no shape fails here, not silently on the map.
        const [{n, distinct}] = arrowTableToJson(
          await connector.query(`SELECT count(*)::int AS n, count(DISTINCT value)::int AS distinct FROM (${layerSql(kind, sql)}) AS l`),
        ) as Array<{n: number; distinct: number}>;
        if (n === 0) {
          return {
            success: false,
            error:
              kind === 'routes'
                ? 'The SELECT returned no rows whose shape_id exists in shape_lines. Use real shape_id values from trips.shape_id (route_patterns.representative_trip_id → trips), not a constructed id.'
                : 'The SELECT returned no rows with non-null lat/lon.',
          };
        }
        const id = `${kind}-${Date.now()}`;
        // A constant value (e.g. every route = 1) has no scale to show: draw one colour, no legend.
        store.getState().app.addLayer({id, kind, title, sql, scaled: distinct > 1});
        return {success: true, layerId: id, rows: n, details: `Added ${kind} layer "${title}" (${n} rows) to the map.`};
      } catch (e) {
        return {success: false, error: e instanceof Error ? e.message : String(e)};
      }
    },
  });
}

/** SQL that turns a map_layer SELECT into rows with a WKB `geom` column. Shared by the tool and MapPanel. */
export function layerSql(kind: 'stops' | 'routes', sql: string) {
  return kind === 'stops'
    ? `SELECT q.*, ST_AsWKB(ST_Point(q.lon::double, q.lat::double)) AS geom FROM (${sql}) AS q WHERE q.lat IS NOT NULL AND q.lon IS NOT NULL`
    : `SELECT q.*, s.geom FROM (${sql}) AS q JOIN shape_lines s USING (shape_id)`;
}
