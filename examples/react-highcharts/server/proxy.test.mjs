/**
 * Tests for the proxy's provider translation.
 *
 * These run without a network and without credentials: the provider `fetch` is
 * stubbed, which is also the reason `forwardToProvider` takes it as an argument.
 *
 * Run: node --test server/proxy.test.mjs   (Node 22+)
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  forwardToProvider,
  fromProviderResponse,
  toProviderMessages,
  toProviderTools,
} from './proxy.mjs';

test('messages are translated into the provider dialect', () => {
  const translated = toProviderMessages([
    { role: 'system', content: 'rules' },
    { role: 'user', content: 'a question' },
    {
      role: 'assistant',
      content: 'calling a tool',
      toolCalls: [{ id: 'call_1', name: 'run_query', args: { steps: [{ op: 'limit', n: 5 }] } }],
    },
    { role: 'tool', toolCallId: 'call_1', name: 'run_query', content: '{"rowCount":5}' },
  ]);

  assert.deepEqual(translated[2], {
    role: 'assistant',
    content: 'calling a tool',
    tool_calls: [
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'run_query', arguments: JSON.stringify({ steps: [{ op: 'limit', n: 5 }] }) },
      },
    ],
  });
  assert.deepEqual(translated[3], { role: 'tool', tool_call_id: 'call_1', content: '{"rowCount":5}' });
});

test('tool definitions are translated and omitted when empty', () => {
  assert.equal(toProviderTools([]), undefined);
  assert.equal(toProviderTools(undefined), undefined);
  assert.deepEqual(
    toProviderTools([{ name: 't', description: 'd', parameters: { type: 'object' } }]),
    [{ type: 'function', function: { name: 't', description: 'd', parameters: { type: 'object' } } }],
  );
});

test('provider responses are normalised, malformed arguments included', () => {
  assert.deepEqual(fromProviderResponse({ choices: [{ message: { content: 'hello' } }] }), { content: 'hello' });

  assert.deepEqual(
    fromProviderResponse({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: 'a', function: { name: 'describe_table', arguments: '{}' } },
              { id: 'b', function: { name: 'run_query', arguments: '{oops' } },
            ],
          },
        },
      ],
    }),
    {
      toolCalls: [
        { id: 'a', name: 'describe_table', args: {} },
        { id: 'b', name: 'run_query', args: {} },
      ],
    },
  );
});

test('forwardToProvider injects the key, pins temperature and never sends it to the page', async () => {
  const seen = [];
  const result = await forwardToProvider(
    { messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 't', description: 'd', parameters: {} }] },
    {
      apiKey: 'sk-secret',
      baseUrl: 'https://example.test/v1/',
      model: 'some-model',
      fetchImpl: async (url, init) => {
        seen.push({ url, init });
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
        };
      },
    },
  );

  assert.equal(seen[0].url, 'https://example.test/v1/chat/completions', 'trailing slash handled');
  assert.equal(seen[0].init.headers.authorization, 'Bearer sk-secret');
  const payload = JSON.parse(seen[0].init.body);
  assert.equal(payload.model, 'some-model');
  assert.equal(payload.temperature, 0);
  assert.equal(payload.messages.length, 1);
  assert.equal(payload.tools.length, 1);
  assert.deepEqual(result, { content: 'ok' });
});

test('forwardToProvider refuses to run without a key', async () => {
  await assert.rejects(() => forwardToProvider({ messages: [] }, { apiKey: undefined }), /LLM_API_KEY is not set/);
});

test('a provider error surfaces with its status and body', async () => {
  await assert.rejects(
    () =>
      forwardToProvider(
        { messages: [] },
        {
          apiKey: 'k',
          fetchImpl: async () => ({ ok: false, status: 429, text: async () => 'rate limited' }),
        },
      ),
    /provider responded 429: rate limited/,
  );
});
