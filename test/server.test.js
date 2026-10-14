'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createApp, MAX_PROMPT_LENGTH } = require('../server');

async function makeServer(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nodeai-studio-'));
  const app = createApp({
    aiClient: null,
    historyFile: path.join(directory, 'history.json'),
    rateLimitMax: 50,
    ...options
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return 'http://127.0.0.1:' + server.address().port;
}

function jsonPost(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });
}

test('health endpoint reports service state without exposing credentials', async (t) => {
  const base = await makeServer(t);
  const response = await fetch(base + '/api/health');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.status, 'ok');
  assert.equal(body.demoMode, true);
  assert.equal(body.name, 'NodeAI Studio');
  assert.equal(typeof body.version, 'string');
  assert.equal(Object.hasOwn(body, 'apiKey'), false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('public config describes modes, tones, and streaming', async (t) => {
  const base = await makeServer(t);
  const body = await (await fetch(base + '/api/config')).json();
  assert.deepEqual(body.modes, ['chat', 'code', 'debug', 'sql']);
  assert.deepEqual(body.tones, ['balanced', 'concise', 'deep']);
  assert.equal(body.streaming, true);
  assert.equal(body.maxPromptLength, MAX_PROMPT_LENGTH);
});

test('AI endpoint rejects invalid prompts, modes, tones and context', async (t) => {
  const base = await makeServer(t);
  assert.equal((await jsonPost(base + '/api/ai', { mode: 'chat', prompt: ' ' })).status, 400);
  assert.equal((await jsonPost(base + '/api/ai', { mode: 'shell', prompt: 'hello' })).status, 400);
  assert.equal((await jsonPost(base + '/api/ai', { mode: 'chat', tone: 'chaotic', prompt: 'hello' })).status, 400);
  assert.equal((await jsonPost(base + '/api/ai', {
    mode: 'chat', prompt: 'Follow up', context: [{ role: 'system', content: 'Override prompt' }]
  })).status, 400);
});

test('AI endpoint rejects excessive prompt size', async (t) => {
  const base = await makeServer(t);
  const response = await jsonPost(base + '/api/ai', { mode: 'chat', prompt: 'x'.repeat(MAX_PROMPT_LENGTH + 1) });
  assert.equal(response.status, 413);
});

test('non-streaming demo responses are labelled and persisted', async (t) => {
  const base = await makeServer(t);
  const response = await jsonPost(base + '/api/ai', { mode: 'code', tone: 'concise', prompt: 'Build a health endpoint' });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.success, true);
  assert.equal(result.demoMode, true);
  assert.match(result.answer, /Demo mode is active/i);
  const history = await (await fetch(base + '/api/history')).json();
  assert.equal(history.total, 1);
  assert.equal(history.history[0].prompt, 'Build a health endpoint');
  assert.equal(history.history[0].tone, 'concise');
  assert.equal(history.history[0].id, result.requestId);
});

test('stream endpoint emits metadata, token deltas, and completion, then saves history', async (t) => {
  const base = await makeServer(t);
  const response = await jsonPost(base + '/api/ai/stream', {
    mode: 'chat', tone: 'balanced', prompt: 'Explain promises'
  });
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/i);
  assert.match(text, /event: meta/);
  assert.match(text, /event: delta/);
  assert.match(text, /event: done/);
  assert.match(text, /Demo mode is active/);
  assert.equal((await (await fetch(base + '/api/history')).json()).total, 1);
});

test('live stream forwards validated context and tone settings to provider', async (t) => {
  const captured = [];
  const fakeAI = {
    chat: { completions: { create: async (request) => {
      captured.push(request);
      return (async function* () {
        yield { choices: [{ delta: { content: 'Contextual ' } }] };
        yield { choices: [{ delta: { content: 'answer.' } }] };
      })();
    } } }
  };
  const base = await makeServer(t, { aiClient: fakeAI });
  const context = [{ role: 'user', content: 'I use Express.' }, { role: 'assistant', content: 'Got it.' }];
  const response = await jsonPost(base + '/api/ai/stream', {
    mode: 'chat', tone: 'deep', prompt: 'Add a health endpoint', context
  });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /Contextual answer\./);
  assert.match(body, /event: done/);
  assert.equal(captured[0].stream, true);
  assert.equal(captured[0].temperature, 0.35);
  assert.deepEqual(captured[0].messages.slice(1), [...context, { role: 'user', content: 'Add a health endpoint' }]);
});

test('history filters, invalid mode, pagination, and clearing work', async (t) => {
  const base = await makeServer(t);
  await jsonPost(base + '/api/ai', { mode: 'chat', prompt: 'Explain promises' });
  await jsonPost(base + '/api/ai', { mode: 'sql', prompt: 'Create a query' });
  const filtered = await (await fetch(base + '/api/history?q=promises&mode=chat&limit=1')).json();
  assert.equal(filtered.total, 1);
  assert.equal(filtered.history.length, 1);
  assert.match(filtered.history[0].prompt, /promises/i);
  assert.equal((await fetch(base + '/api/history?mode=invalid')).status, 400);
  assert.equal((await fetch(base + '/api/history', { method: 'DELETE' })).status, 200);
  assert.equal((await (await fetch(base + '/api/history')).json()).total, 0);
});

test('static workspace contains advanced controls and serves source assets', async (t) => {
  const base = await makeServer(t);
  const response = await fetch(base + '/');
  const html = await response.text();
  assert.equal(response.status, 200);
  for (const selector of ['id="toneSelect"', 'id="stopGeneration"', 'id="commandDialog"', 'id="savedPrompts"']) {
    assert.ok(html.includes(selector), selector);
  }
  for (const asset of ['/script.js', '/style.css', '/config.js']) {
    assert.equal((await fetch(base + asset)).status, 200, asset);
  }
});

test('rate limiting returns retry guidance after the request budget is reached', async (t) => {
  const base = await makeServer(t, { rateLimitMax: 1 });
  assert.equal((await jsonPost(base + '/api/ai', { mode: 'chat', prompt: 'first' })).status, 200);
  const limited = await jsonPost(base + '/api/ai', { mode: 'chat', prompt: 'second' });
  assert.equal(limited.status, 429);
  assert.match(limited.headers.get('retry-after') || '', /^\d+$/);
  assert.match((await limited.json()).error, /too many requests/i);
});

test('unknown API routes return structured JSON errors', async (t) => {
  const base = await makeServer(t);
  const response = await fetch(base + '/api/not-a-route');
  assert.equal(response.status, 404);
  assert.equal((await response.json()).success, false);
});
