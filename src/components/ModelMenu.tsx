'use client';

import {Select, SelectContent, SelectItem, SelectTrigger} from '@sqlrooms/ui';
import {useRoomStore} from '@/app/store';
import {MODEL_PRESETS, presetAt} from '@/lib/agent/presets';

/** Model menu for the current chat session. sqlrooms' ModelSelector has no room for the per-model note. */
export function ModelMenu() {
  const model = useRoomStore((s) => s.ai.getCurrentSession()?.model);
  const hasSession = useRoomStore((s) => Boolean(s.ai.config.currentSessionId));
  const setAiModel = useRoomStore((s) => s.ai.setAiModel);
  const createSession = useRoomStore((s) => s.ai.createSession);
  const value = presetAt(model) ? model! : '0';
  // Before the first message there is no session, and setAiModel silently does nothing; start one with the choice.
  const pick = (v: string) => (hasSession ? setAiModel('server', v) : createSession(undefined, 'server', v));
  return (
    <Select value={value} onValueChange={pick}>
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
