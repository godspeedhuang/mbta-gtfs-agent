import {createAgentUIStreamResponse, stepCountIs, ToolLoopAgent} from 'ai';
import {INSTRUCTIONS} from '@/lib/agent/instructions';
import {createModel, modelConfig} from '@/lib/agent/model';
import {serverTools} from '@/lib/agent/server-tools';

// Vercel Hobby caps function duration; a multi-step answer can take a minute.
export const maxDuration = 120;

export function GET() {
  try {
    const {baseURL, model, reasoningEffort} = modelConfig();
    return Response.json({model, baseUrl: baseURL, reasoningEffort});
  } catch (err) {
    return Response.json({error: err instanceof Error ? err.message : String(err)}, {status: 500});
  }
}

export async function POST(req: Request) {
  let cfg;
  try {
    cfg = modelConfig();
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), {status: 500});
  }
  if (!cfg.apiKey || !cfg.model) return new Response('OPENAI_API_KEY / OPENAI_MODEL not set', {status: 500});
  const {messages} = await req.json();
  const {model, providerOptions} = createModel(cfg);

  const agent = new ToolLoopAgent({
    model,
    providerOptions,
    instructions: INSTRUCTIONS, // server-controlled: the client cannot override the prompt
    tools: serverTools(),
    stopWhen: stepCountIs(8),
  });

  // Cumulative usage for this assistant message, attached as metadata on every step.
  const total = {inputTokens: 0, outputTokens: 0, reasoningTokens: 0};
  return createAgentUIStreamResponse({
    agent,
    uiMessages: messages,
    abortSignal: req.signal,
    messageMetadata: ({part}) => {
      if (part.type !== 'finish-step') return undefined;
      total.inputTokens += part.usage.inputTokens ?? 0;
      total.outputTokens += part.usage.outputTokens ?? 0;
      total.reasoningTokens += part.usage.reasoningTokens ?? 0;
      return {usage: {...total}};
    },
  });
}
