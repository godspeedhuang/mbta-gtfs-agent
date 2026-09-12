'use client';

import {useEffect, useState} from 'react';
import {useRoomStore} from '@/app/store';
import {FEED} from '@/lib/gtfs/feed';

export function Header() {
  const usage = useRoomStore((s) => s.app.usage);
  const [model, setModel] = useState('…');
  const [effort, setEffort] = useState('…');
  useEffect(() => {
    fetch('/api/llm')
      .then((r) => r.json())
      .then((j) => {
        setModel(j.model || 'not configured');
        setEffort(j.reasoningEffort ?? '?');
      })
      .catch(() => setModel('unreachable'));
  }, []);
  return (
    <header className="bg-card text-card-foreground flex items-center gap-4 border-b px-4 py-2 text-xs">
      <span className="text-sm font-semibold">MBTA GTFS Agent</span>
      <span className="text-muted-foreground">
        {FEED.agency} static GTFS · {FEED.version} · {FEED.start} → {FEED.end} · scheduled service only
      </span>
      <span className="ml-auto font-mono">
        model: {model} · effort: {effort}
      </span>
      <span className="font-mono">
        tokens: {usage.inputTokens.toLocaleString()} in / {usage.outputTokens.toLocaleString()} out (
        {usage.reasoningTokens.toLocaleString()} reasoning)
      </span>
    </header>
  );
}
