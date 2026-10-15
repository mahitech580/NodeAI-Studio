'use strict';

require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const OpenAI = require('openai');

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const APP_VERSION = require('./package.json').version;
const MAX_PROMPT_LENGTH = 12000;
const MAX_CONTEXT_MESSAGES = 8;
const MAX_CONTEXT_CHARS = 16000;
const HISTORY_LIMIT = 50;
const VALID_MODES = new Set(['chat', 'code', 'debug', 'sql']);
const VALID_TONES = new Set(['balanced', 'concise', 'deep']);
const PROVIDERS = Object.freeze({
  openai: { label: 'OpenAI', defaultModel: 'gpt-4o-mini', baseURL: null },
  gemini: { label: 'Google Gemini', defaultModel: 'gemini-3.8-flash', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
  groq: { label: 'Groq', defaultModel: 'openai/gpt-oss-20b', baseURL: 'https://api.groq.com/openai/v1' },
  openrouter: { label: 'OpenRouter', defaultModel: 'openai/gpt-4o-mini', baseURL: 'https://openrouter.ai/api/v1' }
});
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

function createProviderClient(provider, apiKey, factory = OpenAI) {
  const settings = PROVIDERS[provider];
  if (!settings) throw new Error('Unsupported AI provider.');
  return new factory({ apiKey, ...(settings.baseURL ? { baseURL: settings.baseURL } : {}), timeout: 30000, maxRetries: 1 });
}

function createAIClient() {
  const apiKey = String(process.env.AI_API_KEY || '').trim();
  if (!apiKey) return null;
  const provider = process.env.AI_PROVIDER || 'openai';
  if (!PROVIDERS[provider]) throw new Error('AI_PROVIDER must be one of: ' + Object.keys(PROVIDERS).join(', '));
  return createProviderClient(provider, apiKey);
}

function readBrowserProviderConfig(req) {
  const apiKey = String(req.get('x-nodeai-api-key') || '').trim();
  if (!apiKey) return { config: null, error: null };
  if (apiKey.length < 8 || apiKey.length > 512) return { config: null, error: 'The provider API key must be between 8 and 512 characters.' };
  const provider = String(req.get('x-nodeai-provider') || 'gemini').trim().toLowerCase();
  const settings = PROVIDERS[provider];
  if (!settings) return { config: null, error: 'Unsupported provider. Choose OpenAI, Google Gemini, Groq, or OpenRouter.' };
  const model = String(req.get('x-nodeai-model') || settings.defaultModel).trim();
  if (!MODEL_ID_PATTERN.test(model)) return { config: null, error: 'Enter a valid model ID using letters, numbers, dots, underscores, colons, slashes, or hyphens.' };
  return { config: { provider, model, apiKey }, error: null };
}

function resolveRequestAI(req, serverAI, serverModel, serverProvider, providerClientFactory) {
  const supplied = readBrowserProviderConfig(req);
  if (supplied.error) return { error: supplied.error };
  if (supplied.config) {
    try {
      const { provider, model, apiKey } = supplied.config;
      return { client: providerClientFactory(provider, apiKey), model, provider, source: 'browser' };
    } catch {
      return { error: 'Could not initialize the selected provider. Check its settings and try again.' };
    }
  }
  if (serverAI) return { client: serverAI, model: serverModel, provider: serverProvider, source: 'server' };
  return { client: null, model: null, provider: null, source: 'none' };
}

function getSystemPrompt(mode, tone = 'balanced') {
  const prompts = {
    chat: 'You are NodeAI Studio, a practical senior software engineer. Answer the actual question first, explain trade-offs, use concrete examples, and state uncertainty when you cannot verify a claim. Keep the thread consistent with the supplied conversation context. Never claim to have browsed, run code, inspected files, or called an external tool unless that actually happened.',
    code: 'You are a senior software engineer. Produce maintainable, idiomatic, runnable code with sensible naming, input validation, error handling, and security-conscious defaults. For a complete-solution request, include every required file or clearly label the file boundaries; do not silently replace important logic with ellipses or TODO placeholders. Use fenced code blocks with accurate language labels. Explain assumptions, dependencies, how to run it, and tests or concrete verification steps. Never say code was executed unless execution actually occurred.',
    debug: 'You are an evidence-driven debugger. Start with the most likely root cause, separate confirmed evidence from hypotheses, then show a minimal corrected change and a regression test. Ask for missing logs or code when a diagnosis cannot be grounded. Consider edge cases, async behavior, versions, security, and performance where relevant. Never claim to have executed code or reproduced the bug unless that actually happened.',
    sql: 'You are an experienced SQL engineer. Write readable, dialect-specific SQL and explain joins, filters, aggregation, and assumptions. Ask for the schema or SQL dialect when it materially affects correctness. Flag destructive changes and suggest a transaction or preview query when appropriate. Never execute SQL, invent query results, or claim that a query was tested against a real database.'
  };
  const tones = {
    concise: 'Keep the response concise, prioritize the answer, and avoid unnecessary background.',
    balanced: 'Balance clarity and completeness. Use headings and examples where useful.',
    deep: 'Provide a thorough walkthrough, assumptions, trade-offs, edge cases, and practical verification steps.'
  };
  return (prompts[mode] || prompts.chat) + '\n\nResponse style: ' + (tones[tone] || tones.balanced);
}

function validateContext(context) {
  if (context === undefined) return { messages: [], error: null };
  if (!Array.isArray(context)) return { messages: [], error: 'Context must be an array of previous chat messages.' };
  if (context.length > MAX_CONTEXT_MESSAGES) {
    return { messages: [], error: 'Keep chat context to the most recent ' + MAX_CONTEXT_MESSAGES + ' messages.' };
  }
  let totalCharacters = 0;
  const messages = [];
  for (const item of context) {
    if (!item || !['user', 'assistant'].includes(item.role) ||
        typeof item.content !== 'string' || !item.content.trim()) {
      return { messages: [], error: 'Each context item must have a user or assistant role and non-empty text.' };
    }
    const content = item.content.trim();
    totalCharacters += content.length;
    if (content.length > MAX_PROMPT_LENGTH || totalCharacters > MAX_CONTEXT_CHARS) {
      return { messages: [], error: 'Chat context is too large. Start a new workspace or shorten earlier messages.' };
    }
    messages.push({ role: item.role, content });
  }
  return { messages, error: null };
}

function validateRequest(body) {
  const mode = typeof body?.mode === 'string' ? body.mode : 'chat';
  const tone = typeof body?.tone === 'string' ? body.tone : 'balanced';
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return { error: { status: 400, message: 'Enter a prompt before generating a response.' } };
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return { error: { status: 413, message: 'Prompt is too long. Keep it under ' + MAX_PROMPT_LENGTH + ' characters.' } };
  }
  if (!VALID_MODES.has(mode)) {
    return { error: { status: 400, message: 'Invalid mode. Choose chat, code, debug, or sql.' } };
  }
  if (!VALID_TONES.has(tone)) {
    return { error: { status: 400, message: 'Invalid response style. Choose balanced, concise, or deep.' } };
  }
  const contextResult = validateContext(mode === 'chat' ? body?.context : undefined);
  if (contextResult.error) return { error: { status: 400, message: contextResult.error } };
  return { request: { mode, tone, prompt, context: contextResult.messages } };
}

function buildMessages(request) {
  return [
    { role: 'system', content: getSystemPrompt(request.mode, request.tone) },
    ...request.context,
    { role: 'user', content: request.prompt }
  ];
}

function providerErrorStatus(error) {
  if (error?.name === 'APIConnectionTimeoutError' || error?.name === 'APIConnectionError') return 504;
  const status = Number(error?.status);
  if ([400, 401, 403, 404, 408, 409, 422, 429, 502, 503, 504].includes(status)) return status;
  return status >= 500 ? 502 : 500;
}

function publicProviderError(status) {
  if (status === 400 || status === 422) return 'The provider rejected this request. Check the model ID and selected provider settings.';
  if (status === 401 || status === 403) return 'The provider rejected this API key. Check that it belongs to the selected provider and is active.';
  if (status === 404) return 'The selected model was not found or is unavailable to this API key. Check the model ID.';
  if (status === 408 || status === 504) return 'The AI request timed out or could not connect. Please retry.';
  if (status === 429) return 'The provider rate limit or quota was reached. Wait a moment and check the provider usage or billing page.';
  if (status === 502) return 'The provider returned an unexpected response. Check the model ID and try again.';
  if (status === 503) return 'The AI provider is temporarily unavailable. Please try again shortly.';
  return 'Something went wrong while generating the response. Please try again.';
}

function missingProviderResponse(res, requestId) {
  return res.status(503).json({
    success: false,
    needsProvider: true,
    error: 'No live AI provider is connected. Select Connect AI in the top bar and test a provider API key to generate real responses.',
    requestId
  });
}

function createApp(options = {}) {
  const ai = Object.prototype.hasOwnProperty.call(options, 'aiClient') ? options.aiClient : createAIClient();
  const serverProvider = process.env.AI_PROVIDER || 'openai';
  const model = process.env.AI_MODEL || (PROVIDERS[serverProvider] || PROVIDERS.openai).defaultModel;
  const providerClientFactory = options.providerClientFactory || ((provider, apiKey) => createProviderClient(provider, apiKey));
  const heartbeatIntervalMs = Number.isFinite(options.heartbeatIntervalMs) && options.heartbeatIntervalMs > 0
    ? options.heartbeatIntervalMs : 15000;
  const app = express();

  const allowedOrigins = Array.isArray(options.allowedOrigins)
    ? options.allowedOrigins
    : (process.env.CORS_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean);

  app.disable('x-powered-by');
  // Render terminates TLS and forwards the original client address through one proxy hop.
  // Trusting exactly one hop makes req.ip usable for per-client rate limiting.
  app.set('trust proxy', process.env.TRUST_PROXY === 'false' ? false : 1);
  app.use((req, res, next) => {
    req.requestId = crypto.randomUUID();
    res.setHeader('X-Request-ID', req.requestId);
    next();
  });
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'", ...allowedOrigins],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com']
      }
    }
  }));

  if (allowedOrigins.length) {
    app.use(cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        const error = new Error('Origin is not allowed by CORS.');
        error.status = 403;
        return callback(error);
      },
      methods: ['GET', 'POST', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Accept', 'X-NodeAI-Session', 'X-NodeAI-Api-Key', 'X-NodeAI-Provider', 'X-NodeAI-Model']
    }));
  }

  app.use(express.json({ limit: '256kb' }));
  app.use(express.static(path.join(__dirname, 'public'), {
    index: 'index.html',
    etag: true,
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
  }));

  const aiRateLimit = makeRateLimiter({
    windowMs: options.rateLimitWindowMs || 60000,
    max: options.rateLimitMax || 20
  });

  app.get('/api/health', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      name: 'NodeAI Studio',
      status: 'ok',
      demoMode: !ai,
      model: ai ? model : null,
      provider: ai ? serverProvider : null,
      uptimeSeconds: Math.floor(process.uptime()),
      version: APP_VERSION,
      time: new Date().toISOString()
    });
  });

  // Readiness is lightweight and does not depend on shared session storage.
  app.get('/api/ready', (req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      status: 'ready',
      dependencies: { sessionHistory: 'browser-only' },
      requestId: req.requestId
    });
  });

  app.get('/api/config', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      maxPromptLength: MAX_PROMPT_LENGTH,
      maxContextMessages: MAX_CONTEXT_MESSAGES,
      modes: Array.from(VALID_MODES),
      tones: Array.from(VALID_TONES),
      historyLimit: HISTORY_LIMIT,
      streaming: true,
      providers: Object.entries(PROVIDERS).map(([id, value]) => ({ id, label: value.label, defaultModel: value.defaultModel })),
      credentialTransport: 'request-header-only'
    });
  });

  app.post('/api/providers/models', aiRateLimit, async (req, res) => {
    const requestId = req.requestId || crypto.randomUUID();
    const supplied = readBrowserProviderConfig(req);
    if (supplied.error) return res.status(400).json({ success: false, error: supplied.error, requestId });

    let client;
    let selectedProvider;
    let selectedModel;
    if (supplied.config) {
      ({ provider: selectedProvider, model: selectedModel } = supplied.config);
      try { client = providerClientFactory(selectedProvider, supplied.config.apiKey); }
      catch { return res.status(400).json({ success: false, error: 'Could not initialize the selected provider.', requestId }); }
    } else if (ai) {
      client = ai;
      selectedProvider = serverProvider;
      selectedModel = model;
    } else {
      return res.status(400).json({ success: false, error: 'Connect a provider key before loading available models.', requestId });
    }

    try {
      if (!client.models || typeof client.models.list !== 'function') {
        return res.status(501).json({
          success: false,
          error: 'This provider client does not support model discovery. Enter a model ID manually.',
          requestId
        });
      }
      const result = await client.models.list();
      const models = [...new Set((Array.isArray(result?.data) ? result.data : [])
        .map((item) => typeof item?.id === 'string' ? item.id.trim() : '')
        .filter((id) => MODEL_ID_PATTERN.test(id)))]
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 250);
      if (!models.length) {
        return res.status(502).json({
          success: false,
          error: 'The provider returned no compatible chat model IDs. You can still enter a model ID manually.',
          requestId
        });
      }
      res.set('Cache-Control', 'no-store');
      return res.json({
        success: true,
        provider: selectedProvider,
        currentModel: selectedModel,
        models,
        total: models.length,
        requestId
      });
    } catch (error) {
      const status = providerErrorStatus(error);
      console.error('[NodeAI] model list ' + requestId + ' failed: provider=' + selectedProvider + ' status=' + status);
      return res.status(status).json({ success: false, error: publicProviderError(status), requestId });
    }
  });

  app.post('/api/providers/test', aiRateLimit, async (req, res) => {
    const requestId = req.requestId || crypto.randomUUID();
    const supplied = readBrowserProviderConfig(req);
    if (supplied.error) return res.status(400).json({ success: false, error: supplied.error, requestId });

    let client;
    let selectedModel;
    let selectedProvider;
    if (supplied.config) {
      ({ model: selectedModel, provider: selectedProvider } = supplied.config);
      try { client = providerClientFactory(selectedProvider, supplied.config.apiKey); }
      catch { return res.status(400).json({ success: false, error: 'Could not initialize the selected provider.', requestId }); }
    } else if (ai) {
      client = ai;
      selectedModel = model;
      selectedProvider = serverProvider;
    } else {
      return res.status(400).json({ success: false, error: 'Enter a provider API key before testing the connection.', requestId });
    }

    const startedAt = Date.now();
    try {
      const result = await client.chat.completions.create({
        model: selectedModel,
        messages: [{ role: 'user', content: 'Reply with exactly NODEAI_READY.' }],
        temperature: 0,
        max_tokens: 8
      });
      const answer = result.choices?.[0]?.message?.content;
      if (typeof answer !== 'string' || !answer.trim()) {
        return res.status(502).json({ success: false, error: 'The provider connected but returned no text. Try a different supported model.', requestId });
      }
      res.set('Cache-Control', 'no-store');
      return res.json({ success: true, provider: selectedProvider, model: selectedModel, durationMs: Date.now() - startedAt, message: 'Live model connection verified.' });
    } catch (error) {
      const status = providerErrorStatus(error);
      console.error('[NodeAI] provider test ' + requestId + ' failed: provider=' + selectedProvider + ' status=' + status);
      return res.status(status).json({ success: false, error: publicProviderError(status), requestId });
    }
  });

  app.post('/api/ai', aiRateLimit, async (req, res, next) => {
    const startedAt = Date.now();
    const requestId = req.requestId || crypto.randomUUID();
    const validated = validateRequest(req.body);
    if (validated.error) {
      return res.status(validated.error.status).json({ success: false, error: validated.error.message, requestId });
    }
    const request = validated.request;
    const aiRequest = resolveRequestAI(req, ai, model, serverProvider, providerClientFactory);
    if (aiRequest.error) return res.status(400).json({ success: false, error: aiRequest.error, requestId });
    if (!aiRequest.client) return missingProviderResponse(res, requestId);
    try {
      const result = await aiRequest.client.chat.completions.create({
        model: aiRequest.model,
        messages: buildMessages(request),
        temperature: request.tone === 'deep' ? 0.35 : 0.2,
        max_tokens: request.tone === 'concise' ? 1200 : 3000
      });
      const answer = result.choices?.[0]?.message?.content;
      if (typeof answer !== 'string' || !answer.trim()) throw new Error('The AI provider returned an empty response.');
      const createdAt = new Date().toISOString();
      const durationMs = Date.now() - startedAt;
      res.set('Cache-Control', 'no-store');
      return res.json({ success: true, requestId, answer: answer.trim(), demoMode: false, provider: aiRequest.provider, model: aiRequest.model, durationMs, createdAt });
    } catch (error) {
      if (error.type === 'entity.too.large') return next(error);
      const status = providerErrorStatus(error);
      console.error('[NodeAI] request ' + requestId + ' failed: provider=' + aiRequest.provider + ' status=' + status);
      return res.status(status).json({ success: false, error: publicProviderError(status), requestId });
    }
  });

  app.post('/api/ai/stream', aiRateLimit, async (req, res, next) => {
    const startedAt = Date.now();
    const requestId = req.requestId || crypto.randomUUID();
    const validated = validateRequest(req.body);
    if (validated.error) {
      return res.status(validated.error.status).json({ success: false, error: validated.error.message, requestId });
    }
    const request = validated.request;
    const aiRequest = resolveRequestAI(req, ai, model, serverProvider, providerClientFactory);
    if (aiRequest.error) return res.status(400).json({ success: false, error: aiRequest.error, requestId });
    if (!aiRequest.client) return missingProviderResponse(res, requestId);
    const controller = new AbortController();
    let clientDisconnected = false;
    let heartbeatTimer = null;
    const clearHeartbeat = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    };

    res.on('close', () => {
      clearHeartbeat();
      if (!res.writableEnded) {
        clientDisconnected = true;
        controller.abort();
      }
    });
    res.on('finish', clearHeartbeat);

    function event(name, data) {
      if (res.writableEnded || clientDisconnected) return;
      res.write('event: ' + name + '\ndata: ' + JSON.stringify(data) + '\n\n');
    }

    try {
      res.status(200);
      res.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.flushHeaders?.();
      heartbeatTimer = setInterval(() => {
        if (res.writableEnded || clientDisconnected) {
          clearHeartbeat();
          return;
        }
        res.write(': nodeai-heartbeat\\n\\n');
      }, heartbeatIntervalMs);
      heartbeatTimer.unref?.();
      event('meta', { requestId, demoMode: false, provider: aiRequest.provider, model: aiRequest.model });

      let answer = '';
      const stream = await aiRequest.client.chat.completions.create({
        model: aiRequest.model,
        messages: buildMessages(request),
        temperature: request.tone === 'deep' ? 0.35 : 0.2,
        max_tokens: request.tone === 'concise' ? 1200 : 3000,
        stream: true
      }, { signal: controller.signal });

      for await (const chunk of stream) {
        if (controller.signal.aborted) return;
        const content = chunk.choices?.[0]?.delta?.content;
        if (typeof content === 'string' && content.length) {
          answer += content;
          event('delta', { text: content });
        }
      }
      answer = answer.trim();

      if (clientDisconnected || controller.signal.aborted) return;
      if (!answer.trim()) {
        event('error', { requestId, error: 'The AI provider returned an empty response.' });
        return res.end();
      }

      const item = {
        id: requestId, mode: request.mode, tone: request.tone, prompt: request.prompt, answer,
        demoMode: false, provider: aiRequest.provider, model: aiRequest.model,
        durationMs: Date.now() - startedAt, contextMessageCount: request.context.length, createdAt: new Date().toISOString()
      };
      event('done', {
        requestId, demoMode: false, provider: item.provider, model: item.model,
        durationMs: item.durationMs, createdAt: item.createdAt
      });
      return res.end();
    } catch (error) {
      if (clientDisconnected || controller.signal.aborted || error.name === 'AbortError') return;
      const status = providerErrorStatus(error);
      console.error('[NodeAI] stream ' + requestId + ' failed: provider=' + aiRequest.provider + ' status=' + status);
      if (res.headersSent) {
        event('error', { requestId, error: publicProviderError(status) });
        return res.end();
      }
      return res.status(status).json({ success: false, error: publicProviderError(status), requestId });
    }
  });

  // Compatibility endpoints return an empty list; prompt/response history is local to the browser.
  app.get('/api/history', (req, res) => {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, HISTORY_LIMIT)
      : 20;
    const mode = typeof req.query.mode === 'string' ? req.query.mode : '';
    if (mode && !VALID_MODES.has(mode)) {
      return res.status(400).json({ success: false, error: 'Invalid history mode.', requestId: req.requestId });
    }
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, history: [], total: 0, limit, storage: 'browser-only' });
  });

  app.delete('/api/history', (req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, message: 'No server-side conversation history is stored.' });
  });

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ success: false, error: 'API endpoint not found.' });
    return res.status(404).type('text').send('Page not found.');
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.too.large') {
      return res.status(413).json({
        success: false,
        error: 'Request body is too large.',
        requestId: req.requestId
      });
    }
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({
        success: false,
        error: 'Request body must contain valid JSON.',
        requestId: req.requestId
      });
    }
    if (error.message === 'Origin is not allowed by CORS.') {
      return res.status(403).json({
        success: false,
        error: 'This browser origin is not allowed.',
        requestId: req.requestId
      });
    }
    console.error('[NodeAI] server error ' + (req.requestId || '-') + ':', error.message);
    return res.status(500).json({ success: false, error: 'Something went wrong on the server. Please try again.', requestId: req.requestId });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log('NodeAI Studio v' + APP_VERSION + ' listening on http://localhost:' + PORT);
    console.log('AI mode: ' + (process.env.AI_API_KEY ? 'LIVE' : 'DEMO'));
  });
}

module.exports = {
  createApp, getSystemPrompt, makeRateLimiter, validateContext, validateRequest, buildMessages,
  createProviderClient, readBrowserProviderConfig, resolveRequestAI, providerErrorStatus, publicProviderError,
  PROVIDERS, MAX_PROMPT_LENGTH, MAX_CONTEXT_MESSAGES, MAX_CONTEXT_CHARS, HISTORY_LIMIT
};

function makeRateLimiter(options = {}) {
  const windowMs = options.windowMs || 60000;
  const max = options.max || 20;
  const now = options.now || Date.now;
  const buckets = new Map();
  return function rateLimit(req, res, next) {
    const key = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    const time = now();
    let bucket = buckets.get(key);
    if (!bucket || time - bucket.startedAt >= windowMs) {
      bucket = { startedAt: time, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (buckets.size > 5000) {
      for (const [ip, entry] of buckets) if (time - entry.startedAt >= windowMs) buckets.delete(ip);
    }
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.startedAt + windowMs - time) / 1000))));
      return res.status(429).json({ success: false, error: 'Too many requests. Please wait a moment and try again.' });
    }
    return next();
  };
}
