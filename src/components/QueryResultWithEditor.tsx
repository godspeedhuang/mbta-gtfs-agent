'use client';

import {QueryToolResult, type QueryToolOutput, type QueryToolParameters} from '@sqlrooms/ai';
import type {ToolRendererProps} from '@sqlrooms/ai-core';
import {useExportToCsv} from '@sqlrooms/duckdb';
import {Button} from '@sqlrooms/ui';
import {DownloadIcon, TerminalIcon} from 'lucide-react';
import {useRoomStore} from '@/app/store';

/** sqlrooms' query renderer plus "Open in SQL editor" (the audit path, spec §7, Q5) and a CSV download. */
export function QueryResultWithEditor(props: ToolRendererProps<QueryToolOutput, QueryToolParameters>) {
  const createQueryTab = useRoomStore((s) => s.sqlEditor.createQueryTab);
  const setOpen = useRoomStore((s) => s.app.setSqlEditorOpen);
  const {exportToCsv} = useExportToCsv();
  const sql = props.output?.sqlQuery;
  return (
    <div className="flex flex-col gap-1">
      <QueryToolResult {...props} />
      {sql && (
        <div className="flex justify-end gap-1">
          {/* Subselect: exportToCsv pages with an outer LIMIT, which DuckDB rejects directly on a limited query. */}
          <Button size="xs" variant="ghost" onClick={() => void exportToCsv(`SELECT * FROM (${sql}) AS __csv`, `query-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.csv`)}>
            <DownloadIcon className="mr-1 h-3 w-3" /> CSV
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              createQueryTab(sql);
              setOpen(true);
            }}
          >
            <TerminalIcon className="mr-1 h-3 w-3" /> Open in SQL editor
          </Button>
        </div>
      )}
    </div>
  );
}
