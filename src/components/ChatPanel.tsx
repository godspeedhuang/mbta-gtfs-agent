'use client';

import {useRoomStore} from '@/app/store';

export function ChatPanel() {
  const tables = useRoomStore((s) => s.db.tables);
  return <div className="p-4 text-sm">tables loaded: {tables.length}</div>;
}
