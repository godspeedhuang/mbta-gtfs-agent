import {createOpenAI} from '@ai-sdk/openai';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
const EFFORTS: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];

export function modelConfig(overrides: {model?: string; reasoningEffort?: string} = {}) {
  const reasoningEffort = (overrides.reasoningEffort ?? process.env.OPENAI_REASONING_EFFORT ?? 'medium') as ReasoningEffort;
  if (!EFFORTS.includes(reasoningEffort)) throw new Error(`OPENAI_REASONING_EFFORT must be one of ${EFFORTS.join(', ')}`);
  return {
    baseURL: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: overrides.model ?? process.env.OPENAI_MODEL ?? '',
    reasoningEffort,
  };
}

/** Responses API model plus the providerOptions that carry reasoning effort. */
export function createModel(cfg: ReturnType<typeof modelConfig>) {
  const provider = createOpenAI({baseURL: cfg.baseURL, apiKey: cfg.apiKey});
  return {
    model: provider.responses(cfg.model),
    // Parley doesn't persist response items, so carry reasoning forward as encrypted content.
    providerOptions: {openai: {reasoningEffort: cfg.reasoningEffort, store: false, include: ['reasoning.encrypted_content']}},
  };
}
