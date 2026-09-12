import type {StateCreator} from 'zustand';

export type MapLayer = {id: string; kind: 'stops' | 'routes'; title: string; sql: string; scaled: boolean};
export type TokenUsage = {inputTokens: number; outputTokens: number};

export type AppSliceState = {
  app: {
    layers: MapLayer[];
    addLayer: (layer: MapLayer) => void;
    clearLayers: () => void;
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
      sqlEditorOpen: false,
      setSqlEditorOpen: (open) => set((s) => ({app: {...s.app, sqlEditorOpen: open}})),
      usage: {inputTokens: 0, outputTokens: 0},
      setUsage: (usage) => set((s) => ({app: {...s.app, usage}})),
    },
  });
