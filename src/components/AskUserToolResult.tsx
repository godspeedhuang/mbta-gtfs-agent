'use client';

import type {ToolRendererProps} from '@sqlrooms/ai-core';
import {Button, Input} from '@sqlrooms/ui';
import {MessageCircleQuestionIcon} from 'lucide-react';
import {useState} from 'react';
import type {z} from 'zod';
import {useRoomStore} from '@/app/store';
import {setAskUserAnswers} from '@/lib/agent/ask-user-tool';
import type {AskUserOutput, AskUserParams} from '@/lib/agent/tool-schemas';

const OTHER = '__other__';
// The UI supplies "Other"; drop the model's own catch-all option if it adds one anyway.
const isCatchAll = (label: string) => /^(other|something else|none of these|no\b|其他|以上皆非|不是|否)/i.test(label.trim());

/**
 * Multiple-choice clarification. ask_user needs approval, so the loop pauses and sqlrooms renders this while approval
 * is requested; Continue stores the choices and approves, and the tool returns them to the model.
 */
export function AskUserToolResult({input, output, state, toolCallId, approvalId}: ToolRendererProps<AskUserOutput, z.infer<typeof AskUserParams>>) {
  const questions = input?.questions ?? [];
  const [picked, setPicked] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const chat = useRoomStore((s) => {
    const sessionId = s.ai.getToolCallSession(toolCallId) ?? s.ai.getCurrentSession()?.id;
    return sessionId ? s.ai.getSessionChat(sessionId) : undefined;
  });

  // Input streams in partially; wait for complete questions before rendering choices.
  if (state === 'input-streaming' || !questions.length || questions.some((q) => !q?.question || !Array.isArray(q.options))) {
    return state === 'input-streaming' ? <div className="text-muted-foreground text-xs">Preparing a question…</div> : null;
  }

  if (output) {
    return (
      <div className="rounded-md border border-sky-500/40 p-2 text-xs">
        {output.note && <div className="text-muted-foreground">{output.note}</div>}
        {output.answers.map((a) => (
          <div key={a.question}>
            <span className="text-muted-foreground">{a.question}</span> <span className="font-medium">{[...a.selected, ...(a.other ? [a.other] : [])].join(', ')}</span>
          </div>
        ))}
      </div>
    );
  }

  const waiting = state === 'approval-requested' && Boolean(approvalId);
  const toggle = (qi: number, value: string, multi: boolean) =>
    setPicked((p) => {
      const cur = p[qi] ?? [];
      return {...p, [qi]: multi ? (cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]) : [value]};
    });
  const answered = (qi: number) => {
    const sel = picked[qi] ?? [];
    return sel.length > 0 && (!sel.includes(OTHER) || Boolean(other[qi]?.trim()));
  };
  const submit = () => {
    setAskUserAnswers(toolCallId, {
      answers: questions.map((q, qi) => ({
        question: q.question,
        selected: (picked[qi] ?? []).filter((v) => v !== OTHER),
        ...(picked[qi]?.includes(OTHER) ? {other: other[qi]?.trim()} : {}),
      })),
    });
    void chat?.addToolApprovalResponse({id: approvalId!, approved: true});
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-sky-500/40 p-3 text-sm">
      {questions.map((q, qi) => (
        <fieldset key={qi} className="flex flex-col gap-1.5" disabled={!waiting}>
          <legend className="mb-1 flex items-center gap-1.5 font-medium">
            <MessageCircleQuestionIcon className="h-4 w-4 text-sky-400" />
            <span className="rounded bg-sky-500/15 px-1.5 text-xs text-sky-300">{q.header}</span>
            {q.question}
            {q.multiSelect && <span className="text-muted-foreground text-xs">(choose any)</span>}
          </legend>
          {(() => {
            const options = q.options.filter((o) => !isCatchAll(o.label));
            // A single option is a yes/no confirmation; the catch-all becomes the "no".
            const other = options.length === 1 ? {label: 'No, something else', description: 'Type what you meant.'} : {label: 'Other', description: 'Type your own answer.'};
            return [...options, other];
          })().map((o, oi, all) => {
            const value = oi === all.length - 1 ? OTHER : o.label;
            const on = picked[qi]?.includes(value) ?? false;
            return (
              <button
                key={o.label}
                type="button"
                onClick={() => toggle(qi, value, q.multiSelect)}
                className={`rounded-md border px-2.5 py-1.5 text-left transition-colors ${on ? 'border-sky-400 bg-sky-500/15' : 'border-border hover:bg-muted/50'}`}
              >
                <div>{o.label}</div>
                <div className="text-muted-foreground text-xs">{o.description}</div>
              </button>
            );
          })}
          {picked[qi]?.includes(OTHER) && (
            <Input autoFocus placeholder="Your answer" value={other[qi] ?? ''} onChange={(e) => setOther((s) => ({...s, [qi]: e.target.value}))} />
          )}
        </fieldset>
      ))}
      <Button size="sm" className="self-end" disabled={!waiting || !chat || !questions.every((_, qi) => answered(qi))} onClick={submit}>
        Continue
      </Button>
    </div>
  );
}
