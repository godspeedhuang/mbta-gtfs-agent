import type {StateCreator} from 'zustand';

export type MapLayer = {id: string; kind: 'stops' | 'routes'; title: string; sql: string; colorBy: 'value' | 'gtfs' | 'label'};
/** [minLon, minLat, maxLon, maxLat]; `seq` makes zooming to the same extent twice still re-fire. */
export type ViewTarget = {bbox: [number, number, number, number]; seq: number};
export type TokenUsage = {inputTokens: number; outputTokens: number; reasoningTokens: number};

export type AppSliceState = {
  app: {
    layers: MapLayer[];
    addLayer: (layer: MapLayer) => void;
    clearLayers: () => void;
    viewTarget: ViewTarget | null;
    setViewBbox: (bbox: ViewTarget['bbox']) => void;
    sqlEditorOpen: boolean;
    setSqlEditorOpen: (open: boolean) => void;
    usage: TokenUsage;
    setUsage: (usage: TokenUsage) => void;
  };
};

export const createAppSlice =
  (): StateCreator<AppSliceState, [], [], AppSliceState> => (set) => ({
    app: {
      layers: [],
      addLayer: (layer) => set((s) => ({app: {...s.app, layers: [...s.app.layers, layer]}})),
      clearLayers: () => set((s) => ({app: {...s.app, layers: []}})),
      viewTarget: null,
      setViewBbox: (bbox) => set((s) => ({app: {...s.app, viewTarget: {bbox, seq: (s.app.viewTarget?.seq ?? 0) + 1}}})),
      sqlEditorOpen: false,
      setSqlEditorOpen: (open) => set((s) => ({app: {...s.app, sqlEditorOpen: open}})),
      usage: {inputTokens: 0, outputTokens: 0, reasoningTokens: 0},
      setUsage: (usage) => set((s) => ({app: {...s.app, usage}})),
    },
  });
