'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const elements = {
  modeButtons: $$('.mode-button'),
  prompt: $('#prompt'),
  charCount: $('#charCount'),
  promptChips: $('#promptChips'),
  generate: $('#generate'),
  generateLabel: $('#generateLabel'),
  clearPrompt: $('#clearPrompt'),
  newSession: $('#newSession'),
  responseBody: $('#responseBody'),
  emptyResponse: $('#emptyResponse'),
  responseResult: $('#responseResult'),
  answerText: $('#answerText'),
  resultType: $('#resultType'),
  resultTime: $('#resultTime'),
  resultModel: $('#resultModel'),
  responseFootnote: $('#responseFootnote'),
  copyAnswer: $('#copyAnswer'),
  copyAnswerBottom: $('#copyAnswerBottom'),
  exportAnswer: $('#exportAnswer'),
  status: $('#status'),
  statusText: $('#statusText'),
  themeToggle: $('#themeToggle'),
  themeIcon: $('#themeIcon'),
  history: $('#history'),
  historyCount: $('#historyCount'),
  historySearch: $('#historySearch'),
  clearHistory: $('#clearHistory'),
  sessionMetric: $('#sessionMetric'),
  latencyMetric: $('#latencyMetric'),
  latencyCaption: $('#latencyCaption'),
  modeBadge: $('#modeBadge'),
  breadcrumbMode: $('#breadcrumbMode'),
  pageTitle: $('title'),
  toast: $('#toast')
};

const MODE_CONFIG = {
  chat: {
    title: 'AI Chat',
    badge: 'CHAT',
    description: 'Ask engineering questions, unpack concepts, and plan your next move.',
    placeholder: 'What are you working on today?',
    chips: [
      ['Explain the event loop', 'Explain the JavaScript event loop with a practical example.'],
      ['Review a function', 'Review this function for readability, edge cases, and performance:']
    ]
  },
  code: {
    title: 'Code Generator',
    badge: 'CODE',
    description: 'Turn a product idea or task into a thoughtful implementation.',
    placeholder: 'Describe the feature, language, inputs, and expected output…',
    chips: [
      ['Create a REST endpoint', 'Build an Express REST endpoint with validation and consistent JSON errors.'],
      ['Refactor this code', 'Refactor the following code for readability, testability, and maintainability:']
    ]
  },
  debug: {
    title: 'AI Debugger',
    badge: 'DEBUG',
    description: 'Trace symptoms to likely causes and make your next fix more confidently.',
    placeholder: 'Paste the relevant code, error message, and expected behavior…',
    chips: [
      ['Analyze this stack trace', 'Explain the root cause of this error and give me a minimal fix:'],
      ['Find edge cases', 'Review this code for edge cases, async bugs, and incorrect assumptions:']
    ]
  },
  sql: {
    title: 'SQL Assistant',
    badge: 'SQL',
    description: 'Draft queries, improve existing SQL, and understand how the pieces fit.',
    placeholder: 'Describe your tables, columns, SQL dialect, and the result you need…',
    chips: [
      ['Aggregate by customer', 'Find the top 10 customers by total revenue. Tables: customers(id, name), orders(customer_id, total_amount).'],
      ['Explain a query', 'Explain this SQL query, its joins, aggregation, and any performance concerns:']
    ]
  }
};

let currentMode = 'chat';
let currentAnswer = '';
let currentResult = null;
let historyCache = [];
let serverConfig = { maxPromptLength: 12000 };
let toastTimer = null;
let busy = false;

function safelyReadStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function safelyWriteStorage(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage may be blocked */ }
}

function setTheme(theme) {
  const nextTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = nextTheme;
  const isDark = nextTheme === 'dark';
  elements.themeIcon.textContent = isDark ? '☼' : '☾';
  elements.themeToggle.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
  elements.themeToggle.setAttribute('aria-pressed', String(!isDark));
  safelyWriteStorage('nodeai-theme', nextTheme);
}

function showToast(message, kind = 'success') {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = 'toast visible ' + kind;
  toastTimer = setTimeout(() => {
    elements.toast.className = 'toast';
  }, 2600);
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

function updateMode(mode, options = {}) {
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
  const badgeDot = document.createElement('span');
  badgeDot.className = 'badge-dot';
  elements.modeBadge.append(badgeDot, document.createTextNode(' ' + config.badge));
  elements.prompt.placeholder = config.placeholder;
  elements.promptChips.replaceChildren(...config.chips.map((item) => makeChip(item[0], item[1], mode)));
  document.title = config.title + ' — NodeAI Studio';
  if (options.focus) elements.prompt.focus();
  updatePromptCount();
}

function showEmptyResponse() {
  currentAnswer = '';
  currentResult = null;
  elements.emptyResponse.hidden = false;
  elements.responseResult.hidden = true;
  elements.answerText.textContent = '';
  elements.copyAnswer.disabled = true;
  elements.copyAnswerBottom.disabled = true;
  elements.exportAnswer.disabled = true;
  elements.responseFootnote.textContent = 'Waiting for your first prompt';
  elements.resultType.className = 'result-type';
  elements.resultType.textContent = 'MODEL RESPONSE';
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

function renderHistory(items = historyCache) {
  const query = elements.historySearch.value.trim().toLowerCase();
  const filtered = items.filter((item) => {
    const text = String(item.prompt || '') + ' ' + String(item.answer || '');
    return !query || text.toLowerCase().includes(query) || String(item.mode || '').includes(query);
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

  filtered.slice(0, 12).forEach((item) => {
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
    preview.textContent = String(item.answer || '').replace(/\s+/g, ' ').slice(0, 70);
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
  elements.prompt.value = item.prompt || '';
  updatePromptCount();
  showResponse(item.answer || '', {
    demoMode: Boolean(item.demoMode),
    model: item.model,
    durationMs: item.durationMs,
    createdAt: item.createdAt
  });
  elements.latencyMetric.textContent = formatDuration(item.durationMs) || '—';
  elements.latencyCaption.textContent = 'Selected from history';
  showToast('Session restored');
}

async function loadHistory() {
  try {
    const response = await fetch('/api/history?limit=50', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('History is unavailable');
    const data = await response.json();
    historyCache = Array.isArray(data.history) ? data.history : [];
    updateSessionMetrics();
    renderHistory();
  } catch {
    elements.history.replaceChildren();
    const message = document.createElement('div');
    message.className = 'history-empty';
    message.textContent = 'History is unavailable while the server is offline.';
    elements.history.append(message);
  }
}

async function checkServer() {
  try {
    const response = await fetch('/api/health', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Server unavailable');
    const data = await response.json();
    if (!data.success) throw new Error('Server unavailable');
    setServerStatus(data.demoMode ? 'demo' : 'online', data.demoMode ? 'Demo mode' : 'AI connected');
    elements.status.title = data.demoMode
      ? 'The backend is healthy but no AI_API_KEY is configured.'
      : 'AI provider configured. Model: ' + (data.model || 'configured model');
  } catch {
    setServerStatus('offline', 'Server offline');
    elements.status.title = 'Could not reach the NodeAI Studio API.';
  }
}

async function fetchConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) return;
    const config = await response.json();
    if (config.success && Number.isFinite(config.maxPromptLength)) {
      serverConfig.maxPromptLength = config.maxPromptLength;
      elements.prompt.maxLength = String(config.maxPromptLength);
      updatePromptCount();
    }
  } catch { /* the health check communicates connectivity state */ }
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
  elements.generate.disabled = true;
  elements.generate.classList.add('is-loading');
  elements.generateLabel.textContent = 'Working on it…';
  elements.responseFootnote.textContent = 'Sending your request to the NodeAI server…';
  elements.responseBody.classList.add('is-working');

  try {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ mode: currentMode, prompt })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'The request could not be completed.');
    }

    showResponse(data.answer, data);
    elements.latencyMetric.textContent = formatDuration(data.durationMs) || '—';
    elements.latencyCaption.textContent = data.demoMode ? 'Demo response' : 'Last request duration';
    await loadHistory();
    setServerStatus(data.demoMode ? 'demo' : 'online', data.demoMode ? 'Demo mode' : 'AI connected');
    showToast(data.demoMode ? 'Demo response ready' : 'Response generated');
  } catch (error) {
    showResponse('Request failed\n\n' + error.message + '\n\nCheck the server status and try again.', { demoMode: true });
    elements.resultType.textContent = 'REQUEST ERROR';
    elements.resultType.classList.add('error-result');
    elements.resultModel.textContent = 'No response was generated';
    elements.responseFootnote.textContent = 'Request failed · review the message above';
    showToast(error.message || 'Request failed', 'error');
  } finally {
    busy = false;
    elements.generate.disabled = false;
    elements.generate.classList.remove('is-loading');
    elements.generateLabel.textContent = 'Generate response';
    elements.responseBody.classList.remove('is-working');
  }
}

function newSession() {
  elements.prompt.value = '';
  updatePromptCount();
  showEmptyResponse();
  elements.latencyMetric.textContent = '—';
  elements.latencyCaption.textContent = 'Ready for a prompt';
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
  const created = currentResult && currentResult.createdAt ? currentResult.createdAt : new Date().toISOString();
  const documentText = '# NodeAI Studio — ' + mode + '\n\n' +
    '**Created:** ' + created + '\n\n' +
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

async function clearHistory() {
  if (!historyCache.length) {
    showToast('Your history is already empty', 'warning');
    return;
  }
  if (!window.confirm('Clear all saved NodeAI Studio sessions from this server? This cannot be undone.')) return;
  try {
    const response = await fetch('/api/history', { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Could not clear history');
    historyCache = [];
    updateSessionMetrics();
    renderHistory();
    showToast('Conversation history cleared');
  } catch (error) {
    showToast(error.message || 'Could not clear history', 'error');
  }
}

elements.modeButtons.forEach((button) => button.addEventListener('click', () => updateMode(button.dataset.mode)));
elements.prompt.addEventListener('input', updatePromptCount);
elements.generate.addEventListener('click', generateResponse);
elements.clearPrompt.addEventListener('click', () => {
  elements.prompt.value = '';
  updatePromptCount();
  elements.prompt.focus();
});
elements.newSession.addEventListener('click', newSession);
elements.copyAnswer.addEventListener('click', () => copyText(currentAnswer));
elements.copyAnswerBottom.addEventListener('click', () => copyText(currentAnswer));
elements.exportAnswer.addEventListener('click', exportAnswer);
elements.clearHistory.addEventListener('click', clearHistory);
elements.historySearch.addEventListener('input', () => renderHistory());
elements.themeToggle.addEventListener('click', () => {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
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
    elements.prompt.focus();
  }
  if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && !modifier) {
    event.preventDefault();
    elements.historySearch.focus();
  }
});

setTheme(safelyReadStorage('nodeai-theme', 'dark'));
updateMode('chat');
showEmptyResponse();
fetchConfig();
loadHistory();
checkServer();
setInterval(checkServer, 45000);
