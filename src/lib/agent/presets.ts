import raw from '../../../models.json' with {type: 'json'};

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high';
export type ApiMode = 'responses' | 'chat';
export type ModelPreset = {label: string; model: string; effort: ReasoningEffort; api: ApiMode; note?: string};

/** The model menu, from models.json. Only `model` is required; the first entry is the default. */
export const MODEL_PRESETS: ModelPreset[] = (raw as Array<Partial<ModelPreset> & {model: string}>).map((p) => ({
  label: p.model,
  effort: 'none',
  api: 'chat',
  ...p,
}));

/** Preset for a menu index sent by the browser; undefined for anything that isn't a listed index. */
export function presetAt(index: string | null | undefined): ModelPreset | undefined {
  return index && /^\d+$/.test(index) ? MODEL_PRESETS[Number(index)] : undefined;
}
