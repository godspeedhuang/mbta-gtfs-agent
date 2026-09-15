'use client';

import {Chat} from '@sqlrooms/ai';
import {usePromptSuggestions} from '@sqlrooms/ai-core';
import {Button, SkeletonPane} from '@sqlrooms/ui';
import {HistoryIcon, PlusIcon} from 'lucide-react';
import {useState} from 'react';
import {useRoomStore} from '@/app/store';
import {ModelMenu} from '@/components/ModelMenu';

// One opener per demo thread; the follow-ups (Saturday, Route 66, SQL edit, real-time refusal) are typed live.
const SUGGESTIONS = [
  'Which bus routes are frequent?',
  'What is the scheduled headway on Route 1 by hour on a weekday?',
  'Which bus routes gained or lost weekday trips from Summer 2026 to Fall 2026?',
  'Which routes serve Harvard, and what are the first and last departures on a weekday?',
];

export function ChatPanel() {
  const ready = useRoomStore((s) => s.room.initialized);
  const createSession = useRoomStore((s) => s.ai.createSession);
  const switchSession = useRoomStore((s) => s.ai.switchSession);
  const clearLayers = useRoomStore((s) => s.app.clearLayers);
  const [showHistory, setShowHistory] = useState(false);
  const newChat = () => {
    createSession();
    clearLayers();
    setShowHistory(false);
  };
  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex items-center gap-1 border-b px-4 py-2">
        <h1 className="text-base font-semibold">MBTA GTFS Agent</h1>
        <Button variant="ghost" size="icon" className="ml-auto h-8 w-8" title="Chat history" onClick={() => setShowHistory((v) => !v)}>
          <HistoryIcon className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="New chat" onClick={newChat}>
          <PlusIcon className="h-4 w-4" />
        </Button>
      </div>
      <Chat>
        {showHistory ? (
          <Chat.History
            className="grow overflow-auto p-3"
            onBack={() => setShowHistory(false)}
            onSelectChat={(id) => {
              switchSession(id);
              setShowHistory(false);
            }}
            onCreateSession={newChat}
          />
        ) : (
          <>
            {/* mt: the sticky question pins to this box's top edge, so keep a gap below the header */}
            <div className="mt-3 grow overflow-auto px-3">
              {ready ? (
                <Conversation />
              ) : (
                <div className="flex h-full flex-col items-center justify-center">
                  <SkeletonPane className="p-4" />
                  <p className="text-muted-foreground mt-2 text-sm">Loading GTFS into DuckDB…</p>
                </div>
              )}
            </div>
            <div className="p-3">
              <Chat.Composer placeholder="Ask about scheduled MBTA service…">
                <ModelMenu />
              </Chat.Composer>
            </div>
          </>
        )}
      </Chat>
    </div>
  );
}

/** Messages once the chat has started; a centred welcome with suggestion cards before that. */
function Conversation() {
  const sessionId = useRoomStore((s) => s.ai.config.currentSessionId || null);
  const {isSessionEmpty, send, isReadyToSend} = usePromptSuggestions();
  if (!isSessionEmpty) return <Chat.Messages key={sessionId} hoistedRenderers={['chart', 'ask_user']} />;
  return (
    <div className="mx-auto flex h-full max-w-xl flex-col justify-center gap-6 py-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold">Ask about scheduled MBTA service</h2>
        <p className="text-muted-foreground mt-1 text-sm">Static GTFS schedules · answers with SQL, charts and maps · not real-time</p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((text) => (
          <button
            key={text}
            type="button"
            disabled={!isReadyToSend}
            onClick={() => send(text)}
            className="hover:bg-muted/60 rounded-lg border p-3 text-left text-sm leading-snug disabled:opacity-50"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
