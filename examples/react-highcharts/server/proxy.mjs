/**
 * The LLM proxy.
 *
 * Why this process exists: the browser must never hold the API key. The page
 * talks to its own origin (`/api/llm`), this process injects the credential and
 * forwards to the provider. That keeps the key out of the bundle and out of
 * DevTools, avoids browser CORS policy entirely, and gives you one place to add
 * logging, rate limiting or a different provider later.
 *
 * In production this would be a route in your own backend; the shape is the same.
 *
 * Configuration (environment):
 *   LLM_API_KEY    required
 *   LLM_BASE_URL   default https://api.deepseek.com/v1  (any OpenAI-compatible endpoint)
 *   LLM_MODEL      default deepseek-chat
 *   PORT           default 8787
 *
 * The wire format on the page side is chartwright's normalised shape
 * ({ messages, tools } → { content?, toolCalls? }), so chartwright itself does
 * not need to know which provider is behind it.
 */
import { createServer } from 'node:http';

export const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
export const DEFAULT_MODEL = 'deepseek-chat';

/** chartwright messages → OpenAI chat-completions messages. */
export function toProviderMessages(messages) {
  return messages.map((message) => {
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content ?? null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
        })),
      };
    }
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content ?? '' };
    }
    return { role: message.role, content: message.content ?? '' };
  });
}

/** chartwright tool definitions → OpenAI function definitions. */
export function toProviderTools(tools) {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

function parseArguments(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    return JSON.parse(raw);
  } catch {
    // A malformed argument payload becomes an empty object; the loop's own
    // validation then rejects the call and hands the error back to the model.
    return {};
  }
}

/** OpenAI chat-completions response → chartwright's normalised shape. */
export function fromProviderResponse(body) {
  const message = body?.choices?.[0]?.message ?? {};
  const toolCalls = (message.tool_calls ?? []).map((call) => ({
    id: call.id,
    name: call.function?.name,
    args: parseArguments(call.function?.arguments),
  }));
  return {
    ...(message.content ? { content: message.content } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

/**
 * Forwards one normalised request to the provider.
 *
 * Separated from the HTTP glue on purpose: this is the part worth testing, and
 * it takes its `fetch` as an argument so a test can stub the provider.
 */
export async function forwardToProvider(request, config) {
  const { apiKey, baseUrl = DEFAULT_BASE_URL, model = DEFAULT_MODEL, fetchImpl = fetch } = config;
  if (!apiKey) throw new Error('LLM_API_KEY is not set');

  const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0, // chart specs should not be a creative writing exercise
      messages: toProviderMessages(request.messages ?? []),
      ...(toProviderTools(request.tools) ? { tools: toProviderTools(request.tools) } : {}),
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`provider responded ${response.status}: ${text.slice(0, 300)}`);
  }
  return fromProviderResponse(await response.json());
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

export function createHandler(config) {
  const logger = config.logger ?? console;

  return async function handle(req, res) {
    if (req.method !== 'POST') {
      send(res, 405, { error: 'POST only' });
      return;
    }
    try {
      const request = await readBody(req);
      const result = await forwardToProvider(request, config);
      // Never log the key or the payload; status is enough to spot problems.
      logger.log?.(`llm: ok tools=${request.tools?.length ?? 0} calls=${result.toolCalls?.length ?? 0}`);
      send(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error?.(`llm: failed — ${message}`);
      send(res, 502, { error: message });
    }
  };
}

export function startServer(env = process.env) {
  const config = {
    apiKey: env.LLM_API_KEY,
    baseUrl: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
  };
  const server = createServer(createHandler(config));
  const port = Number(env.PORT ?? 8787);
  server.listen(port, () => {
    const where = config.baseUrl ?? DEFAULT_BASE_URL;
    console.log(`llm proxy listening on http://localhost:${port}  →  ${where} (${config.model ?? DEFAULT_MODEL})`);
    if (!config.apiKey) console.warn('warning: LLM_API_KEY is not set; requests will fail with 502');
  });
  return server;
}

// Only start when run directly (`node server/proxy.mjs`), not when imported by a test.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  startServer();
}
