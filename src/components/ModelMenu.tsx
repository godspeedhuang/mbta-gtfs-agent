'use client';

import {Select, SelectContent, SelectItem, SelectTrigger} from '@sqlrooms/ui';
import {useRoomStore} from '@/app/store';
import {MODEL_PRESETS, presetAt} from '@/lib/agent/presets';

/** Model menu for the current chat session. sqlrooms' ModelSelector has no room for the per-model note. */
export function ModelMenu() {
  const model = useRoomStore((s) => s.ai.getCurrentSession()?.model);
  const setAiModel = useRoomStore((s) => s.ai.setAiModel);
  const value = presetAt(model) ? model! : '0';
  return (
    <Select value={value} onValueChange={(v) => setAiModel('server', v)}>
      <SelectTrigger className="h-8 w-auto px-2.5 text-xs font-medium shadow-none">{MODEL_PRESETS[Number(value)].label}</SelectTrigger>
      <SelectContent>
        {MODEL_PRESETS.map((p, i) => (
          <SelectItem key={i} value={String(i)} className="text-xs">
            <div className="flex flex-col">
              <span>{p.label}</span>
              {p.note && <span className="text-muted-foreground">{p.note}</span>}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
