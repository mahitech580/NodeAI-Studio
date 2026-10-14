'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, MAX_PROMPT_LENGTH } = require('../server');

async function makeServer(t, options = {}) {
  const app = createApp({
    aiClient: null,
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
  });
  return 'http://127.0.0.1:' + server.address().port;
}

function jsonPost(url, body, extraHeaders = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...extraHeaders },
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

test('non-streaming demo responses are labelled but not persisted on the shared server', async (t) => {
  const base = await makeServer(t);
  const response = await jsonPost(base + '/api/ai', { mode: 'code', tone: 'concise', prompt: 'Build a health endpoint' });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.success, true);
  assert.equal(result.demoMode, true);
  assert.match(result.answer, /Demo mode is active/i);
  const history = await (await fetch(base + '/api/history')).json();
  assert.equal(history.total, 0);
  assert.deepEqual(history.history, []);
  assert.equal(history.storage, 'browser-only');
  assert.equal(JSON.stringify(history).includes('Build a health endpoint'), false);
});

test('stream endpoint emits metadata, token deltas, and completion without server-side history', async (t) => {
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
  assert.equal((await (await fetch(base + '/api/history')).json()).total, 0);
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
  assert.match(body, /event: delta/);
  assert.match(body, /Contextual /);
  assert.match(body, /answer\./);
  assert.match(body, /event: done/);
  const savedHistory = await (await fetch(base + '/api/history')).json();
  assert.deepEqual(savedHistory.history, []);
  assert.equal(JSON.stringify(savedHistory).includes('Contextual answer.'), false);
  assert.equal(captured[0].stream, true);
  assert.equal(captured[0].temperature, 0.35);
  assert.deepEqual(captured[0].messages.slice(1), [...context, { role: 'user', content: 'Add a health endpoint' }]);
});

test('history compatibility endpoint never exposes prompt data and validates mode', async (t) => {
  const base = await makeServer(t);
  await jsonPost(base + '/api/ai', { mode: 'chat', prompt: 'Sensitive prompt marker' });
  const response = await fetch(base + '/api/history?q=Sensitive&mode=chat&limit=1');
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.total, 0);
  assert.deepEqual(result.history, []);
  assert.equal(result.storage, 'browser-only');
  assert.equal(JSON.stringify(result).includes('Sensitive prompt marker'), false);
  assert.equal((await fetch(base + '/api/history?mode=invalid')).status, 400);
  const cleared = await fetch(base + '/api/history', { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  assert.match((await cleared.json()).message, /no server-side conversation history/i);
});

test('configured GitHub Pages and Render origins can call the API', async (t) => {
  const origins = [
    'https://mahitech580.github.io',
    'https://nodeai-studio-api-mahitech580.onrender.com'
  ];
  const base = await makeServer(t, { allowedOrigins: origins });
  for (const origin of origins) {
    const health = await fetch(base + '/api/health', { headers: { Origin: origin } });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('access-control-allow-origin'), origin);
    const response = await fetch(base + '/api/ai/stream', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ mode: 'chat', prompt: 'CORS smoke test' })
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.match(await response.text(), /event: done/);
  }
});

test('disallowed CORS origin is rejected explicitly', async (t) => {
  const base = await makeServer(t, { allowedOrigins: ['https://mahitech580.github.io'] });
  const response = await fetch(base + '/api/health', {
    headers: { Origin: 'https://untrusted.example' }
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('each workflow has its own frontend controls and payload builder', async (t) => {
  const base = await makeServer(t);
  const html = await (await fetch(base + '/')).text();
  for (const selector of [
    'id="modeSettings"', 'data-settings="chat"', 'data-settings="code"',
    'data-settings="debug"', 'data-settings="sql"', 'id="codeLanguage"',
    'id="debugObserved"', 'id="sqlSchema"', 'id="responseTitle"'
  ]) {
    assert.ok(html.includes(selector), selector);
  }
  const script = await (await fetch(base + '/script.js')).text();
  for (const setting of [
    'function buildWorkflowPrompt', 'Implementation settings:', 'Debugging context:',
    'SQL settings:', 'elements.modeSettingsCards', 'document.body.dataset.mode = mode'
  ]) {
    assert.ok(script.includes(setting), setting);
  }
  const style = await (await fetch(base + '/style.css')).text();
  for (const mode of ['chat', 'code', 'debug', 'sql']) {
    assert.ok(style.includes('body[data-mode="' + mode + '"]'), mode + ' theme');
  }
});

test('static workspace contains advanced controls and serves source assets', async (t) => {
  const base = await makeServer(t);
  const response = await fetch(base + '/');
  const html = await response.text();
  assert.equal(response.status, 200);
  for (const selector of ['id="toneSelect"', 'id="stopGeneration"', 'id="commandDialog"', 'id="savedPrompts"', 'History stays in this browser']) {
    assert.ok(html.includes(selector), selector);
  }
  for (const asset of ['/script.js', '/style.css', '/config.js']) {
    assert.equal((await fetch(base + asset)).status, 200, asset);
  }
  const script = await (await fetch(base + '/script.js')).text();
  assert.match(script, /nodeai-session-history/);
  assert.match(script, /recordLocalHistory/);
  assert.doesNotMatch(script, /fetch\(apiUrl\('\/api\/history/);
});

test('rate limiting returns retry guidance after the request budget is reached', async (t) => {
  const base = await makeServer(t, { rateLimitMax: 1 });
  assert.equal((await jsonPost(base + '/api/ai', { mode: 'chat', prompt: 'first' })).status, 200);
  const limited = await jsonPost(base + '/api/ai', { mode: 'chat', prompt: 'second' });
  assert.equal(limited.status, 429);
  assert.match(limited.headers.get('retry-after') || '', /^\d+$/);
  assert.match((await limited.json()).error, /too many requests/i);
});


test('readiness reports service readiness without persistent session storage', async (t) => {
  const base = await makeServer(t);
  const response = await fetch(base + '/api/ready');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.status, 'ready');
  assert.equal(body.dependencies.sessionHistory, 'browser-only');
  assert.match(response.headers.get('x-request-id') || '', /^[0-9a-f-]{36}$/i);
});

test('malformed JSON returns a structured 400 response with request correlation', async (t) => {
  const base = await makeServer(t);
  const response = await fetch(base + '/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"mode":"chat","prompt":'
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.match(body.error, /valid JSON/i);
  assert.equal(body.requestId, response.headers.get('x-request-id'));
});

test('unknown API routes return structured JSON errors', async (t) => {
  const base = await makeServer(t);
  const response = await fetch(base + '/api/not-a-route');
  assert.equal(response.status, 404);
  assert.equal((await response.json()).success, false);
});
