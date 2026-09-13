'use client';

import {DeckJsonMap, type DeckJsonMapHandle} from '@sqlrooms/deck';
import {Button} from '@sqlrooms/ui';
import {useEffect, useMemo, useRef} from 'react';
import {useRoomStore} from '@/app/store';
import {layerSql} from '@/lib/map/map-layer-tool';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const BOSTON = {longitude: -71.09, latitude: 42.35, zoom: 11, pitch: 0, bearing: 0};

/** Web Mercator zoom that fits a bbox into a width×height viewport with some padding. */
function fitZoom([x0, y0, x1, y1]: [number, number, number, number], width: number, height: number) {
  const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const pad = 0.85;
  const zx = Math.log2((width * pad * 360) / (512 * Math.max(x1 - x0, 1e-6)));
  const zy = Math.log2((height * pad * 2 * Math.PI) / (512 * Math.max(mercY(y1) - mercY(y0), 1e-9)));
  return Math.max(2, Math.min(16, Math.min(zx, zy)));
}

export function MapPanel() {
  const mapRef = useRef<DeckJsonMapHandle>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const viewTarget = useRoomStore((s) => s.app.viewTarget);
  useEffect(() => {
    const el = boxRef.current;
    if (!viewTarget || !el) return;
    const [x0, y0, x1, y1] = viewTarget.bbox;
    mapRef.current?.jumpTo({
      longitude: (x0 + x1) / 2,
      latitude: (y0 + y1) / 2,
      zoom: fitZoom(viewTarget.bbox, el.clientWidth, el.clientHeight),
    });
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
    <div ref={boxRef} className="relative h-full w-full">
      <DeckJsonMap
        ref={mapRef}
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
