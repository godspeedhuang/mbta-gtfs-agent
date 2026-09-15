'use client';

import {ChevronDownIcon, ChevronRightIcon, UploadIcon} from 'lucide-react';
import {useState, type DragEvent} from 'react';
import {useRoomStore} from '@/app/store';
import {GTFS_TABLES} from '@/lib/gtfs/feed';
import {loadFeedFiles, MAIN_FEED, type LoadedFeed} from '@/lib/gtfs/upload';

/** Data sidebar: drop zone for a prepared feed, then every loaded feed with its tables and columns. */
export function DataPanel() {
  const feeds = useRoomStore((s) => s.app.feeds);
  const addFeed = useRoomStore((s) => s.app.addFeed);
  const getConnector = useRoomStore((s) => s.db.getConnector);
  const refreshTableSchemas = useRoomStore((s) => s.db.refreshTableSchemas);
  const [status, setStatus] = useState<{loading?: boolean; error?: string}>({});

  const load = async (files: File[]) => {
    setStatus({loading: true});
    try {
      addFeed(await loadFeedFiles(await getConnector(), files));
      await refreshTableSchemas();
      setStatus({});
    } catch (e) {
      setStatus({error: e instanceof Error ? e.message : String(e)});
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    void load(Array.from(e.dataTransfer.files));
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3 text-xs">
      <label
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        className="border-muted-foreground/40 hover:bg-muted/40 flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed px-2 py-3 text-center"
      >
        <UploadIcon className="h-4 w-4" />
        <span>{status.loading ? 'Loading…' : 'Drop a prepared GTFS feed'}</span>
        <span className="text-muted-foreground">the {GTFS_TABLES.length} parquet files from prepare-gtfs</span>
        <input type="file" multiple accept=".parquet" className="hidden" onChange={(e) => void load(Array.from(e.target.files ?? []))} />
      </label>
      {status.error && <div className="text-destructive">{status.error}</div>}
      <FeedGroup feed={MAIN_FEED} note="built in" />
      {feeds.map((f) => (
        <FeedGroup key={f.schema} feed={f} note="uploaded · this tab only" />
      ))}
    </div>
  );
}

function FeedGroup({feed, note}: {feed: LoadedFeed; note: string}) {
  const [open, setOpen] = useState<string | null>(null);
  const tables = useRoomStore((s) => s.db.tables);
  return (
    <div className="border-t pt-2">
      <div className="font-medium">
        {feed.version} <span className="text-muted-foreground font-normal">· {feed.schema}</span>
      </div>
      <div className="text-muted-foreground mb-1">
        {feed.start} → {feed.end} · {note}
      </div>
      {GTFS_TABLES.map((t) => {
        const meta = tables.find((x) => x.table.schema === feed.schema && x.table.table === t);
        const isOpen = open === t;
        return (
          <div key={t}>
            <button type="button" onClick={() => setOpen(isOpen ? null : t)} className="hover:bg-muted/50 flex w-full items-center gap-1 rounded px-1 py-0.5 font-mono">
              {isOpen ? <ChevronDownIcon className="h-3 w-3" /> : <ChevronRightIcon className="h-3 w-3" />}
              {t}
              {meta?.rowCount != null && <span className="text-muted-foreground ml-auto">{meta.rowCount.toLocaleString()}</span>}
            </button>
            {isOpen && (
              <div className="text-muted-foreground ml-5 font-mono">
                {meta ? meta.columns.map((c) => <div key={c.name}>{c.name}</div>) : 'not loaded'}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
