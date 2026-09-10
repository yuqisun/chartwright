import type { LlmClient } from 'chartwright';

/**
 * The browser-side LLM client.
 *
 * It holds **no credentials**. It posts to our own origin and a node process
 * (see `server/proxy.mjs`) injects the provider key. Anything running in the
 * page — including DevTools — can see only this endpoint path.
 *
 * Writing this by hand is the point of the design: chartwright asks for a
 * function, not for a provider SDK, so the app decides where the model call
 * actually happens and who holds the key.
 */
export function createBrowserClient(endpoint = '/api/llm'): LlmClient {
  return {
    async complete(request) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: request.messages, tools: request.tools }),
        signal: request.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`llm proxy failed (${response.status}): ${detail.slice(0, 200)}`);
      }

      return (await response.json()) as Awaited<ReturnType<LlmClient['complete']>>;
    },
  };
}
