import {createAiSlice, createDefaultAiTools, type AiSliceState} from '@sqlrooms/ai';
import {createAiSettingsSlice, type AiSettingsSliceState} from '@sqlrooms/ai-settings';
import {createWasmDuckDbConnector} from '@sqlrooms/duckdb';
import {createRoomShellSlice, createRoomStore, type LayoutConfig, type RoomShellSliceState} from '@sqlrooms/room-shell';
import {createSqlEditorSlice, type SqlEditorSliceState} from '@sqlrooms/sql-editor';
import {createSqlValidator, createVegaChartTool, VegaChartToolResult} from '@sqlrooms/vega';
import {arrowTableToJson} from '@sqlrooms/duckdb';
import {DatabaseIcon, MapIcon, MessageSquareIcon} from 'lucide-react';
import {ChatPanel} from '@/components/ChatPanel';
import {DataPanel} from '@/components/DataPanel';
import {AskUserToolResult} from '@/components/AskUserToolResult';
import {MapLayerToolResult} from '@/components/MapLayerToolResult';
import {MapPanel} from '@/components/MapPanel';
import {QueryResultWithEditor} from '@/components/QueryResultWithEditor';
import {createAppSlice, type AppSliceState} from '@/lib/app-slice';
import {buildInstructions} from '@/lib/agent/instructions';
import {colorField, enhanceSpec, routeColorMap, routeColorSql} from '@/lib/chart/enhance-spec';
import {createProxyModel} from '@/lib/agent/proxy-model';
import {MODEL_PRESETS, presetAt} from '@/lib/agent/presets';
import {withLimit} from '@/lib/agent/sql-guard';
import {createAskUserTool} from '@/lib/agent/ask-user-tool';
import {MAX_STEPS, TOOL_DESCRIPTIONS} from '@/lib/agent/tool-schemas';
import {gtfsDataSources} from '@/lib/gtfs/feed';
import {createMapLayerTool, createZoomToLayerTool} from '@/lib/map/map-layer-tool';

export type RoomState = RoomShellSliceState & SqlEditorSliceState & AppSliceState & AiSliceState & AiSettingsSliceState;

const layout: LayoutConfig = {
  id: 'root',
  type: 'split',
  direction: 'row',
  children: [
    {type: 'panel', id: 'data', panel: 'data', defaultSize: '220px', minSize: '180px'},
    {type: 'panel', id: 'map', panel: 'map'},
    {type: 'panel', id: 'chat', panel: 'chat', defaultSize: '42%', minSize: '360px'},
  ],
};

const proxyModel = createProxyModel(() => {
  const session = roomStore.getState().ai.getCurrentSession();
  // Sessions saved before the model menu existed carry 'server'; they fall back to the default.
  return {id: session?.id, preset: presetAt(session?.model) ? session!.model : '0'};
});

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
        data: {title: 'Data', icon: DatabaseIcon, component: DataPanel},
        chat: {title: 'Chat', icon: MessageSquareIcon, component: ChatPanel},
        map: {title: 'Map', icon: MapIcon, component: MapPanel},
      },
    },
  })(set, get, store),
  ...createSqlEditorSlice()(set, get, store),
  ...createAppSlice()(set, get, store),
  // Each session's "model" is a models.json index; /api/llm resolves it. No key or model id lives here.
  ...createAiSettingsSlice({
    // Installed AiSettingsSliceConfig models are `{modelName}` only (no `id`).
    config: {providers: {server: {baseUrl: '', apiKey: '', models: MODEL_PRESETS.map((_, i) => ({modelName: String(i)}))}}},
  })(set, get, store),
  ...createAiSlice({
    defaultProvider: 'server',
    defaultModel: '0',
    // Agent loop runs here so the browser tools execute; each model step goes through /api/llm.
    getCustomModel: () => proxyModel,
    getInstructions: () => buildInstructions(new Date(), {feeds: get().app.feeds}),
    maxSteps: MAX_STEPS,
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
        // Pauses the loop (approval flow) until the user answers in AskUserToolResult.
        ask_user: createAskUserTool(),
      };
    })(),
    toolRenderers: {
      query: QueryResultWithEditor,
      chart: VegaChartToolResult,
      map_layer: MapLayerToolResult,
      ask_user: AskUserToolResult,
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
