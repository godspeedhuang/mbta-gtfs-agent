import {tool, type ToolSet} from 'ai';
import {ChartParams, MapLayerParams, QueryParams, TOOL_DESCRIPTIONS} from './tool-schemas';

/** Tool declarations without `execute`: the browser runs them and posts results back. */
export function serverTools(): ToolSet {
  return {
    query: tool({description: TOOL_DESCRIPTIONS.query, inputSchema: QueryParams}),
    chart: tool({description: TOOL_DESCRIPTIONS.chart, inputSchema: ChartParams}),
    map_layer: tool({description: TOOL_DESCRIPTIONS.map_layer, inputSchema: MapLayerParams}),
  };
}
