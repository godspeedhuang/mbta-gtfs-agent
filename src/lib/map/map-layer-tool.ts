import {arrowTableToJson, type DuckDbSliceState} from '@sqlrooms/duckdb';
import type {StoreApi} from '@sqlrooms/room-shell';
import {tool} from 'ai';
import {assertReadOnly} from '@/lib/agent/sql-guard';
import {MapLayerParams, requiredMapColumns, TOOL_DESCRIPTIONS, ZoomToLayerParams} from '@/lib/agent/tool-schemas';
import type {AppSliceState, LegendItem} from '@/lib/app-slice';

export type MapLayerToolOutput = {success: boolean; layerId?: string; rows?: number; details?: string; error?: string};

// The model sometimes emits map_layer and zoom_to_layer in one step; the AI SDK runs them concurrently,
// so zoom_to_layer waits for any in-flight map_layer before picking its layer.
let pendingMapLayer: Promise<unknown> = Promise.resolve();

export function createMapLayerTool(store: StoreApi<DuckDbSliceState & AppSliceState>) {
  return tool({
    description: TOOL_DESCRIPTIONS.map_layer,
    inputSchema: MapLayerParams,
    execute: ({sqlQuery, kind, title, replace = true}): Promise<MapLayerToolOutput> => {
      const run = addMapLayer(store, sqlQuery, kind, title, replace);
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
  replace: boolean,
): Promise<MapLayerToolOutput> {
  try {
    const agentSql = assertReadOnly(sqlQuery);
    const connector = await store.getState().db.getConnector();
    const probe = await connector.query(`SELECT * FROM (${agentSql}) AS q LIMIT 1`);
    const cols = probe.schema.fields.map((f) => f.name.toLowerCase());
    const missing = requiredMapColumns(kind).filter((c) => !cols.includes(c));
    if (missing.length) {
      return {success: false, error: `Missing columns for kind=${kind}: ${missing.join(', ')}. Required: ${requiredMapColumns(kind).join(', ')}.`};
    }
    // route_id and direction_id are optional; add them as NULL so the layer SQL can always refer to them.
    const optional = ['route_id', 'direction_id'].filter((c) => !cols.includes(c)).map((c) => `, NULL::VARCHAR AS ${c}`);
    const sql = `SELECT *${optional.join('')} FROM (${agentSql}) AS q0`;
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
    // A varying value is a metric → sequential scale. Otherwise colour means route and shade means direction, never one colour per row.
    if (distinct > 1) {
      store.getState().app.addLayer({id, kind, title, sql, colorBy: 'value'}, replace);
    } else {
      const groups = arrowTableToJson(
        await connector.query(
          `SELECT map_route AS route, map_dir AS dir, map_dir_to AS dir_to,
             any_value(color_r)::int AS cr, any_value(color_g)::int AS cg, any_value(color_b)::int AS cb
           FROM (${layerSql(kind, sql)}) GROUP BY 1, 2, 3 ORDER BY 1, any_value(direction_id::VARCHAR)`,
        ),
      ) as LegendGroup[];
      store.getState().app.addLayer({id, kind, title, sql, colorBy: 'route', legend: compactLegend(groups, kind === 'stops' ? 'Stops' : 'Routes')}, replace);
    }
    return {success: true, layerId: id, rows: n, details: `Added ${kind} layer "${title}" (${n} rows) to the map.`};
  } catch (e) {
    return {success: false, error: e instanceof Error ? e.message : String(e)};
  }
}

type LegendGroup = {route: string | null; dir: string | null; dir_to: string | null; cr: number; cg: number; cb: number};

/** "Outbound to Harvard Square" — the words behind a direction's shade, for the legend and the tooltip. */
export const directionText = (dir: string | null | undefined, to: string | null | undefined) => (dir ? (to ? `${dir} to ${to}` : dir) : undefined);

/** One legend row per route and direction; past 8 rows (e.g. twenty yellow buses), one row per colour instead. */
export function compactLegend(groups: LegendGroup[], fallback: string): LegendItem[] {
  const rows = groups.map((g) => ({label: g.route ?? fallback, sub: directionText(g.dir, g.dir_to), color: [g.cr, g.cg, g.cb] as LegendItem['color']}));
  if (rows.length <= 8) return rows;
  const byColor = new Map<string, LegendItem[]>();
  for (const r of rows) byColor.set(String(r.color), [...(byColor.get(String(r.color)) ?? []), r]);
  return [...byColor.values()].map((rs) => (rs.length === 1 ? rs[0]! : {label: `${new Set(rs.map((r) => r.label)).size} routes`, color: rs[0]!.color}));
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

/**
 * SQL that turns a map_layer SELECT (with route_id and direction_id columns, possibly NULL) into rows with a WKB `geom`,
 * the resolved `route_key`, `map_route` / `map_dir` / `map_dir_to` names for the legend and tooltip, and colour columns:
 * the route's GTFS colour, lightened halfway to white for direction 1, grey when the route is unknown. Shared by the tool and MapPanel.
 */
export function layerSql(kind: 'stops' | 'routes', sql: string) {
  const base = (i: number, c: string) =>
    `CASE WHEN regexp_full_match(r.route_color, '[0-9A-Fa-f]{6}') THEN ('0x' || substr(r.route_color, ${i}, 2))::INTEGER ELSE 170 END AS base_${c}`;
  const shade = (c: string) => `CASE WHEN direction_id::VARCHAR = '1' THEN base_${c} + (255 - base_${c}) // 2 ELSE base_${c} END AS color_${c}`;
  // A shape without a route_id takes its route from trips; a few shapes span several routes — any one is fine.
  const [geom, from, routeKey, where] =
    kind === 'stops'
      ? ['ST_AsWKB(ST_Point(q.lon::double, q.lat::double))', `(${sql}) AS q`, 'q.route_id::VARCHAR', 'WHERE q.lat IS NOT NULL AND q.lon IS NOT NULL']
      : [
          's.geom',
          `(${sql}) AS q JOIN shape_lines s USING (shape_id) LEFT JOIN (SELECT shape_id, any_value(route_id) AS route_id FROM trips GROUP BY shape_id) sr USING (shape_id)`,
          'coalesce(q.route_id::VARCHAR, sr.route_id)',
          '',
        ];
  return `SELECT *, ${shade('r')}, ${shade('g')}, ${shade('b')} FROM (
    SELECT q.*, ${geom} AS geom, ${routeKey} AS route_key, ${base(1, 'r')}, ${base(3, 'g')}, ${base(5, 'b')},
      CASE WHEN r.route_short_name IS NOT NULL THEN 'Route ' || r.route_short_name ELSE r.route_long_name END AS map_route,
      d.direction AS map_dir, d.direction_destination AS map_dir_to
    FROM ${from}
    LEFT JOIN routes r ON r.route_id = ${routeKey}
    LEFT JOIN directions d ON d.route_id = ${routeKey} AND d.direction_id = q.direction_id::VARCHAR
    ${where}
  )`;
}
