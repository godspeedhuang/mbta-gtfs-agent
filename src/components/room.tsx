'use client';

import {roomStore, useRoomStore} from '@/app/store';
import {RoomShell} from '@sqlrooms/room-shell';
import {SqlEditorModal} from '@sqlrooms/sql-editor';

export default function Room() {
  const open = useRoomStore((s) => s.app.sqlEditorOpen);
  const setOpen = useRoomStore((s) => s.app.setSqlEditorOpen);
  return (
    <RoomShell className="h-screen" roomStore={roomStore}>
      <RoomShell.LayoutComposer />
      <RoomShell.LoadingProgress />
      <SqlEditorModal isOpen={open} onClose={() => setOpen(false)} />
    </RoomShell>
  );
}
