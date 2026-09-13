type Spec = Record<string, unknown> & {
  params?: unknown;
  encoding?: Record<string, Record<string, unknown> | undefined>;
};

const COMPOSITE = ['layer', 'concat', 'hconcat', 'vconcat', 'facet', 'repeat'];

/** The field a single-view spec colours by, or undefined when there's nothing safe to enhance. */
export function colorField(spec: Spec): string | undefined {
  if (COMPOSITE.some((k) => k in spec)) return undefined;
  const field = spec.encoding?.color?.field;
  return typeof field === 'string' ? field : undefined;
}

/**
 * Adds to a model-written Vega-Lite spec without overwriting it:
 * - click-to-highlight bound to the colour legend (skipped if the spec has params or an opacity encoding)
 * - GTFS route colours as the colour scale, when `routeColors` covers every value (skipped if a scale exists)
 */
export function enhanceSpec(spec: Spec, routeColors?: Map<string, string>): Spec {
  const field = colorField(spec);
  if (!field || !spec.encoding) return spec;
  const color = spec.encoding.color!;
  const out: Spec = {...spec, encoding: {...spec.encoding, color: {...color}}};
  if (spec.params === undefined && spec.encoding.opacity === undefined) {
    out.params = [{name: 'legend_pick', select: {type: 'point', fields: [field]}, bind: 'legend'}];
    out.encoding!.opacity = {condition: {param: 'legend_pick', value: 1}, value: 0.15};
  }
  if (routeColors?.size && color.scale === undefined) {
    out.encoding!.color!.scale = {domain: [...routeColors.keys()], range: [...routeColors.values()]};
  }
  return out;
}

/**
 * Route colours for the distinct values of a chart's colour field, or undefined unless every value is a
 * route with a GTFS colour and the colours are all different (same route / shared colour → default palette).
 */
export function routeColorMap(rows: Array<{v: string; c: string | null}>): Map<string, string> | undefined {
  if (!rows.length || rows.some((r) => !r.c)) return undefined;
  if (new Set(rows.map((r) => r.c)).size !== rows.length) return undefined;
  return new Map(rows.map((r) => [r.v, `#${r.c}`]));
}

/** SQL returning each distinct colour-field value with its GTFS route colour (NULL if not a coloured route). */
export function routeColorSql(sql: string, field: string) {
  const col = `"${field.replaceAll('"', '""')}"`;
  return `WITH v AS (SELECT DISTINCT CAST(${col} AS VARCHAR) AS v FROM (${sql}) AS q LIMIT 21)
    SELECT v.v, any_value(r.route_color) FILTER (WHERE regexp_full_match(r.route_color, '[0-9A-Fa-f]{6}')) AS c
    FROM v LEFT JOIN routes r ON v.v IN (r.route_id, r.route_short_name, r.route_long_name)
    GROUP BY v.v ORDER BY v.v`;
}
