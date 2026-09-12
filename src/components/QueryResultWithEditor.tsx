'use client';

import {QueryToolResult, type QueryToolOutput, type QueryToolParameters} from '@sqlrooms/ai';
import type {ToolRendererProps} from '@sqlrooms/ai-core';
import {Button} from '@sqlrooms/ui';
import {TerminalIcon} from 'lucide-react';
import {useRoomStore} from '@/app/store';

/** sqlrooms' query renderer plus "Open in SQL editor" — the audit path (spec §7, Q5). */
export function QueryResultWithEditor(props: ToolRendererProps<QueryToolOutput, QueryToolParameters>) {
  const createQueryTab = useRoomStore((s) => s.sqlEditor.createQueryTab);
  const setOpen = useRoomStore((s) => s.app.setSqlEditorOpen);
  const sql = props.output?.sqlQuery;
  return (
    <div className="flex flex-col gap-1">
      <QueryToolResult {...props} />
      {sql && (
        <Button
          size="xs"
          variant="ghost"
          className="self-end"
          onClick={() => {
            createQueryTab(sql);
            setOpen(true);
          }}
        >
          <TerminalIcon className="mr-1 h-3 w-3" /> Open in SQL editor
        </Button>
      )}
    </div>
  );
}
