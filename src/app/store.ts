import {createAiSlice, createDefaultAiTools, type AiSliceState} from '@sqlrooms/ai';
import {createAiSettingsSlice, type AiSettingsSliceState} from '@sqlrooms/ai-settings';
import {createWasmDuckDbConnector} from '@sqlrooms/duckdb';
import {createRoomShellSlice, createRoomStore, type LayoutConfig, type RoomShellSliceState} from '@sqlrooms/room-shell';
import {createSqlEditorSlice, type SqlEditorSliceState} from '@sqlrooms/sql-editor';
import {createSqlValidator, createVegaChartTool, VegaChartToolResult} from '@sqlrooms/vega';
import {arrowTableToJson} from '@sqlrooms/duckdb';
import {MapIcon, MessageSquareIcon} from 'lucide-react';
import {ChatPanel} from '@/components/ChatPanel';
import {MapLayerToolResult} from '@/components/MapLayerToolResult';
import {MapPanel} from '@/components/MapPanel';
import {QueryResultWithEditor} from '@/components/QueryResultWithEditor';
import {createAppSlice, type AppSliceState} from '@/lib/app-slice';
import {buildInstructions} from '@/lib/agent/instructions';
import {colorField, enhanceSpec, routeColorMap, routeColorSql} from '@/lib/chart/enhance-spec';
import {createProxyModel} from '@/lib/agent/proxy-model';
import {withLimit} from '@/lib/agent/sql-guard';
import {TOOL_DESCRIPTIONS} from '@/lib/agent/tool-schemas';
import {gtfsDataSources} from '@/lib/gtfs/feed';
import {createMapLayerTool, createZoomToLayerTool} from '@/lib/map/map-layer-tool';

export type RoomState = RoomShellSliceState & SqlEditorSliceState & AppSliceState & AiSliceState & AiSettingsSliceState;

const layout: LayoutConfig = {
  id: 'root',
  type: 'split',
  direction: 'row',
  children: [
    {type: 'panel', id: 'chat', panel: 'chat', defaultSize: '42%', minSize: '360px'},
    {type: 'panel', id: 'map', panel: 'map'},
  ],
};

const proxyModel = createProxyModel(() => roomStore.getState().ai.config.currentSessionId);

export const {roomStore, useRoomStore} = createRoomStore<RoomState>((set, get, store) => ({
  ...createRoomShellSlice({
    connector: createWasmDuckDbConnector({
      // spatial: ST_Point / ST_AsWKB for the stops map layer (Task 8)
      initializationQuery: 'LOAD spatial;',
    }),
    config: {
      title: 'MBTA GTFS Agent',
      dataSources: gtfsDataSources(window.location.origin),
    },
    layout: {
      config: layout,
      panels: {
        chat: {title: 'Chat', icon: MessageSquareIcon, component: ChatPanel},
        map: {title: 'Map', icon: MapIcon, component: MapPanel},
      },
    },
  })(set, get, store),
  ...createSqlEditorSlice()(set, get, store),
  ...createAppSlice()(set, get, store),
  // The real model id + effort live server-side (/api/llm); this placeholder keeps the AI slice's
  // model-selection plumbing satisfied. No key or model id here is sent to a provider.
  ...createAiSettingsSlice({
    // Installed AiSettingsSliceConfig models are `{modelName}` only (no `id`).
    config: {providers: {server: {baseUrl: '', apiKey: '', models: [{modelName: 'server'}]}}},
  })(set, get, store),
  ...createAiSlice({
    defaultProvider: 'server',
    defaultModel: 'server',
    // Agent loop runs here so the browser tools execute; each model step goes through /api/llm.
    getCustomModel: () => proxyModel,
    getInstructions: () => buildInstructions(),
    tools: (() => {
      const {query} = createDefaultAiTools(store, {
        query: {readOnly: true, numberOfRowsToShareWithLLM: 100},
        commands: false,
        tables: false,
      });
      return {
        // ponytail: wrap rather than re-implement — sqlrooms parses/validates the SELECT; we add the row cap.
        query: {
          ...query,
          execute: (params, options) => {
            try {
              return query.execute!({...params, sqlQuery: withLimit(params.sqlQuery)}, options);
            } catch (error) {
              // withLimit/assertReadOnly throws synchronously (e.g. non-SELECT); match
              // sqlrooms' own failure output shape instead of an unhandled rejection.
              return Promise.resolve({
                success: false,
                details: 'Query execution failed.',
                error: error instanceof Error ? error.message : 'Unknown error',
                title: 'Query Result',
                sqlQuery: params.sqlQuery,
              });
            }
          },
        },
        chart: (() => {
          const chart = createVegaChartTool({
            description: TOOL_DESCRIPTIONS.chart,
            validateSql: createSqlValidator(() => store.getState().db.getConnector()),
          });
          // The renderer draws output.vegaLiteSpec; the model's own spec stays untouched in the tool input.
          return {
            ...chart,
            execute: async (params, options) => {
              // createVegaChartTool's execute is never streaming; narrow away the AsyncIterable branch.
              const out = (await chart.execute!(params, options)) as Exclude<Awaited<ReturnType<NonNullable<typeof chart.execute>>>, AsyncIterable<unknown>>;
              if (!out.success || !out.vegaLiteSpec) return out;
              const spec = out.vegaLiteSpec as unknown as Parameters<typeof enhanceSpec>[0];
              const field = colorField(spec);
              let routeColors;
              if (field) {
                try {
                  const connector = await store.getState().db.getConnector();
                  const rows = arrowTableToJson(await connector.query(routeColorSql(out.sqlQuery, field)));
                  routeColors = routeColorMap(rows as Array<{v: string; c: string | null}>);
                } catch {
                  // No route colours; the chart still renders with the default palette.
                }
              }
              return {...out, vegaLiteSpec: enhanceSpec(spec, routeColors) as unknown as typeof out.vegaLiteSpec};
            },
          };
        })(),
        map_layer: createMapLayerTool(store),
        zoom_to_layer: createZoomToLayerTool(store),
      };
    })(),
    toolRenderers: {
      query: QueryResultWithEditor,
      chart: VegaChartToolResult,
      map_layer: MapLayerToolResult,
    },
    onChatFinish: ({messages}) => {
      // sqlrooms stamps each assistant message with `tokenUsage` for that response; sum across the session.
      type Usage = {inputTokens?: number; outputTokens?: number; outputTokenDetails?: {reasoningTokens?: number}};
      const usage = messages.reduce(
        (acc, m) => {
          const u = (m.metadata as {tokenUsage?: Usage} | undefined)?.tokenUsage;
          return {
            inputTokens: acc.inputTokens + (u?.inputTokens ?? 0),
            outputTokens: acc.outputTokens + (u?.outputTokens ?? 0),
            reasoningTokens: acc.reasoningTokens + (u?.outputTokenDetails?.reasoningTokens ?? 0),
          };
        },
        {inputTokens: 0, outputTokens: 0, reasoningTokens: 0},
      );
      get().app.setUsage(usage);
    },
  })(set, get, store),
}));
