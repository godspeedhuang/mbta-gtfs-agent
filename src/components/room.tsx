'use client';

import {roomStore, useRoomStore} from '@/app/store';
import {RoomShell} from '@sqlrooms/room-shell';
import {SqlEditorModal} from '@sqlrooms/sql-editor';
import {Header} from '@/components/Header';

export default function Room() {
  const open = useRoomStore((s) => s.app.sqlEditorOpen);
  const setOpen = useRoomStore((s) => s.app.setSqlEditorOpen);
  return (
    <div className="flex h-screen flex-col">
      <Header />
      <RoomShell className="min-h-0 flex-1" roomStore={roomStore}>
        <RoomShell.LayoutComposer />
        <RoomShell.LoadingProgress />
        <SqlEditorModal isOpen={open} onClose={() => setOpen(false)} />
      </RoomShell>
    </div>
  );
}
