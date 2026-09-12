import type {LanguageModelV3, LanguageModelV3StreamPart} from '@ai-sdk/provider';

/**
 * Browser-side LanguageModel whose every step is executed by `/api/llm` on the server.
 * The server owns the key, model id and reasoning effort; `modelId` here is only a label.
 */
export function createProxyModel(getSessionId: () => string | undefined): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'server',
    modelId: 'server',
    supportedUrls: {},
    doGenerate: () => Promise.reject(new Error('Only streaming is supported by /api/llm')),
    async doStream({abortSignal, headers: _headers, ...options}) {
      const res = await fetch('/api/llm', {
        method: 'POST',
        headers: {'content-type': 'application/json', 'x-session-id': getSessionId() ?? ''},
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
