'use client';

import {DeckJsonMap, type DeckJsonMapProps} from '@sqlrooms/deck';
import {Button} from '@sqlrooms/ui';
import {useEffect, useMemo, useRef} from 'react';
import {useRoomStore} from '@/app/store';
import {layerSql} from '@/lib/map/map-layer-tool';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const BOSTON = {longitude: -71.09, latitude: 42.35, zoom: 11, pitch: 0, bearing: 0};

// MapLibre's own Map type, reached through DeckJsonMap's props (maplibre-gl is only a transitive dependency).
type MapLibreMap = Parameters<NonNullable<NonNullable<DeckJsonMapProps['mapProps']>['onLoad']>>[0]['target'];

export function MapPanel() {
  // The camera belongs to MapLibre (deck.gl is an overlay inside DeckJsonMap), so deck's FlyToInterpolator
  // has nothing to animate; MapLibre's flyTo is the same van Wijk zoom-out/zoom-in flight.
  const mapLibre = useRef<MapLibreMap | null>(null);
  const mapProps = useMemo(
    () => ({
      onLoad: (e: {target: MapLibreMap}) => {
        mapLibre.current = e.target;
      },
    }),
    [],
  );
  const viewTarget = useRoomStore((s) => s.app.viewTarget);
  useEffect(() => {
    const map = mapLibre.current;
    if (!viewTarget || !map) return;
    const [x0, y0, x1, y1] = viewTarget.bbox;
    const camera = map.cameraForBounds([[x0, y0], [x1, y1]], {padding: 60, maxZoom: 16});
    if (camera) map.flyTo({...camera, speed: 1.2, essential: true});
  }, [viewTarget]);
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
        const color =
          l.colorBy === 'value'
            ? {'@@function': 'colorScale', field: 'value', type: 'sequential', scheme: 'YlOrRd', domain: 'auto', legend: {title: l.title}}
            : l.colorBy === 'gtfs'
              ? '@@=[color_r, color_g, color_b]'
              : {'@@function': 'colorScale', field: 'label', type: 'categorical', scheme: 'Tableau10', legend: {title: l.title}};
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
        mapProps={mapProps}
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
    </div>
  );
}
