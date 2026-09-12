'use client';

import dynamic from 'next/dynamic';

// DuckDB-WASM and deck.gl are browser-only: never render the room on the server.
const Room = dynamic(() => import('@/components/room'), {ssr: false});

export default function AppShellClient() {
  return <Room />;
}
