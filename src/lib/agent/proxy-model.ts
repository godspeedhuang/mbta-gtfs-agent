import type {LanguageModelV3, LanguageModelV3StreamPart} from '@ai-sdk/provider';

/**
 * Browser-side LanguageModel whose every step is executed by `/api/llm` on the server.
 * The browser sends only the chosen models.json index; the server owns the key and resolves the model.
 */
export function createProxyModel(getSession: () => {id?: string; preset: string}): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'server',
    modelId: 'server',
    supportedUrls: {},
    doGenerate: () => Promise.reject(new Error('Only streaming is supported by /api/llm')),
    async doStream({abortSignal, headers: _headers, ...options}) {
      // Absolute URL: a relative fetch throws when the page URL carries Basic Auth credentials.
      const session = getSession();
      const res = await fetch(`${location.origin}/api/llm`, {
        method: 'POST',
        headers: {'content-type': 'application/json', 'x-session-id': session.id ?? '', 'x-model-preset': session.preset},
        body: JSON.stringify(options),
        signal: abortSignal,
      });
      if (!res.ok || !res.body) {
        const {error} = await res.json().catch(() => ({error: res.statusText}));
        throw new Error(`/api/llm ${res.status}: ${error}`);
      }
      let buffer = '';
      const stream = res.body.pipeThrough(new TextDecoderStream()).pipeThrough(
        new TransformStream<string, LanguageModelV3StreamPart>({
          transform(chunk, controller) {
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop()!;
            for (const line of lines) if (line) controller.enqueue(revive(JSON.parse(line)));
          },
        }),
      );
      return {stream};
    },
  };
}

function revive(part: LanguageModelV3StreamPart): LanguageModelV3StreamPart {
  // Dates don't survive JSON.
  if (part.type === 'response-metadata' && part.timestamp) return {...part, timestamp: new Date(part.timestamp)};
  return part;
}
