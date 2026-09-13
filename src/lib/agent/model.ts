import {createOpenAI} from '@ai-sdk/openai';

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high';
const EFFORTS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high'];
export type ApiMode = 'responses' | 'chat';
const API_MODES: ApiMode[] = ['responses', 'chat'];

export function modelConfig(overrides: {model?: string; reasoningEffort?: string; api?: string} = {}) {
  const reasoningEffort = (overrides.reasoningEffort ?? process.env.OPENAI_REASONING_EFFORT ?? 'medium') as ReasoningEffort;
  if (!EFFORTS.includes(reasoningEffort)) throw new Error(`OPENAI_REASONING_EFFORT must be one of ${EFFORTS.join(', ')}`);
  const api = (overrides.api ?? process.env.OPENAI_API ?? 'responses') as ApiMode;
  if (!API_MODES.includes(api)) throw new Error(`OPENAI_API must be one of ${API_MODES.join(', ')}`);
  return {
    baseURL: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: overrides.model ?? process.env.OPENAI_MODEL ?? '',
    reasoningEffort,
    api,
  };
}

/**
 * The model gateway. `responses` suits OpenAI models (reasoning effort is honoured, reasoning summaries stream);
 * `chat` (Chat Completions) is the common denominator for other providers behind an OpenAI-compatible endpoint
 * (on Parley: Gemini, Claude, Llama, whose tool-result turns fail through the Responses API).
 */
export function createModel(cfg: ReturnType<typeof modelConfig>) {
  const provider = createOpenAI({baseURL: cfg.baseURL, apiKey: cfg.apiKey});
  const effort = cfg.reasoningEffort === 'none' ? {} : {reasoningEffort: cfg.reasoningEffort};
  if (cfg.api === 'chat') return {model: provider.chat(cfg.model), providerOptions: {openai: effort}};
  return {
    model: provider.responses(cfg.model),
    // Parley doesn't persist response items, so carry reasoning forward as encrypted content.
    // reasoningSummary streams readable reasoning to the chat UI and LangSmith traces.
    providerOptions: {
      openai: {...effort, store: false, include: ['reasoning.encrypted_content'], reasoningSummary: 'auto'},
    },
  };
}
