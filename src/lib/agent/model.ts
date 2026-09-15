import {createOpenAI} from '@ai-sdk/openai';
import type {ApiMode, ReasoningEffort} from './presets';

const EFFORTS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high'];
const API_MODES: ApiMode[] = ['responses', 'chat'];

/** Endpoint and key come from env; model, effort and API mode from a models.json preset or eval flags. */
export function modelConfig({model, reasoningEffort = 'none', api = 'chat'}: {model?: string; reasoningEffort?: string; api?: string}) {
  if (!model) throw new Error('model is required');
  if (!EFFORTS.includes(reasoningEffort as ReasoningEffort)) throw new Error(`effort must be one of ${EFFORTS.join(', ')}`);
  if (!API_MODES.includes(api as ApiMode)) throw new Error(`api must be one of ${API_MODES.join(', ')}`);
  return {
    baseURL: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model,
    reasoningEffort: reasoningEffort as ReasoningEffort,
    api: api as ApiMode,
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
