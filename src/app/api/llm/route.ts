import type {LanguageModelV3CallOptions, LanguageModelV3StreamPart} from '@ai-sdk/provider';
import {RunTree} from 'langsmith';
import {convertMessageToTracedFormat} from 'langsmith/experimental/vercel';
import {after} from 'next/server';
import {createModel, modelConfig} from '@/lib/agent/model';

// Model-layer proxy: the agent loop and tools run in the browser (sqlrooms); every model step
// lands here as LanguageModelV3 call options. The server adds the key, pins model + reasoning
// effort, and traces the call to LangSmith. Nothing about the key ever reaches the client.
export const maxDuration = 120;

export function GET() {
  try {
    const {baseURL, model, reasoningEffort, api} = modelConfig();
    return Response.json({model, baseUrl: baseURL, reasoningEffort, api});
  } catch (err) {
    return Response.json({error: err instanceof Error ? err.message : String(err)}, {status: 500});
  }
}

export async function POST(req: Request) {
  let cfg;
  try {
    cfg = modelConfig();
  } catch (err) {
    return Response.json({error: err instanceof Error ? err.message : String(err)}, {status: 500});
  }
  const {model, providerOptions} = createModel(cfg);
  const options = (await req.json()) as LanguageModelV3CallOptions;
  const trace = startRun(options, cfg, req.headers.get('x-session-id'));

  let stream;
  try {
    ({stream} = await model.doStream({...options, providerOptions, headers: undefined, abortSignal: req.signal}));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    after(() => endRun(trace, [], message));
    return Response.json({error: message}, {status: 502});
  }

  const parts: LanguageModelV3StreamPart[] = [];
  let finish: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  req.signal.addEventListener('abort', () => finish());
  after(() => done.then(() => endRun(trace, parts, req.signal.aborted ? 'aborted by client' : undefined)));

  const body = stream
    .pipeThrough(
      new TransformStream<LanguageModelV3StreamPart, string>({
        transform(part, controller) {
          parts.push(part);
          const wire = part.type === 'error' ? {...part, error: errorMessage(part.error)} : part;
          controller.enqueue(JSON.stringify(wire) + '\n');
        },
        flush: () => finish(),
      }),
    )
    .pipeThrough(new TextEncoderStream());
  return new Response(body, {headers: {'content-type': 'application/x-ndjson; charset=utf-8'}});
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
}

function startRun(options: LanguageModelV3CallOptions, cfg: ReturnType<typeof modelConfig>, sessionId: string | null) {
  if (process.env.LANGSMITH_TRACING !== 'true' || !process.env.LANGSMITH_API_KEY) return undefined;
  const run = new RunTree({
    name: 'ai.doStream',
    run_type: 'llm',
    inputs: {
      messages: options.prompt.map((m) => convertMessageToTracedFormat(m as unknown as Record<string, unknown>)),
      tools: options.tools?.map((t) => t.name),
    },
    metadata: {
      ls_integration: 'vercel-ai-sdk',
      ls_provider: 'openai',
      ls_model_name: cfg.model,
      reasoning_effort: cfg.reasoningEffort,
      // LangSmith groups runs sharing session_id into one thread (one sqlrooms chat session).
      ...(sessionId ? {session_id: sessionId} : {}),
    },
  });
  // Awaited by endRun so the create lands before the patch; failures never break the chat.
  return {run, posted: run.postRun().catch(() => undefined)};
}

async function endRun(
  trace: {run: RunTree; posted: Promise<unknown>} | undefined,
  parts: LanguageModelV3StreamPart[],
  failure: string | undefined,
) {
  if (!trace) return;
  const {run} = trace;
  await trace.posted;
  let text = '';
  let reasoning = '';
  const toolCalls = [];
  let usage;
  let error = failure;
  for (const p of parts) {
    if (p.type === 'text-delta') text += p.delta;
    else if (p.type === 'reasoning-delta') reasoning += p.delta;
    else if (p.type === 'tool-call')
      toolCalls.push({id: p.toolCallId, type: 'function', function: {name: p.toolName, arguments: p.input}});
    else if (p.type === 'finish') usage = p.usage;
    else if (p.type === 'error') error = errorMessage(p.error);
  }
  if (usage) {
    run.extra = {
      ...run.extra,
      metadata: {
        ...run.extra?.metadata,
        usage_metadata: {
          input_tokens: usage.inputTokens.total ?? 0,
          output_tokens: usage.outputTokens.total ?? 0,
          total_tokens: (usage.inputTokens.total ?? 0) + (usage.outputTokens.total ?? 0),
          output_token_details: {reasoning: usage.outputTokens.reasoning ?? 0},
        },
      },
    };
  }
  const content = [...(reasoning ? [{type: 'reasoning', reasoning}] : []), ...(text ? [{type: 'text', text}] : [])];
  await run.end(
    convertMessageToTracedFormat({role: 'assistant', content, tool_calls: toolCalls}),
    error,
  );
  await run.patchRun().catch(() => undefined);
}
