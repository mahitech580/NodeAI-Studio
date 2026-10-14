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

test('health endpoint reports demo mode without leaking credentials', async (t) => {
  const base = await makeServer(t);
  const response = await fetch(base + '/api/health');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.status, 'ok');
  assert.equal(body.demoMode, true);
  assert.equal(body.name, 'NodeAI Studio');
  assert.equal(Object.hasOwn(body, 'apiKey'), false);
});

test('configuration describes supported workflows and request limits', async (t) => {
  const base = await makeServer(t);
  const response = await fetch(base + '/api/config');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.modes, ['chat', 'code', 'debug', 'sql']);
  assert.equal(body.maxPromptLength, MAX_PROMPT_LENGTH);
});

test('AI endpoint validates a missing prompt', async (t) => {
  const base = await makeServer(t);
  const response = await fetch(base + '/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'chat', prompt: '   ' })
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error, /prompt/i);
});

test('AI endpoint rejects unknown modes and excessively long prompts', async (t) => {
  const base = await makeServer(t);
  const invalidMode = await fetch(base + '/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'shell', prompt: 'hello' })
  });
  assert.equal(invalidMode.status, 400);

  const tooLong = await fetch(base + '/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'chat', prompt: 'x'.repeat(MAX_PROMPT_LENGTH + 1) })
  });
  assert.equal(tooLong.status, 413);
});

test('demo generation is clearly labelled and saved to history', async (t) => {
  const base = await makeServer(t);
  const generated = await fetch(base + '/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'code', prompt: 'Make a small health endpoint' })
  });
  const result = await generated.json();

  assert.equal(generated.status, 200);
  assert.equal(result.success, true);
  assert.equal(result.demoMode, true);
  assert.match(result.answer, /Demo mode is active/i);

  const historyResponse = await fetch(base + '/api/history');
  const history = await historyResponse.json();
  assert.equal(historyResponse.status, 200);
  assert.equal(history.total, 1);
  assert.equal(history.history[0].prompt, 'Make a small health endpoint');
  assert.equal(history.history[0].id, result.requestId);
});

test('history supports search and can be cleared', async (t) => {
  const base = await makeServer(t);
  for (const prompt of ['Explain promises in JavaScript', 'Create a SQL query']) {
    const response = await fetch(base + '/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: prompt.startsWith('Create') ? 'sql' : 'chat', prompt })
    });
    assert.equal(response.status, 200);
  }

  const filteredResponse = await fetch(base + '/api/history?q=promises');
  const filtered = await filteredResponse.json();
  assert.equal(filtered.total, 1);
  assert.match(filtered.history[0].prompt, /promises/i);

  const clearResponse = await fetch(base + '/api/history', { method: 'DELETE' });
  assert.equal(clearResponse.status, 200);
  const afterClear = await (await fetch(base + '/api/history')).json();
  assert.equal(afterClear.total, 0);
});

test('unknown API routes return structured 404 responses', async (t) => {
  const base = await makeServer(t);
  const response = await fetch(base + '/api/not-a-route');
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
});
