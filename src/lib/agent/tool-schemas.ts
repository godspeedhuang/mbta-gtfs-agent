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

export const ZoomToLayerParams = z.object({
  layerId: z.string().optional().describe('layerId returned by map_layer; omit for the most recently added layer.'),
  reasoning: z.string(),
});

export const AskUserParams = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().describe('One specific question ending in "?".'),
        header: z.string().describe('Short label, max 12 characters, e.g. "Day", "Place", "Threshold".'),
        options: z
          .array(
            z.object({
              label: z.string().describe('1-5 words.'),
              description: z.string().describe('What choosing this means for the analysis.'),
            }),
          )
          .min(1)
          .max(4)
          .describe(
            'Multiple choice: 2-4 real, mutually exclusive interpretations, recommended one first with " (Recommended)" at the end of its label. Yes/no confirmation: exactly one option, "Yes, <interpretation>" (the UI shows "No, something else" next to it). Never add an "Other" / "No" / "something else" option yourself: the UI always adds one.',
          ),
        multiSelect: z.boolean().describe('True only when several options can apply at once, e.g. weekday and Saturday.'),
      }),
    )
    .min(1)
    .max(3),
  reasoning: z.string().describe('One sentence: which ambiguity would change the answer.'),
});

export type AskUserAnswer = {question: string; selected: string[]; other?: string};
export type AskUserOutput = {answers: AskUserAnswer[]; note?: string};

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
"value" is numeric and drives the colour scale (higher = worse, e.g. headway in minutes); use 1 when there is no metric.
Optional route_id and direction_id: without a varying value, rows take their route's GTFS colour, direction 1 a lighter shade. Missing columns return an error — fix the SELECT and call again.`,
  ask_user: `Ask the user multiple-choice clarifying questions before computing, when a missing detail would change
the answer and no default definition covers it: the time (which day type or date, which hours), the place (which
area, stops or corridor), or the metric (a threshold for "frequent", "busy" and the like). 1-3 questions, each multiple choice (2-4 options)
or a yes/no confirmation (1 option); the user can always type their own answer. The run pauses until the user answers; the answers come back as this
tool's output. Do not ask about anything the definitions already default, and never ask the same thing twice.`,
  zoom_to_layer: `Move the map camera to fit a layer drawn by map_layer. Call it right after map_layer succeeds
so the user sees the result; pass the returned layerId (or omit it for the latest layer).`,
} as const;

/** Agent step cap, shared by the browser agent and the eval runner. */
export const MAX_STEPS = 20;
