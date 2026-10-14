'use strict';

require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const OpenAI = require('openai');

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const MAX_PROMPT_LENGTH = 12000;
const VALID_MODES = new Set(['chat', 'code', 'debug', 'sql']);
const HISTORY_LIMIT = 50;
const DEFAULT_HISTORY_FILE = process.env.HISTORY_FILE || path.join(__dirname, 'storage', 'history.json');

function createAIClient() {
  if (!process.env.AI_API_KEY) return null;
  return new OpenAI({
    apiKey: process.env.AI_API_KEY,
    timeout: 30000,
    maxRetries: 1
  });
}

function getSystemPrompt(mode) {
  const prompts = {
    chat: 'You are NodeAI Studio, a practical senior software engineer. Be accurate, explain trade-offs, and use examples when useful.',
    code: 'You are a senior software engineer. Generate complete, maintainable code with sensible naming, validation, error handling, and a short explanation. State assumptions when requirements are unclear.',
    debug: 'You are an expert debugger. Explain the likely root cause, provide a corrected solution, and add a short prevention checklist. Do not claim to have executed code unless you actually did.',
    sql: 'You are an experienced SQL engineer. Provide a query and explain it. Never execute SQL or claim that a query was tested against a real database. Ask for the SQL dialect when it materially changes the answer.'
  };
  return prompts[mode] || prompts.chat;
}

function demoResponse(mode, prompt) {
  const examples = {
    chat: 'Demo mode is active. Your request reached NodeAI Studio, but no AI provider is configured. Add AI_API_KEY to your environment to enable live model responses.',
    code: 'Demo mode is active. Configure AI_API_KEY to generate a solution tailored to your request.\n\nExample starter:\n\nconst express = require("express");\nconst app = express();\napp.use(express.json());\n\napp.get("/api/health", (req, res) => {\n  res.json({ success: true });\n});\n\napp.listen(3000);',
    debug: 'Demo mode is active, so the request was not analyzed by a language model. Configure AI_API_KEY to receive a diagnosis.\n\nDebugging checklist:\n1. Read the complete error and stack trace.\n2. Reproduce the issue with the smallest input.\n3. Check types, async boundaries, and environment configuration.\n4. Add a regression test for the fix.',
    sql: 'Demo mode is active. Configure AI_API_KEY for a query tailored to your schema.\n\nExample query:\n\nSELECT customer_id, SUM(revenue) AS total_revenue\nFROM orders\nGROUP BY customer_id\nORDER BY total_revenue DESC\nLIMIT 10;'
  };
  return (examples[mode] || examples.chat) + '\n\nRequest received (' + prompt.length + ' characters).';
}

const MAX_CONTEXT_MESSAGES = 8;
const MAX_CONTEXT_CHARS = 16000;

function validateContext(context) {
  if (context === undefined) return { messages: [], error: null };
  if (!Array.isArray(context)) {
    return { messages: [], error: 'Context must be an array of previous chat messages.' };
  }
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
      for (const [ip, entry] of buckets) {
        if (time - entry.startedAt >= windowMs) buckets.delete(ip);
      }
    }

    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.startedAt + windowMs - time) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        error: 'Too many requests. Please wait a moment and try again.'
      });
    }
    return next();
  };
}

function createApp(options = {}) {
  const ai = Object.prototype.hasOwnProperty.call(options, 'aiClient')
    ? options.aiClient
    : createAIClient();
  const historyFile = options.historyFile || DEFAULT_HISTORY_FILE;
  const app = express();
  let historyQueue = Promise.resolve();

  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
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
  const allowedOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (allowedOrigins.length) {
    app.use(cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Origin is not allowed by CORS.'));
      },
      methods: ['GET', 'POST', 'DELETE'],
      allowedHeaders: ['Content-Type']
    }));
  }
  app.use(express.json({ limit: '256kb' }));
  app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

  async function readHistory() {
    try {
      const raw = await fs.readFile(historyFile, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.slice(0, HISTORY_LIMIT) : [];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async function writeHistory(entries) {
    const directory = path.dirname(historyFile);
    await fs.mkdir(directory, { recursive: true });
    const tempFile = historyFile + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp';
    try {
      await fs.writeFile(tempFile, JSON.stringify(entries.slice(0, HISTORY_LIMIT), null, 2) + '\n', {
        encoding: 'utf8',
        mode: 0o600
      });
      await fs.rename(tempFile, historyFile);
    } finally {
      await fs.rm(tempFile, { force: true }).catch(() => {});
    }
  }

  function serializeHistoryWrite(operation) {
    const next = historyQueue.then(operation, operation);
    historyQueue = next.catch(() => {});
    return next;
  }

  app.get('/api/health', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      name: 'NodeAI Studio',
      status: 'ok',
      demoMode: !ai,
      model: ai ? (process.env.AI_MODEL || 'gpt-4o-mini') : null,
      uptimeSeconds: Math.floor(process.uptime()),
      version: require('./package.json').version
    });
  });

  app.get('/api/config', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      maxPromptLength: MAX_PROMPT_LENGTH,
      modes: Array.from(VALID_MODES),
      historyLimit: HISTORY_LIMIT
    });
  });

  app.post('/api/ai', makeRateLimiter({
    windowMs: options.rateLimitWindowMs || 60000,
    max: options.rateLimitMax || 20
  }), async (req, res, next) => {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();

    try {
      const mode = typeof req.body?.mode === 'string' ? req.body.mode : 'chat';
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';

      if (!prompt) {
        return res.status(400).json({ success: false, error: 'Enter a prompt before generating a response.' });
      }
      if (prompt.length > MAX_PROMPT_LENGTH) {
        return res.status(413).json({
          success: false,
          error: 'Prompt is too long. Keep it under ' + MAX_PROMPT_LENGTH + ' characters.'
        });
      }
      if (!VALID_MODES.has(mode)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid mode. Choose chat, code, debug, or sql.'
        });
      }

      const contextResult = validateContext(mode === 'chat' ? req.body?.context : undefined);
      if (contextResult.error) {
        return res.status(400).json({ success: false, error: contextResult.error });
      }
      const context = contextResult.messages;

      let answer;
      if (!ai) {
        answer = demoResponse(mode, prompt);
      } else {
        const result = await ai.chat.completions.create({
          model: process.env.AI_MODEL || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: getSystemPrompt(mode) },
            ...context,
            { role: 'user', content: prompt }
          ],
          temperature: 0.2,
          max_tokens: 3000
        });
        answer = result.choices?.[0]?.message?.content;
        if (typeof answer !== 'string' || !answer.trim()) {
          throw new Error('The AI provider returned an empty response.');
        }
        answer = answer.trim();
      }

      const item = {
        id: requestId,
        mode,
        prompt,
        answer,
        demoMode: !ai,
        model: ai ? (process.env.AI_MODEL || 'gpt-4o-mini') : null,
        durationMs: Date.now() - startedAt,
        contextMessageCount: context.length,
        createdAt: new Date().toISOString()
      };

      await serializeHistoryWrite(async () => {
        const history = await readHistory();
        await writeHistory([item, ...history].slice(0, HISTORY_LIMIT));
      });

      return res.json({
        success: true,
        requestId,
        answer,
        demoMode: !ai,
        model: item.model,
        durationMs: item.durationMs,
        createdAt: item.createdAt
      });
    } catch (error) {
      if (error.status === 429 || error.status === 503) {
        return res.status(503).json({
          success: false,
          error: 'The AI provider is temporarily unavailable. Please try again shortly.',
          requestId
        });
      }
      if (error.name === 'APIConnectionTimeoutError' || error.name === 'APIConnectionError') {
        return res.status(504).json({
          success: false,
          error: 'The AI request timed out or could not connect. Please retry.',
          requestId
        });
      }
      console.error('[NodeAI] request ' + requestId + ' failed:', error.message);
      return next(error);
    }
  });

  app.get('/api/history', async (req, res, next) => {
    try {
      const requestedLimit = Number.parseInt(req.query.limit, 10);
      const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, HISTORY_LIMIT)
        : 20;
      const mode = typeof req.query.mode === 'string' ? req.query.mode : '';
      const query = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      let history = await readHistory();

      if (mode && VALID_MODES.has(mode)) {
        history = history.filter((item) => item.mode === mode);
      }
      if (query) {
        history = history.filter((item) =>
          String(item.prompt || '').toLowerCase().includes(query) ||
          String(item.answer || '').toLowerCase().includes(query)
        );
      }

      res.set('Cache-Control', 'no-store');
      return res.json({ success: true, history: history.slice(0, limit), total: history.length });
    } catch (error) {
      return next(error);
    }
  });

  app.delete('/api/history', async (req, res, next) => {
    try {
      await serializeHistoryWrite(() => writeHistory([]));
      return res.json({ success: true, message: 'History cleared.' });
    } catch (error) {
      return next(error);
    }
  });

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ success: false, error: 'API endpoint not found.' });
    }
    return res.status(404).type('text').send('Page not found.');
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ success: false, error: 'Request body is too large.' });
    }
    console.error('[NodeAI] server error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Something went wrong on the server. Please try again.'
    });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log('NodeAI Studio listening on http://localhost:' + PORT);
    console.log('AI mode: ' + (process.env.AI_API_KEY ? 'LIVE' : 'DEMO'));
  });
}

module.exports = {
  createApp,
  demoResponse,
  getSystemPrompt,
  makeRateLimiter,
  MAX_PROMPT_LENGTH,
  HISTORY_LIMIT,
  MAX_CONTEXT_MESSAGES,
  MAX_CONTEXT_CHARS,
  validateContext
};
