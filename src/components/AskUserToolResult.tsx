'use client';

import type {ToolRendererProps} from '@sqlrooms/ai-core';
import {Button, Input} from '@sqlrooms/ui';
import {CheckIcon} from 'lucide-react';
import {useState} from 'react';
import type {z} from 'zod';
import {useRoomStore} from '@/app/store';
import {setAskUserAnswers} from '@/lib/agent/ask-user-tool';
import type {AskUserOutput, AskUserParams} from '@/lib/agent/tool-schemas';

const OTHER = '__other__';
// The UI supplies "Other"; drop the model's own catch-all option if it adds one anyway.
const isCatchAll = (label: string) => /^(other|something else|none of these|no\b|其他|以上皆非|不是|否)/i.test(label.trim());
const RECOMMENDED = /\s*\(recommended\)\s*$/i;

/**
 * Clarifying questions, one at a time (Back / Next), sent together from the last step. ask_user needs approval, so
 * the loop pauses and sqlrooms renders this while approval is requested; Send stores the choices and approves.
 */
export function AskUserToolResult({input, output, state, toolCallId, approvalId}: ToolRendererProps<AskUserOutput, z.infer<typeof AskUserParams>>) {
  const questions = input?.questions ?? [];
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const chat = useRoomStore((s) => {
    const sessionId = s.ai.getToolCallSession(toolCallId) ?? s.ai.getCurrentSession()?.id;
    return sessionId ? s.ai.getSessionChat(sessionId) : undefined;
  });

  // Input streams in partially; wait for complete questions before rendering choices.
  if (state === 'input-streaming' || !questions.length || questions.some((q) => !q?.question || !Array.isArray(q.options))) {
    return state === 'input-streaming' ? <div className="text-muted-foreground text-sm">Preparing a question…</div> : null;
  }

  if (output) {
    return (
      <div className="text-muted-foreground flex flex-col gap-0.5 text-sm">
        {output.note && <div>{output.note}</div>}
        {output.answers.map((a) => (
          <div key={a.question}>
            {a.question} <span className="text-foreground">{[...a.selected, ...(a.other ? [a.other] : [])].map((s) => s.replace(RECOMMENDED, '')).join(', ')}</span>
          </div>
        ))}
      </div>
    );
  }

  const waiting = state === 'approval-requested' && Boolean(approvalId);
  const q = questions[step]!;
  const options = q.options.filter((o) => !isCatchAll(o.label));
  // A single option is a yes/no confirmation; the catch-all becomes the "no".
  const otherLabel = options.length === 1 ? 'No, something else' : 'Other';
  const sel = picked[step] ?? [];
  const answered = (qi: number) => {
    const s = picked[qi] ?? [];
    return s.length > 0 && (!s.includes(OTHER) || Boolean(other[qi]?.trim()));
  };
  const toggle = (value: string) =>
    setPicked((p) => ({...p, [step]: q.multiSelect ? (sel.includes(value) ? sel.filter((v) => v !== value) : [...sel, value]) : [value]}));
  const last = step === questions.length - 1;
  const submit = () => {
    setAskUserAnswers(toolCallId, {
      answers: questions.map((qq, qi) => ({
        question: qq.question,
        selected: (picked[qi] ?? []).filter((v) => v !== OTHER),
        ...(picked[qi]?.includes(OTHER) ? {other: other[qi]?.trim()} : {}),
      })),
    });
    void chat?.addToolApprovalResponse({id: approvalId!, approved: true});
  };

  const row = (value: string, label: string, description?: string) => {
    const on = sel.includes(value);
    return (
      <button
        key={value}
        type="button"
        disabled={!waiting}
        onClick={() => toggle(value)}
        className={`flex w-full items-start gap-3 rounded-md px-3 py-2 text-left transition-colors ${on ? 'bg-muted' : 'hover:bg-muted/50'}`}
      >
        <span className="flex-1">
          <span className="block">
            {label.replace(RECOMMENDED, '')}
            {RECOMMENDED.test(label) && <span className="text-muted-foreground ml-2 text-xs">Recommended</span>}
          </span>
          {description && <span className="text-muted-foreground block text-xs">{description}</span>}
        </span>
        <CheckIcon className={`mt-0.5 h-4 w-4 shrink-0 ${on ? '' : 'invisible'}`} />
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 text-sm">
      {questions.length > 1 && (
        <div className="text-muted-foreground text-xs">
          {step + 1} of {questions.length}
        </div>
      )}
      <div className="font-medium">
        {q.question}
        {q.multiSelect && <span className="text-muted-foreground ml-2 text-xs font-normal">Choose any</span>}
      </div>
      <div className="-mx-1 flex flex-col">
        {options.map((o) => row(o.label, o.label, o.description))}
        {row(OTHER, otherLabel)}
      </div>
      {sel.includes(OTHER) && (
        <Input
          autoFocus
          placeholder="Type your answer"
          value={other[step] ?? ''}
          onChange={(e) => setOther((s) => ({...s, [step]: e.target.value}))}
          onKeyDown={(e) => e.key === 'Enter' && answered(step) && (last ? submit() : setStep(step + 1))}
        />
      )}
      <div className="flex items-center justify-end gap-2">
        {step > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}
        {last ? (
          <Button size="sm" disabled={!waiting || !chat || !questions.every((_, qi) => answered(qi))} onClick={submit}>
            Send
          </Button>
        ) : (
          <Button size="sm" disabled={!answered(step)} onClick={() => setStep(step + 1)}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
