import {arrowTableToJson, type DuckDbSliceState} from '@sqlrooms/duckdb';
import type {StoreApi} from '@sqlrooms/room-shell';
import {tool} from 'ai';
import {assertReadOnly} from '@/lib/agent/sql-guard';
import {MapLayerParams, requiredMapColumns, TOOL_DESCRIPTIONS, ZoomToLayerParams} from '@/lib/agent/tool-schemas';
import type {AppSliceState} from '@/lib/app-slice';

export type MapLayerToolOutput = {success: boolean; layerId?: string; rows?: number; details?: string; error?: string};

// The model sometimes emits map_layer and zoom_to_layer in one step; the AI SDK runs them concurrently,
// so zoom_to_layer waits for any in-flight map_layer before picking its layer.
let pendingMapLayer: Promise<unknown> = Promise.resolve();

export function createMapLayerTool(store: StoreApi<DuckDbSliceState & AppSliceState>) {
  return tool({
    description: TOOL_DESCRIPTIONS.map_layer,
    inputSchema: MapLayerParams,
    execute: ({sqlQuery, kind, title}): Promise<MapLayerToolOutput> => {
      const run = addMapLayer(store, sqlQuery, kind, title);
      pendingMapLayer = run;
      return run;
    },
  });
}

async function addMapLayer(
  store: StoreApi<DuckDbSliceState & AppSliceState>,
  sqlQuery: string,
  kind: 'stops' | 'routes',
  title: string,
): Promise<MapLayerToolOutput> {
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
    const [{n, distinct, colored, colors_unique}] = arrowTableToJson(
      await connector.query(`SELECT count(*)::int AS n, count(DISTINCT value)::int AS distinct, ${kind === 'routes' ? 'count(color_r)' : '0'}::int AS colored, ${kind === 'routes' ? 'count(DISTINCT label) = count(DISTINCT (color_r, color_g, color_b))' : 'false'} AS colors_unique FROM (${layerSql(kind, sql)}) AS l`),
    ) as Array<{n: number; distinct: number; colored: number; colors_unique: boolean}>;
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
    // Numeric value → sequential scale. Otherwise routes use their GTFS colours when every row has one and
    // each label has its own colour; same route or shared colours (e.g. two yellow buses) → one colour per label.
    const colorBy = distinct > 1 ? 'value' : kind === 'routes' && colored === n && colors_unique ? 'gtfs' : 'label';
    store.getState().app.addLayer({id, kind, title, sql, colorBy});
    return {success: true, layerId: id, rows: n, details: `Added ${kind} layer "${title}" (${n} rows) to the map.`};
  } catch (e) {
    return {success: false, error: e instanceof Error ? e.message : String(e)};
  }
}

export type ZoomToLayerToolOutput = {success: boolean; layerId?: string; bbox?: [number, number, number, number]; error?: string};

export function createZoomToLayerTool(store: StoreApi<DuckDbSliceState & AppSliceState>) {
  return tool({
    description: TOOL_DESCRIPTIONS.zoom_to_layer,
    inputSchema: ZoomToLayerParams,
    execute: async ({layerId}): Promise<ZoomToLayerToolOutput> => {
      await pendingMapLayer;
      const {layers, setViewBbox} = store.getState().app;
      const layer = layerId ? layers.find((l) => l.id === layerId) : layers.at(-1);
      if (!layer) {
        return {success: false, error: layerId ? `No layer ${layerId}. Existing: ${layers.map((l) => l.id).join(', ') || 'none'}.` : 'No layers on the map yet.'};
      }
      try {
        const connector = await store.getState().db.getConnector();
        const [b] = arrowTableToJson(
          await connector.query(
            `SELECT min(ST_XMin(g)) AS x0, min(ST_YMin(g)) AS y0, max(ST_XMax(g)) AS x1, max(ST_YMax(g)) AS y1
             FROM (SELECT ST_GeomFromWKB(geom) AS g FROM (${layerSql(layer.kind, layer.sql)}) AS l)`,
          ),
        ) as Array<{x0: number; y0: number; x1: number; y1: number}>;
        if (b?.x0 == null) return {success: false, layerId: layer.id, error: 'Layer has no geometry to zoom to.'};
        const bbox: [number, number, number, number] = [b.x0, b.y0, b.x1, b.y1];
        // Defer out of the tool-result tick: writing the store while sqlrooms syncs chat messages
        // cascades into React's "Maximum update depth exceeded".
        setTimeout(() => setViewBbox(bbox), 0);
        return {success: true, layerId: layer.id, bbox};
      } catch (e) {
        return {success: false, layerId: layer.id, error: e instanceof Error ? e.message : String(e)};
      }
    },
  });
}

/** SQL that turns a map_layer SELECT into rows with a WKB `geom` column. Shared by the tool and MapPanel. */
export function layerSql(kind: 'stops' | 'routes', sql: string) {
  return kind === 'stops'
    ? `SELECT q.*, ST_AsWKB(ST_Point(q.lon::double, q.lat::double)) AS geom FROM (${sql}) AS q WHERE q.lat IS NOT NULL AND q.lon IS NOT NULL`
    : // GTFS routes.route_color (hex) as RGB columns; NULL when the route has none. A few shapes span
      // several routes — any one of their colours is fine.
      `SELECT q.*, s.geom,
         ('0x' || substr(rc.c, 1, 2))::INTEGER AS color_r,
         ('0x' || substr(rc.c, 3, 2))::INTEGER AS color_g,
         ('0x' || substr(rc.c, 5, 2))::INTEGER AS color_b
       FROM (${sql}) AS q
       JOIN shape_lines s USING (shape_id)
       LEFT JOIN (
         SELECT t.shape_id, any_value(r.route_color) AS c
         FROM trips t JOIN routes r USING (route_id)
         WHERE regexp_full_match(r.route_color, '[0-9A-Fa-f]{6}')
         GROUP BY t.shape_id
       ) rc USING (shape_id)`;
}
