import type {StateCreator} from 'zustand';
import type {LoadedFeed} from '@/lib/gtfs/upload';

export type LegendItem = {label: string; color: [number, number, number]};
/** `value`: sequential scale on a varying metric. `route`: GTFS route colours, direction 1 a lighter shade, with `legend`. */
export type MapLayer = {id: string; kind: 'stops' | 'routes'; title: string; sql: string; colorBy: 'value' | 'route'; legend?: LegendItem[]};
/** [minLon, minLat, maxLon, maxLat]; `seq` makes zooming to the same extent twice still re-fire. */
export type ViewTarget = {bbox: [number, number, number, number]; seq: number};

export type AppSliceState = {
  app: {
    layers: MapLayer[];
    addLayer: (layer: MapLayer) => void;
    clearLayers: () => void;
    viewTarget: ViewTarget | null;
    setViewBbox: (bbox: ViewTarget['bbox']) => void;
    sqlEditorOpen: boolean;
    setSqlEditorOpen: (open: boolean) => void;
    /** Uploaded feeds (this tab only); the bundled feed is not listed. */
    feeds: LoadedFeed[];
    addFeed: (feed: LoadedFeed) => void;
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
      feeds: [],
      // Re-uploading a season replaces its entry.
      addFeed: (feed) => set((s) => ({app: {...s.app, feeds: [...s.app.feeds.filter((f) => f.schema !== feed.schema), feed]}})),
    },
  });
