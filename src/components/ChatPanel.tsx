'use client';

import {Chat} from '@sqlrooms/ai';
import {SkeletonPane} from '@sqlrooms/ui';
import {useRoomStore} from '@/app/store';

const SUGGESTIONS = [
  'What is the scheduled headway on Route 1 by hour on a weekday?',
  'Which bus routes run every 10 minutes or better during the AM peak (7–9 AM) on a weekday?',
  'Which routes serve Harvard, and what are the first and last departures on a weekday?',
  'Compare Route 1 and Route 66: weekday AM peak vs. Saturday AM peak median headway.',
  'Is Route 1 running on time right now?',
];

export function ChatPanel() {
  const sessionId = useRoomStore((s) => s.ai.config.currentSessionId || null);
  const ready = useRoomStore((s) => s.room.initialized);
  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-hidden p-3">
      <Chat>
        <Chat.Sessions className="w-full" />
        <div className="grow overflow-auto">
          {ready ? (
            <Chat.Messages key={sessionId} hoistedRenderers={['chart']} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center">
              <SkeletonPane className="p-4" />
              <p className="text-muted-foreground mt-2 text-sm">Loading GTFS into DuckDB…</p>
            </div>
          )}
        </div>
        <Chat.PromptSuggestions>
          {SUGGESTIONS.map((text) => (
            <Chat.PromptSuggestions.Item key={text} text={text} />
          ))}
        </Chat.PromptSuggestions>
        <Chat.Composer placeholder="Ask about scheduled MBTA service…" />
      </Chat>
    </div>
  );
}
