'use client';

import {roomStore, useRoomStore} from '@/app/store';
import {RoomShell, RoomShellSidebarButton} from '@sqlrooms/room-shell';
import {SqlEditorModal} from '@sqlrooms/sql-editor';
import {ThemeProvider} from '@sqlrooms/ui';
import {TerminalIcon} from 'lucide-react';
import {Header} from '@/components/Header';

export default function Room() {
  const open = useRoomStore((s) => s.app.sqlEditorOpen);
  const setOpen = useRoomStore((s) => s.app.setSqlEditorOpen);
  return (
    // Fixed dark UI (spec). sqlrooms components (Vega charts, map legends) read the theme from this
    // context, not from <html class="dark">; its own storage key keeps a stray preference from overriding it.
    <ThemeProvider defaultTheme="dark" storageKey="mbta-gtfs-agent-theme">
      <div className="flex h-screen flex-col">
        <Header />
        <RoomShell className="min-h-0 flex-1" roomStore={roomStore}>
          <RoomShell.SidebarContainer>
            <RoomShellSidebarButton roomPanelType="data" />
            <RoomShell.SidebarButton title="SQL editor" icon={TerminalIcon} isSelected={open} onClick={() => setOpen(true)} />
          </RoomShell.SidebarContainer>
          <RoomShell.LayoutComposer />
          <RoomShell.LoadingProgress />
          <SqlEditorModal isOpen={open} onClose={() => setOpen(false)} />
        </RoomShell>
      </div>
    </ThemeProvider>
  );
}
