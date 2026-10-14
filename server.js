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

function createAIClient() {
  if (!process.env.AI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.AI_API_KEY, timeout: 30000, maxRetries: 1 });
}

function getSystemPrompt(mode, tone = 'balanced') {
  const prompts = {
    chat: 'You are NodeAI Studio, a practical senior software engineer. Be accurate, explain trade-offs, and use examples when useful.',
    code: 'You are a senior software engineer. Produce maintainable, idiomatic code with sensible naming, validation, error handling, and a concise explanation. State assumptions when requirements are unclear.',
    debug: 'You are an expert debugger. Identify likely root causes from evidence, show a corrected solution, and add regression-prevention steps. Never claim to have executed code unless it was actually executed.',
    sql: 'You are an experienced SQL engineer. Provide a query and explain it. Never execute SQL or claim that a query was tested against a real database. Ask for the SQL dialect when it changes correctness.'
  };
  const tones = {
    concise: 'Keep the response concise, prioritize the answer, and avoid unnecessary background.',
    balanced: 'Balance clarity and completeness. Use headings and examples where useful.',
    deep: 'Provide a thorough walkthrough, assumptions, trade-offs, edge cases, and practical verification steps.'
  };
  return (prompts[mode] || prompts.chat) + '\n\nResponse style: ' + (tones[tone] || tones.balanced);
}

function demoResponse(mode, prompt) {
  const examples = {
    chat: 'Demo mode is active. Your request reached NodeAI Studio, but no AI provider is configured. Add AI_API_KEY to the server environment to enable live model responses.',
    code: 'Demo mode is active. Configure AI_API_KEY for a solution tailored to your request.\n\nExample starter:\n\nconst express = require("express");\nconst app = express();\napp.use(express.json());\n\napp.get("/api/health", (req, res) => {\n  res.json({ success: true });\n});\n\napp.listen(3000);',
    debug: 'Demo mode is active, so a language model did not analyze your specific issue.\n\nDebugging checklist:\n1. Capture the complete error and stack trace.\n2. Reproduce the issue with the smallest input.\n3. Inspect types, asynchronous boundaries, and configuration.\n4. Add a regression test after the fix.',
    sql: 'Demo mode is active. Configure AI_API_KEY for a query based on your schema.\n\nExample query:\n\nSELECT customer_id, SUM(total_amount) AS total_revenue\nFROM orders\nGROUP BY customer_id\nORDER BY total_revenue DESC\nLIMIT 10;'
  };
  return (examples[mode] || examples.chat) + '\n\nRequest received (' + prompt.length + ' characters).';
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
  if (error?.status === 429 || error?.status === 503) return 503;
  return 500;
}

function publicProviderError(status) {
  if (status === 504) return 'The AI request timed out or could not connect. Please retry.';
  if (status === 503) return 'The AI provider is temporarily unavailable. Please try again shortly.';
  return 'Something went wrong while generating the response. Please try again.';
}

function createApp(options = {}) {
  const ai = Object.prototype.hasOwnProperty.call(options, 'aiClient') ? options.aiClient : createAIClient();
  const model = process.env.AI_MODEL || 'gpt-4o-mini';
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
      allowedHeaders: ['Content-Type', 'Accept', 'X-NodeAI-Session']
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
      streaming: true
    });
  });

  app.post('/api/ai', aiRateLimit, async (req, res, next) => {
    const startedAt = Date.now();
    const requestId = req.requestId || crypto.randomUUID();
    const validated = validateRequest(req.body);
    if (validated.error) {
      return res.status(validated.error.status).json({ success: false, error: validated.error.message, requestId });
    }
    const request = validated.request;
    try {
      let answer;
      if (!ai) {
        answer = demoResponse(request.mode, request.prompt);
      } else {
        const result = await ai.chat.completions.create({
          model,
          messages: buildMessages(request),
          temperature: request.tone === 'deep' ? 0.35 : 0.2,
          max_tokens: request.tone === 'concise' ? 1200 : 3000
        });
        answer = result.choices?.[0]?.message?.content;
        if (typeof answer !== 'string' || !answer.trim()) throw new Error('The AI provider returned an empty response.');
        answer = answer.trim();
      }

      const item = {
        id: requestId, mode: request.mode, tone: request.tone, prompt: request.prompt, answer,
        demoMode: !ai, model: ai ? model : null, durationMs: Date.now() - startedAt,
        contextMessageCount: request.context.length, createdAt: new Date().toISOString()
      };
      res.set('Cache-Control', 'no-store');
      return res.json({
        success: true, requestId, answer, demoMode: !ai, model: item.model,
        durationMs: item.durationMs, createdAt: item.createdAt
      });
    } catch (error) {
      if (error.type === 'entity.too.large') return next(error);
      const status = providerErrorStatus(error);
      console.error('[NodeAI] request ' + requestId + ' failed:', error.message);
      return res.status(status).json({ success: false, error: publicProviderError(status), requestId });
    }
  });

  app.post('/api/ai/stream', aiRateLimit, async (req, res, next) => {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    const validated = validateRequest(req.body);
    if (validated.error) {
      return res.status(validated.error.status).json({ success: false, error: validated.error.message, requestId });
    }
    const request = validated.request;
    const controller = new AbortController();
    let clientDisconnected = false;

    res.on('close', () => {
      if (!res.writableEnded) {
        clientDisconnected = true;
        controller.abort();
      }
    });

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
      event('meta', { requestId, demoMode: !ai, model: ai ? model : null });

      let answer = '';
      if (!ai) {
        const demo = demoResponse(request.mode, request.prompt);
        for (let offset = 0; offset < demo.length; offset += 72) {
          if (controller.signal.aborted) return;
          const chunk = demo.slice(offset, offset + 72);
          answer += chunk;
          event('delta', { text: chunk });
          await new Promise((resolve) => setImmediate(resolve));
        }
      } else {
        const stream = await ai.chat.completions.create({
          model,
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
      }

      if (clientDisconnected || controller.signal.aborted) return;
      if (!answer.trim()) {
        event('error', { requestId, error: 'The AI provider returned an empty response.' });
        return res.end();
      }

      const item = {
        id: requestId, mode: request.mode, tone: request.tone, prompt: request.prompt, answer,
        demoMode: !ai, model: ai ? model : null, durationMs: Date.now() - startedAt,
        contextMessageCount: request.context.length, createdAt: new Date().toISOString()
      };
      event('done', {
        requestId, demoMode: !ai, model: item.model, durationMs: item.durationMs, createdAt: item.createdAt
      });
      return res.end();
    } catch (error) {
      if (clientDisconnected || controller.signal.aborted || error.name === 'AbortError') return;
      if (res.headersSent) {
        event('error', { requestId, error: publicProviderError(providerErrorStatus(error)) });
        return res.end();
      }
      return next(error);
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
  createApp, demoResponse, getSystemPrompt, makeRateLimiter, validateContext, validateRequest, buildMessages,
  MAX_PROMPT_LENGTH, MAX_CONTEXT_MESSAGES, MAX_CONTEXT_CHARS, HISTORY_LIMIT
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
