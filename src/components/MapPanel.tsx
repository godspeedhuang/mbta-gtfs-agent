'use client';

import {DeckJsonMap} from '@sqlrooms/deck';
import {Button} from '@sqlrooms/ui';
import {useMemo} from 'react';
import {useRoomStore} from '@/app/store';
import {layerSql} from '@/lib/map/map-layer-tool';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const BOSTON = {longitude: -71.09, latitude: 42.35, zoom: 11, pitch: 0, bearing: 0};

export function MapPanel() {
  const layers = useRoomStore((s) => s.app.layers);
  const clear = useRoomStore((s) => s.app.clearLayers);

  const datasets = useMemo(
    () =>
      Object.fromEntries([
        // DeckJsonMap throws with zero datasets; an empty one keeps the basemap up before any layer exists.
        ['empty', {sqlQuery: 'SELECT ST_AsWKB(ST_Point(0, 0)) AS geom LIMIT 0', geometryColumn: 'geom', geometryEncodingHint: 'wkb' as const}],
        ...layers.map((l) => [
          l.id,
          {
            sqlQuery: layerSql(l.kind, l.sql),
            geometryColumn: 'geom',
            geometryEncodingHint: 'wkb' as const,
          },
        ]),
      ]),
    [layers],
  );

  const spec = useMemo(
    () => ({
      initialViewState: BOSTON,
      controller: true,
      layers: layers.map((l) => {
        const color = l.scaled
          ? {'@@function': 'colorScale', field: 'value', type: 'sequential', scheme: 'YlOrRd', domain: 'auto', legend: {title: l.title}}
          : [255, 140, 60];
        return l.kind === 'stops'
          ? {'@@type': 'GeoArrowScatterplotLayer', id: l.id, _sqlroomsBinding: {dataset: l.id, geometryColumn: 'geom'}, pickable: true, radiusUnits: 'pixels', getRadius: 5, radiusMinPixels: 3, getFillColor: color}
          : {'@@type': 'GeoArrowPathLayer', id: l.id, _sqlroomsBinding: {dataset: l.id, geometryColumn: 'geom'}, pickable: true, widthUnits: 'pixels', getWidth: 3, widthMinPixels: 2, getColor: color};
      }),
    }),
    [layers],
  );

  return (
    <div className="relative h-full w-full">
      <DeckJsonMap
        className="absolute inset-0"
        spec={spec}
        datasets={datasets}
        mapStyle={MAP_STYLE}
        deckProps={{
          getTooltip: ({object}: {object?: {label?: string; value?: number}}) =>
            object?.label ? {text: `${object.label}: ${object.value}`} : null,
        }}
      />
      {layers.length > 0 && (
        <Button size="xs" variant="outline" className="absolute top-2 right-2" onClick={clear}>
          Clear layers
        </Button>
      )}
      {layers.length === 0 && (
        <div className="text-muted-foreground pointer-events-none absolute inset-x-0 top-3 text-center text-xs">
          Ask a "which routes / which stops" question and the agent will draw here.
        </div>
      )}
    </div>
  );
}
