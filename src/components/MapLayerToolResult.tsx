'use client';

import type {ToolRendererProps} from '@sqlrooms/ai-core';
import {MapIcon} from 'lucide-react';
import type {MapLayerToolOutput} from '@/lib/map/map-layer-tool';
import type {z} from 'zod';
import type {MapLayerParams} from '@/lib/agent/tool-schemas';

export function MapLayerToolResult({input, output}: ToolRendererProps<MapLayerToolOutput, z.infer<typeof MapLayerParams>>) {
  if (!output) return null;
  return (
    <div className={`rounded-md border p-2 text-xs ${output.success ? 'border-emerald-500/40' : 'border-red-500/40'}`}>
      <div className="flex items-center gap-1 font-medium">
        <MapIcon className="h-3 w-3" /> {output.success ? output.details : `Map layer failed: ${output.error}`}
      </div>
      {input?.sqlQuery && <pre className="text-muted-foreground mt-1 max-h-32 overflow-auto whitespace-pre-wrap">{input.sqlQuery}</pre>}
    </div>
  );
}
