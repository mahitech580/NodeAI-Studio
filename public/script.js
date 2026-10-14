'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const API_BASE_URL = String(window.NODEAI_CONFIG?.apiBaseUrl || '').trim().replace(/\/+$/, '');
const API_TIMEOUT_MS = 90000;
const RENDER_COLD_START_HINT_MS = 12000;
const MAX_ATTACHMENT_BYTES = 64 * 1024;
const HISTORY_STORAGE_KEY = 'nodeai-session-history';
const LOCAL_HISTORY_LIMIT = 50;
const ALLOWED_TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'mdx', 'js', 'jsx', 'ts', 'tsx', 'json', 'py', 'sql', 'html', 'css', 'yml', 'yaml', 'log'
]);

function apiUrl(path) {
  return API_BASE_URL ? API_BASE_URL + path : path;
}

const elements = {
  modeButtons: $$('.mode-button'), prompt: $('#prompt'), charCount: $('#charCount'),
  savePrompt: $('#savePrompt'), savedPromptCount: $('#savedPromptCount'), savedPrompts: $('#savedPrompts'),
  promptChips: $('#promptChips'), toneSelect: $('#toneSelect'), generate: $('#generate'),
  stopGeneration: $('#stopGeneration'), contextIndicator: $('#contextIndicator'), generateLabel: $('#generateLabel'),
  clearPrompt: $('#clearPrompt'), promptFile: $('#promptFile'), newSession: $('#newSession'),
  emptyResponse: $('#emptyResponse'), responseResult: $('#responseResult'), answerText: $('#answerText'),
  resultType: $('#resultType'), resultTime: $('#resultTime'), resultModel: $('#resultModel'),
  responseFootnote: $('#responseFootnote'), copyAnswer: $('#copyAnswer'), copyAnswerBottom: $('#copyAnswerBottom'),
  exportAnswer: $('#exportAnswer'), status: $('#status'), statusText: $('#statusText'),
  themeToggle: $('#themeToggle'), themeIcon: $('#themeIcon'), history: $('#history'),
  historyCount: $('#historyCount'), historySearch: $('#historySearch'), clearHistory: $('#clearHistory'),
  sessionMetric: $('#sessionMetric'), latencyMetric: $('#latencyMetric'), latencyCaption: $('#latencyCaption'),
  modeBadge: $('#modeBadge'), breadcrumbMode: $('#breadcrumbMode'), toast: $('#toast'),
  commandDialog: $('#commandDialog'), closeCommand: $('#closeCommand'), commandSearch: $('#commandSearch'),
  commandItems: $('#commandItems')
};

const MODE_CONFIG = {
  chat: { title: 'AI Chat', badge: 'CHAT', placeholder: 'What are you working on today?',
    chips: [['Explain the event loop', 'Explain the JavaScript event loop with a practical example.'], ['Review a function', 'Review this function for readability, edge cases, and performance:']] },
  code: { title: 'Code Generator', badge: 'CODE', placeholder: 'Describe the feature, language, inputs, and expected output…',
    chips: [['Create a REST endpoint', 'Build an Express REST endpoint with validation and consistent JSON errors.'], ['Refactor this code', 'Refactor the following code for readability, testability, and maintainability:']] },
  debug: { title: 'AI Debugger', badge: 'DEBUG', placeholder: 'Paste relevant code, the exact error, and expected behavior…',
    chips: [['Analyze a stack trace', 'Explain the likely root cause of this error and show a minimal fix:'], ['Find edge cases', 'Review this code for edge cases, async bugs, and incorrect assumptions:']] },
  sql: { title: 'SQL Assistant', badge: 'SQL', placeholder: 'Describe your tables, columns, SQL dialect, and desired result…',
    chips: [['Aggregate by customer', 'Find the top 10 customers by total revenue. Tables: customers(id, name), orders(customer_id, total_amount).'], ['Explain a query', 'Explain this SQL query, its joins, aggregation, and performance considerations:']] }
};

let currentMode = 'chat';
let currentAnswer = '';
let currentResult = null;
let historyCache = readLocalHistory();
let conversationTurns = [];
let requestController = null;
let busy = false;
let toastTimer = null;
let savedPrompts = readSavedPrompts();
let serverConfig = { maxPromptLength: 12000, maxContextMessages: 8 };

function safelyReadStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function safelyWriteStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    showToast('Browser storage is unavailable; this change may not persist.', 'warning');
  }
}

function readLocalHistory() {
  try {
    const parsed = JSON.parse(safelyReadStorage(HISTORY_STORAGE_KEY, '[]'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) =>
      item &&
      typeof item.id === 'string' &&
      Object.hasOwn(MODE_CONFIG, item.mode) &&
      typeof item.prompt === 'string' &&
      typeof item.answer === 'string'
    ).slice(0, LOCAL_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function recordLocalHistory(item) {
  const fallbackId = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8);
  const safeItem = {
    id: String(item.id || (window.crypto?.randomUUID?.() || fallbackId)),
    mode: Object.hasOwn(MODE_CONFIG, item.mode) ? item.mode : 'chat',
    tone: ['balanced', 'concise', 'deep'].includes(item.tone) ? item.tone : 'balanced',
    prompt: String(item.prompt || ''),
    answer: String(item.answer || ''),
    demoMode: Boolean(item.demoMode),
    model: item.model || null,
    durationMs: Number.isFinite(Number(item.durationMs)) ? Number(item.durationMs) : null,
    createdAt: item.createdAt || new Date().toISOString()
  };
  historyCache = [safeItem, ...historyCache.filter((entry) => entry.id !== safeItem.id)].slice(0, LOCAL_HISTORY_LIMIT);
  safelyWriteStorage(HISTORY_STORAGE_KEY, JSON.stringify(historyCache));
  updateSessionMetrics();
  renderHistory();
}

function readSavedPrompts() {
  try {
    const parsed = JSON.parse(safelyReadStorage('nodeai-saved-prompts', '[]'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) =>
      item && typeof item.prompt === 'string' && Object.hasOwn(MODE_CONFIG, item.mode) && typeof item.id === 'string'
    ).slice(0, 100);
  } catch {
    return [];
  }
}

function setTheme(theme) {
  const nextTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = nextTheme;
  const isDark = nextTheme === 'dark';
  elements.themeIcon.textContent = isDark ? '☼' : '☾';
  elements.themeToggle.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
  elements.themeToggle.setAttribute('aria-pressed', String(!isDark));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#090a11' : '#f5f5fb');
  safelyWriteStorage('nodeai-theme', nextTheme);
}

function showToast(message, kind = 'success') {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = 'toast visible ' + kind;
  toastTimer = setTimeout(() => { elements.toast.className = 'toast'; }, 2800);
}

function setServerStatus(kind, message) {
  elements.status.className = 'server-status ' + kind;
  elements.statusText.textContent = message;
}

function updatePromptCount() {
  const length = elements.prompt.value.length;
  const max = serverConfig.maxPromptLength || 12000;
  elements.charCount.textContent = length.toLocaleString() + ' / ' + max.toLocaleString();
  elements.charCount.classList.toggle('near-limit', length > max * 0.88);
}

function makeChip(label, prompt, mode) {
  const button = document.createElement('button');
  button.className = 'prompt-chip';
  button.type = 'button';
  button.dataset.mode = mode;
  button.dataset.prompt = prompt;
  button.append(document.createTextNode(label + ' '));
  const arrow = document.createElement('span');
  arrow.textContent = '↗';
  button.append(arrow);
  return button;
}

function updateMode(mode) {
  if (!Object.hasOwn(MODE_CONFIG, mode)) mode = 'chat';
  currentMode = mode;
  const config = MODE_CONFIG[mode];
  elements.modeButtons.forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  elements.breadcrumbMode.textContent = config.title;
  elements.modeBadge.replaceChildren();
  const dot = document.createElement('span');
  dot.className = 'badge-dot';
  elements.modeBadge.append(dot, document.createTextNode(' ' + config.badge));
  elements.prompt.placeholder = config.placeholder;
  elements.promptChips.replaceChildren(...config.chips.map((item) => makeChip(item[0], item[1], mode)));
  document.title = config.title + ' — NodeAI Studio';
  updateContextIndicator();
  updatePromptCount();
}

function showEmptyResponse() {
  currentAnswer = '';
  currentResult = null;
  elements.emptyResponse.hidden = false;
  elements.responseResult.hidden = true;
  elements.answerText.textContent = '';
  elements.answerText.classList.remove('streaming-text');
  elements.copyAnswer.disabled = true;
  elements.copyAnswerBottom.disabled = true;
  elements.exportAnswer.disabled = true;
  elements.responseFootnote.textContent = 'Waiting for your first prompt';
  elements.resultType.className = 'result-type';
  elements.resultType.replaceChildren();
  const dot = document.createElement('span');
  dot.className = 'result-type-dot';
  elements.resultType.append(dot, document.createTextNode(' READY'));
  elements.resultTime.textContent = '';
  elements.resultModel.textContent = 'Response ready';
}

function showResponse(answer, metadata = {}) {
  currentAnswer = String(answer || '');
  currentResult = metadata;
  elements.emptyResponse.hidden = true;
  elements.responseResult.hidden = false;
  elements.answerText.textContent = currentAnswer;
  elements.resultType.className = 'result-type ' + (metadata.demoMode ? 'demo-result' : 'live-result');
  elements.resultType.replaceChildren();
  const dot = document.createElement('span');
  dot.className = 'result-type-dot';
  elements.resultType.append(dot, document.createTextNode(metadata.demoMode ? ' DEMO RESPONSE' : ' MODEL RESPONSE'));
  elements.resultTime.textContent = formatDuration(metadata.durationMs);
  elements.resultModel.textContent = metadata.model || (metadata.demoMode ? 'Demo mode · no live model used' : 'Response generated');
  elements.responseFootnote.textContent = metadata.demoMode
    ? 'Demo output · configure an API key for live model responses'
    : 'Response received · review before using in production';
  elements.copyAnswer.disabled = !currentAnswer;
  elements.copyAnswerBottom.disabled = !currentAnswer;
  elements.exportAnswer.disabled = !currentAnswer;
  updateContextIndicator();
}

function trimConversation() {
  const maxMessages = serverConfig.maxContextMessages || 8;
  const maxCharacters = 14000;
  conversationTurns = conversationTurns.slice(-maxMessages);
  let characters = conversationTurns.reduce((sum, turn) => sum + turn.content.length, 0);
  while (conversationTurns.length && characters > maxCharacters) {
    characters -= conversationTurns[0].content.length;
    conversationTurns.shift();
  }
}

function addConversationTurn(role, content) {
  conversationTurns.push({ role, content: String(content || '') });
  trimConversation();
  updateContextIndicator();
}

function updateContextIndicator() {
  const active = currentMode === 'chat' && conversationTurns.length > 0;
  elements.contextIndicator.hidden = !active;
  elements.contextIndicator.textContent = active ? 'CONTEXT · ' + conversationTurns.length : '';
  elements.contextIndicator.title = active
    ? 'The most recent ' + conversationTurns.length + ' messages are included in your next chat request.'
    : '';
}

function formatDuration(duration) {
  if (!Number.isFinite(Number(duration))) return '';
  const ms = Math.max(0, Number(duration));
  return ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + ' s';
}

function updateSessionMetrics() {
  elements.historyCount.textContent = String(historyCache.length);
  elements.sessionMetric.textContent = String(historyCache.length).padStart(2, '0');
}

function persistSavedPrompts() {
  safelyWriteStorage('nodeai-saved-prompts', JSON.stringify(savedPrompts));
}

function renderSavedPrompts() {
  elements.savedPromptCount.textContent = String(savedPrompts.length);
  elements.savedPrompts.replaceChildren();
  if (!savedPrompts.length) {
    const empty = document.createElement('div');
    empty.className = 'saved-prompts-empty';
    empty.textContent = 'Save a useful prompt to reuse it later.';
    elements.savedPrompts.append(empty);
    return;
  }
  savedPrompts.slice(0, 30).forEach((item) => {
    const row = document.createElement('div');
    row.className = 'saved-prompt-row';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'saved-prompt-open';
    open.title = item.prompt;
    const mode = document.createElement('span');
    mode.className = 'saved-prompt-mode mode-' + item.mode;
    mode.textContent = item.mode.toUpperCase();
    const prompt = document.createElement('span');
    prompt.className = 'saved-prompt-text';
    prompt.textContent = item.prompt.replace(/\s+/g, ' ');
    open.append(mode, prompt);
    open.addEventListener('click', () => {
      updateMode(item.mode);
      conversationTurns = [];
      updateContextIndicator();
      elements.prompt.value = item.prompt;
      updatePromptCount();
      showEmptyResponse();
      elements.prompt.focus();
      showToast('Saved prompt loaded');
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'saved-prompt-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'Remove saved prompt');
    remove.title = 'Remove saved prompt';
    remove.addEventListener('click', () => {
      savedPrompts = savedPrompts.filter((saved) => saved.id !== item.id);
      persistSavedPrompts();
      renderSavedPrompts();
      showToast('Saved prompt removed');
    });
    row.append(open, remove);
    elements.savedPrompts.append(row);
  });
}

function saveCurrentPrompt() {
  const prompt = elements.prompt.value.trim();
  if (!prompt) {
    showToast('Write a prompt before saving it', 'warning');
    elements.prompt.focus();
    return;
  }
  if (savedPrompts.some((item) => item.mode === currentMode && item.prompt === prompt)) {
    showToast('This prompt is already saved', 'warning');
    return;
  }
  savedPrompts.unshift({
    id: (window.crypto && typeof window.crypto.randomUUID === 'function')
      ? window.crypto.randomUUID()
      : String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8),
    mode: currentMode,
    prompt,
    savedAt: new Date().toISOString()
  });
  savedPrompts = savedPrompts.slice(0, 100);
  persistSavedPrompts();
  renderSavedPrompts();
  $('.saved-prompt-section').open = true;
  showToast('Prompt saved in this browser');
}

function renderHistory() {
  const query = elements.historySearch.value.trim().toLowerCase();
  const filtered = historyCache.filter((item) => {
    const value = String(item.prompt || '') + ' ' + String(item.answer || '');
    return !query || value.toLowerCase().includes(query) || String(item.mode || '').includes(query);
  });
  elements.history.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    const mark = document.createElement('span');
    mark.className = 'history-empty-mark';
    mark.textContent = query ? '⌕' : '◌';
    const label = document.createElement('span');
    label.textContent = query ? 'No sessions match that search.' : 'Your sessions will appear here.';
    empty.append(mark, label);
    elements.history.append(empty);
    return;
  }
  filtered.slice(0, 18).forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-item';
    button.title = String(item.prompt || 'Untitled session');
    const top = document.createElement('span');
    top.className = 'history-item-top';
    const mode = document.createElement('span');
    mode.className = 'history-mode mode-' + (MODE_CONFIG[item.mode] ? item.mode : 'chat');
    mode.textContent = (item.mode || 'chat').toUpperCase();
    const date = document.createElement('time');
    date.textContent = formatDate(item.createdAt);
    top.append(mode, date);
    const prompt = document.createElement('span');
    prompt.className = 'history-prompt';
    prompt.textContent = String(item.prompt || 'Untitled session').replace(/\s+/g, ' ');
    const preview = document.createElement('span');
    preview.className = 'history-preview';
    preview.textContent = String(item.answer || '').replace(/\s+/g, ' ').slice(0, 76);
    button.append(top, prompt, preview);
    button.addEventListener('click', () => restoreSession(item));
    elements.history.append(button);
  });
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function restoreSession(item) {
  updateMode(item.mode || 'chat');
  conversationTurns = [];
  if ((item.mode || 'chat') === 'chat') {
    addConversationTurn('user', item.prompt || '');
    addConversationTurn('assistant', item.answer || '');
  }
  elements.prompt.value = item.prompt || '';
  elements.toneSelect.value = ['balanced', 'concise', 'deep'].includes(item.tone) ? item.tone : 'balanced';
  updatePromptCount();
  showResponse(item.answer || '', {
    demoMode: Boolean(item.demoMode), model: item.model, durationMs: item.durationMs, createdAt: item.createdAt
  });
  elements.latencyMetric.textContent = formatDuration(item.durationMs) || '—';
  elements.latencyCaption.textContent = 'Selected from history';
  showToast('Session restored');
}

function loadHistory() {
  // Session content is saved locally and never fetched from the shared backend.
  historyCache = readLocalHistory();
  updateSessionMetrics();
  renderHistory();
}

async function checkServer() {
  try {
    const response = await fetch(apiUrl('/api/health'), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Server unavailable');
    const data = await response.json();
    if (!data.success) throw new Error('Server unavailable');
    setServerStatus(data.demoMode ? 'demo' : 'online', data.demoMode ? 'Demo mode' : 'AI connected');
    elements.status.title = data.demoMode
      ? 'Backend is healthy. No AI_API_KEY is configured, so responses are examples.'
      : 'AI provider configured. Model: ' + (data.model || 'configured model');
  } catch {
    setServerStatus('offline', 'Server offline');
    elements.status.title = 'Could not reach the NodeAI Studio API.';
  }
}

async function fetchConfig() {
  try {
    const response = await fetch(apiUrl('/api/config'), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return;
    const config = await response.json();
    if (!config.success) return;
    if (Number.isFinite(config.maxPromptLength)) {
      serverConfig.maxPromptLength = config.maxPromptLength;
      elements.prompt.maxLength = String(config.maxPromptLength);
    }
    if (Number.isFinite(config.maxContextMessages)) serverConfig.maxContextMessages = config.maxContextMessages;
    updatePromptCount();
  } catch { /* status pill reports connectivity separately */ }
}

function parseSseBlock(block) {
  let eventName = 'message';
  const dataLines = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;
  try { return { event: eventName, data: JSON.parse(dataLines.join('\n')) }; }
  catch { return null; }
}

async function consumeStream(response, onEvent, signal) {
  if (!response.body) throw new Error('Streaming responses are not supported by this browser.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
      const result = await reader.read();
      buffer += decoder.decode(result.value || new Uint8Array(), { stream: !result.done });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseSseBlock(block);
        if (parsed) onEvent(parsed.event, parsed.data);
      }
      if (result.done) break;
    }
    if (buffer.trim()) {
      const parsed = parseSseBlock(buffer);
      if (parsed) onEvent(parsed.event, parsed.data);
    }
  } finally {
    reader.releaseLock();
  }
}

async function generateResponse() {
  const prompt = elements.prompt.value.trim();
  if (busy) return;
  if (!prompt) {
    elements.prompt.focus();
    showToast('Write a prompt first', 'warning');
    return;
  }
  if (prompt.length > serverConfig.maxPromptLength) {
    showToast('Your prompt is over the character limit', 'warning');
    return;
  }

  busy = true;
  requestController = new AbortController();
  const activeController = requestController;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    activeController.abort();
  }, API_TIMEOUT_MS);
  const wakeHint = setTimeout(() => {
    if (busy && requestController === activeController && !receivedAnyText) {
      elements.responseFootnote.textContent = 'The free Render service may be waking up. The first request after inactivity can take a little longer.';
    }
  }, RENDER_COLD_START_HINT_MS);
  elements.generate.disabled = true;
  elements.generate.classList.add('is-loading');
  elements.generateLabel.textContent = 'Thinking…';
  elements.stopGeneration.hidden = false;
  elements.responseFootnote.textContent = 'Connecting to the NodeAI streaming endpoint…';
  elements.responseBody.classList.add('is-working');

  let receivedAnyText = false;
  let completed = false;
  let streamMeta = { demoMode: false, model: null, durationMs: null };
  let streamError = null;

  showResponse('', { demoMode: false, model: null });
  elements.resultType.textContent = 'CONNECTING';
  elements.resultModel.textContent = 'Connecting to the streaming endpoint…';
  elements.responseFootnote.textContent = 'Contacting the NodeAI API…';
  elements.answerText.classList.add('streaming-text');

  try {
    const context = currentMode === 'chat' ? conversationTurns.slice(-serverConfig.maxContextMessages) : [];
    const response = await fetch(apiUrl('/api/ai/stream'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
      body: JSON.stringify({ mode: currentMode, tone: elements.toneSelect.value, prompt, context }),
      signal: activeController.signal
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'The request could not be completed.');
    }

    elements.resultModel.textContent = 'Waiting for first token…';
    elements.responseFootnote.textContent = 'The response will appear as it is generated.';

    await consumeStream(response, (eventName, data) => {
      if (eventName === 'meta') {
        streamMeta = { ...streamMeta, ...data };
        elements.resultType.className = 'result-type ' + (data.demoMode ? 'demo-result' : 'live-result');
        elements.resultType.textContent = data.demoMode ? 'DEMO STREAM' : 'LIVE STREAM';
        elements.resultModel.textContent = data.model || (data.demoMode ? 'Configured demo output' : 'Streaming from model');
      } else if (eventName === 'delta' && typeof data.text === 'string') {
        receivedAnyText = true;
        currentAnswer += data.text;
        elements.answerText.textContent = currentAnswer;
        elements.answerText.scrollTop = elements.answerText.scrollHeight;
        elements.copyAnswer.disabled = !currentAnswer;
        elements.copyAnswerBottom.disabled = !currentAnswer;
      } else if (eventName === 'done') {
        completed = true;
        streamMeta = { ...streamMeta, ...data };
      } else if (eventName === 'error') {
        streamError = data.error || 'The response stream failed.';
      }
    }, activeController.signal);

    if (streamError) throw new Error(streamError);
    if (!completed) throw new Error('The stream ended before the completion event arrived.');
    currentResult = streamMeta;
    elements.resultType.className = 'result-type ' + (streamMeta.demoMode ? 'demo-result' : 'live-result');
    elements.resultType.textContent = streamMeta.demoMode ? 'DEMO RESPONSE' : 'MODEL RESPONSE';
    elements.resultTime.textContent = formatDuration(streamMeta.durationMs);
    elements.resultModel.textContent = streamMeta.model || (streamMeta.demoMode ? 'Demo mode · no live model used' : 'Response generated');
    elements.answerText.classList.remove('streaming-text');
    elements.responseFootnote.textContent = streamMeta.demoMode
      ? 'Demo output · configure an API key for live model responses'
      : 'Response complete · review before using in production';
    elements.exportAnswer.disabled = !currentAnswer;

    if (currentMode === 'chat') {
      addConversationTurn('user', prompt);
      addConversationTurn('assistant', currentAnswer);
      elements.responseFootnote.textContent = 'Chat context ready · ' + conversationTurns.length + ' messages in this workspace';
    }
    elements.latencyMetric.textContent = formatDuration(streamMeta.durationMs) || '—';
    elements.latencyCaption.textContent = streamMeta.demoMode ? 'Demo response' : 'Last request duration';
    recordLocalHistory({
      id: streamMeta.requestId,
      mode: currentMode,
      tone: elements.toneSelect.value,
      prompt,
      answer: currentAnswer,
      demoMode: streamMeta.demoMode,
      model: streamMeta.model,
      durationMs: streamMeta.durationMs,
      createdAt: streamMeta.createdAt
    });
    setServerStatus(streamMeta.demoMode ? 'demo' : 'online', streamMeta.demoMode ? 'Demo mode' : 'AI connected');
    showToast(streamMeta.demoMode ? 'Demo response ready' : 'Response generated');
  } catch (error) {
    elements.answerText.classList.remove('streaming-text');
    if (error.name === 'AbortError') {
      if (timedOut) {
        setServerStatus('offline', 'API timeout');
        const message = 'No complete response arrived within 90 seconds. The Render service may be waking up, or the AI provider may be slow. Retry shortly.';
        if (!receivedAnyText) {
          showResponse(message, { demoMode: false });
          elements.resultType.textContent = 'REQUEST TIMEOUT';
          elements.resultType.classList.add('error-result');
          elements.resultModel.textContent = 'No complete response received';
          elements.responseFootnote.textContent = message;
          currentAnswer = '';
          elements.copyAnswer.disabled = true;
          elements.copyAnswerBottom.disabled = true;
          elements.exportAnswer.disabled = true;
        } else {
          elements.responseFootnote.textContent = 'Timed out · partial output is shown and was not saved.';
          elements.resultType.textContent = 'PARTIAL OUTPUT';
        }
        showToast('Request timed out. Please retry.', 'error');
      } else if (!receivedAnyText) {
        elements.responseFootnote.textContent = 'Generation cancelled before output arrived.';
        showToast('Generation cancelled', 'warning');
      } else {
        elements.responseFootnote.textContent = 'Generation stopped · partial output is shown and was not saved.';
        elements.resultType.textContent = 'PARTIAL OUTPUT';
        showToast('Generation stopped', 'warning');
      }
    } else {
      if (error instanceof TypeError) {
        setServerStatus('offline', 'API unavailable');
      }
      if (receivedAnyText) {
        elements.responseFootnote.textContent = 'Stream interrupted · partial output is shown.';
        elements.resultType.textContent = 'INTERRUPTED';
      } else {
        showResponse('Request failed\n\n' + error.message + '\n\nCheck the server status and try again.', { demoMode: true });
        elements.resultType.textContent = 'REQUEST ERROR';
        elements.resultType.classList.add('error-result');
        elements.resultModel.textContent = 'No response was generated';
        elements.responseFootnote.textContent = 'Request failed · review the message above';
      }
      showToast(error instanceof TypeError ? 'Could not reach the API. Retry shortly.' : (error.message || 'Request failed'), 'error');
    }
  } finally {
    clearTimeout(timeout);
    clearTimeout(wakeHint);
    if (requestController === activeController) requestController = null;
    busy = false;
    elements.stopGeneration.hidden = true;
    elements.generate.disabled = false;
    elements.generate.classList.remove('is-loading');
    elements.generateLabel.textContent = 'Generate response';
    elements.responseBody.classList.remove('is-working');
    elements.copyAnswer.disabled = !currentAnswer;
    elements.copyAnswerBottom.disabled = !currentAnswer;
    elements.exportAnswer.disabled = !currentAnswer;
  }
}

function getFileExtension(name) {
  const index = name.lastIndexOf('.');
  return index < 0 ? '' : name.slice(index + 1).toLowerCase();
}

function attachmentLanguage(name) {
  const extension = getFileExtension(name);
  const aliases = { js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', py: 'python', yml: 'yaml', html: 'html', sql: 'sql', json: 'json', css: 'css', md: 'markdown', mdx: 'mdx' };
  return aliases[extension] || extension;
}

async function handlePromptFile(file) {
  if (!file) return;
  const extension = getFileExtension(file.name);
  if (!ALLOWED_TEXT_EXTENSIONS.has(extension)) {
    showToast('Choose a supported text or source-code file', 'warning');
    return;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    showToast('Files must be 64 KB or smaller', 'warning');
    return;
  }
  try {
    const content = await file.text();
    if (!content.trim()) {
      showToast('That file is empty', 'warning');
      return;
    }
    const block = '\n\nAttached file: ' + file.name + '\n--- BEGIN SOURCE CONTENT ---\n' + content.trimEnd() + '\n--- END SOURCE CONTENT ---';
    const combined = elements.prompt.value + block;
    if (combined.length > serverConfig.maxPromptLength) {
      showToast('The file would exceed the prompt character limit. Shorten the prompt first.', 'warning');
      return;
    }
    elements.prompt.value = combined;
    updatePromptCount();
    elements.prompt.focus();
    showToast('Added ' + file.name + ' to the prompt');
  } catch {
    showToast('Could not read that file', 'error');
  } finally {
    elements.promptFile.value = '';
  }
}

function newSession() {
  if (busy && requestController) requestController.abort();
  elements.prompt.value = '';
  conversationTurns = [];
  updateContextIndicator();
  updatePromptCount();
  showEmptyResponse();
  elements.latencyMetric.textContent = '—';
  elements.latencyCaption.textContent = 'Ready for a prompt';
  elements.toneSelect.value = 'balanced';
  updateMode(currentMode);
  elements.prompt.focus();
}

async function copyText(text) {
  if (!text) {
    showToast('There is no output to copy', 'warning');
    return;
  }
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const temporary = document.createElement('textarea');
      temporary.value = text;
      temporary.style.position = 'fixed';
      temporary.style.opacity = '0';
      document.body.append(temporary);
      temporary.select();
      const copied = document.execCommand('copy');
      temporary.remove();
      if (!copied) throw new Error('Clipboard access was denied');
    }
    showToast('Copied to clipboard');
  } catch {
    showToast('Could not copy. Select the output and copy it manually.', 'error');
  }
}

function exportAnswer() {
  if (!currentAnswer) return;
  const mode = MODE_CONFIG[currentMode].title;
  const created = currentResult?.createdAt || new Date().toISOString();
  const documentText = '# NodeAI Studio — ' + mode + '\n\n' +
    'Created: ' + created + '\n' +
    'Response style: ' + elements.toneSelect.value + '\n\n' +
    '## Prompt\n\n' + elements.prompt.value.trim() + '\n\n' +
    '## Response\n\n' + currentAnswer + '\n';
  const blob = new Blob([documentText], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'nodeai-' + currentMode + '-' + new Date().toISOString().slice(0, 10) + '.md';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  showToast('Markdown export downloaded');
}

function clearHistory() {
  if (!historyCache.length) {
    showToast('Your local history is already empty', 'warning');
    return;
  }
  if (!window.confirm('Clear the sessions saved in this browser? This cannot be undone.')) return;
  historyCache = [];
  safelyWriteStorage(HISTORY_STORAGE_KEY, '[]');
  updateSessionMetrics();
  renderHistory();
  showToast('Browser history cleared');
}

function openCommandPalette() {
  if (!elements.commandDialog.open) elements.commandDialog.showModal();
  elements.commandSearch.value = '';
  filterCommandItems('');
  elements.commandSearch.focus();
}

function closeCommandPalette() {
  if (elements.commandDialog.open) elements.commandDialog.close();
  elements.prompt.focus();
}

function filterCommandItems(query) {
  const normalized = query.trim().toLowerCase();
  let visible = 0;
  $$('#commandItems [data-command]').forEach((button) => {
    const match = button.textContent.toLowerCase().includes(normalized);
    button.hidden = !match;
    if (match) visible++;
  });
  elements.commandItems.dataset.empty = visible ? 'false' : 'true';
}

function runCommand(command) {
  if (Object.hasOwn(MODE_CONFIG, command)) {
    updateMode(command);
    closeCommandPalette();
  } else if (command === 'new') {
    closeCommandPalette();
    newSession();
  } else if (command === 'theme') {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    closeCommandPalette();
  }
}

elements.modeButtons.forEach((button) => button.addEventListener('click', () => updateMode(button.dataset.mode)));
elements.prompt.addEventListener('input', updatePromptCount);
elements.toneSelect.addEventListener('change', () => safelyWriteStorage('nodeai-tone', elements.toneSelect.value));
elements.savePrompt.addEventListener('click', saveCurrentPrompt);
elements.generate.addEventListener('click', generateResponse);
elements.stopGeneration.addEventListener('click', () => { if (requestController) requestController.abort(); });
elements.promptFile.addEventListener('change', () => handlePromptFile(elements.promptFile.files?.[0]));
elements.clearPrompt.addEventListener('click', () => {
  elements.prompt.value = '';
  updatePromptCount();
  elements.prompt.focus();
});
elements.newSession.addEventListener('click', () => {
  if (elements.commandDialog.open) closeCommandPalette();
  newSession();
});
elements.copyAnswer.addEventListener('click', () => copyText(currentAnswer));
elements.copyAnswerBottom.addEventListener('click', () => copyText(currentAnswer));
elements.exportAnswer.addEventListener('click', exportAnswer);
elements.clearHistory.addEventListener('click', clearHistory);
elements.historySearch.addEventListener('input', renderHistory);
elements.themeToggle.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
elements.closeCommand.addEventListener('click', closeCommandPalette);
elements.commandSearch.addEventListener('input', () => filterCommandItems(elements.commandSearch.value));
elements.commandItems.addEventListener('click', (event) => {
  const button = event.target.closest('[data-command]');
  if (button && !button.hidden) runCommand(button.dataset.command);
});
elements.commandDialog.addEventListener('click', (event) => {
  if (event.target === elements.commandDialog) closeCommandPalette();
});
document.addEventListener('click', (event) => {
  const starter = event.target.closest('[data-prompt][data-mode]');
  if (!starter) return;
  updateMode(starter.dataset.mode);
  elements.prompt.value = starter.dataset.prompt || '';
  updatePromptCount();
  elements.prompt.focus();
});
document.addEventListener('keydown', (event) => {
  const modifier = event.metaKey || event.ctrlKey;
  if (modifier && event.key === 'Enter') {
    event.preventDefault();
    generateResponse();
  }
  if (modifier && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (elements.commandDialog.open) closeCommandPalette();
    else openCommandPalette();
  }
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !modifier) {
    event.preventDefault();
    elements.historySearch.focus();
  }
  if (elements.commandDialog.open && ['1', '2', '3', '4'].includes(event.key)) {
    const modes = { '1': 'chat', '2': 'code', '3': 'debug', '4': 'sql' };
    runCommand(modes[event.key]);
  }
});

setTheme(safelyReadStorage('nodeai-theme', 'dark'));
elements.toneSelect.value = ['balanced', 'concise', 'deep'].includes(safelyReadStorage('nodeai-tone', 'balanced'))
  ? safelyReadStorage('nodeai-tone', 'balanced') : 'balanced';
updateMode('chat');
updateContextIndicator();
renderSavedPrompts();
showEmptyResponse();
fetchConfig();
loadHistory();
checkServer();
setInterval(checkServer, 45000);
