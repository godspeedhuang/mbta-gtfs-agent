import {createWasmDuckDbConnector} from '@sqlrooms/duckdb';
import {createRoomShellSlice, createRoomStore, type LayoutConfig, type RoomShellSliceState} from '@sqlrooms/room-shell';
import {createSqlEditorSlice, type SqlEditorSliceState} from '@sqlrooms/sql-editor';
import {MapIcon, MessageSquareIcon} from 'lucide-react';
import {ChatPanel} from '@/components/ChatPanel';
import {MapPanel} from '@/components/MapPanel';
import {createAppSlice, type AppSliceState} from '@/lib/app-slice';
import {gtfsDataSources} from '@/lib/gtfs/feed';

export type RoomState = RoomShellSliceState & SqlEditorSliceState & AppSliceState;

const layout: LayoutConfig = {
  id: 'root',
  type: 'split',
  direction: 'row',
  children: [
    {type: 'panel', id: 'chat', panel: 'chat', defaultSize: '42%', minSize: '360px'},
    {type: 'panel', id: 'map', panel: 'map'},
  ],
};

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
}));
