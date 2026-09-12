import {z} from 'zod';

// ponytail: these mirror @sqlrooms/ai `QueryToolParameters` and @sqlrooms/vega
// `VegaChartToolParameters` so the server route and eval runner never import
// React-heavy packages. Keep field names identical — the browser executes these.

export const QueryParams = z.object({
  type: z.literal('query'),
  sqlQuery: z.string().describe('One DuckDB SELECT statement.'),
  reasoning: z.string().describe('One sentence: what this query computes and why.'),
});

export const ChartParams = z.object({
  sqlQuery: z.string().describe('SELECT producing the chart data. Omit data from the spec.'),
  vegaLiteSpec: z.string().describe('Vega-Lite spec as a JSON string, no "data" property.'),
  reasoning: z.string(),
});

export const MapLayerParams = z.object({
  sqlQuery: z.string().describe('SELECT with the columns required by `kind` (see description).'),
  kind: z.enum(['stops', 'routes']),
  title: z.string().describe('Legend title, e.g. "AM peak median headway (min)".'),
  reasoning: z.string(),
});

export function requiredMapColumns(kind: 'stops' | 'routes'): string[] {
  return kind === 'stops' ? ['lat', 'lon', 'label', 'value'] : ['shape_id', 'label', 'value'];
}

export const TOOL_DESCRIPTIONS = {
  query: `Run one DuckDB SELECT against the GTFS tables and show the result table to the user with the SQL attached.
Set "type" to "query". Only one statement per call. The first 100 rows are returned to you; the user sees up to 1000.
If a query fails, fix it rather than re-running the same text. Never modify data.`,
  chart: `Draw a Vega-Lite chart from a SELECT. Use for results with a time or ordinal axis (hour of day, period, date).
Omit "data" from the spec and put the SELECT in sqlQuery; set "width": "container"; give axes clear titles.`,
  map_layer: `Add a layer to the map from a SELECT. Use when the answer has a spatial dimension (which routes, which stops).
kind="stops": the SELECT must return lat, lon, label, value.
kind="routes": the SELECT must return shape_id, label, value (get shape_id via route_patterns.representative_trip_id → trips.shape_id, typicality 1 only).
"value" is numeric and drives the colour scale (higher = worse, e.g. headway in minutes). Missing columns return an error — fix the SELECT and call again.`,
} as const;
