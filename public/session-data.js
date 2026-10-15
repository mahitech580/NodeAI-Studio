'use strict';

(function attachNodeAIDataTools(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NodeAIDataTools = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createNodeAIDataTools() {
  const VERSION = 1;
  const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024;
  const MAX_HISTORY_ENTRIES = 50;
  const MAX_SAVED_PROMPTS = 100;
  const MAX_PROMPT_LENGTH = 12000;
  const MAX_ANSWER_LENGTH = 150000;
  const MODES = new Set(['chat', 'code', 'debug', 'sql']);
  const TONES = new Set(['balanced', 'concise', 'deep']);

  function byteLength(value) {
    return new TextEncoder().encode(value).length;
  }

  function parseObjectArchive(source, expectedFormat, listKey, maximum) {
    if (typeof source !== 'string' || !source.trim()) {
      throw new Error('Choose a non-empty NodeAI JSON backup file.');
    }
    if (byteLength(source) > MAX_ARCHIVE_BYTES) {
      throw new Error('This backup is too large. The maximum supported file size is 2 MB.');
    }

    let archive;
    try {
      archive = JSON.parse(source);
    } catch {
      throw new Error('This file is not valid JSON. Export a fresh NodeAI backup and try again.');
    }
    if (!archive || typeof archive !== 'object' || Array.isArray(archive) ||
        archive.format !== expectedFormat || archive.version !== VERSION ||
        !Array.isArray(archive[listKey])) {
      throw new Error('This file is not a supported ' + expectedFormat + ' backup (version ' + VERSION + ').');
    }
    if (archive[listKey].length > maximum * 5) {
      throw new Error('This backup contains too many entries to import safely.');
    }
    return archive;
  }

  function safeTimestamp(value, fallback) {
    if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) return fallback;
    return new Date(value).toISOString();
  }

  function safeId(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const id = value.trim();
    return id && id.length <= 128 ? id : fallback;
  }

  function normalizeHistoryEntry(item, index) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        !MODES.has(item.mode) || typeof item.prompt !== 'string' || typeof item.answer !== 'string') {
      return null;
    }
    const prompt = item.prompt.trim();
    if (!prompt || prompt.length > MAX_PROMPT_LENGTH || item.answer.length > MAX_ANSWER_LENGTH) return null;
    const createdAt = safeTimestamp(item.createdAt, new Date(0).toISOString());
    const fallbackId = 'imported-' + index + '-' + createdAt.replace(/[^0-9]/g, '').slice(0, 14);
    const duration = Number(item.durationMs);
    return {
      id: safeId(item.id, fallbackId),
      mode: item.mode,
      tone: TONES.has(item.tone) ? item.tone : 'balanced',
      prompt,
      answer: item.answer,
      demoMode: Boolean(item.demoMode),
      model: typeof item.model === 'string' && item.model.trim() && item.model.length <= 128 ? item.model.trim() : null,
      durationMs: Number.isFinite(duration) && duration >= 0 && duration <= 86400000 ? duration : null,
      createdAt
    };
  }

  function normalizeSavedPrompt(item, index) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        !MODES.has(item.mode) || typeof item.prompt !== 'string') return null;
    const prompt = item.prompt.trim();
    if (!prompt || prompt.length > MAX_PROMPT_LENGTH) return null;
    const fallbackId = 'imported-prompt-' + index + '-' + prompt.length;
    return {
      id: safeId(item.id, fallbackId),
      mode: item.mode,
      prompt,
      savedAt: safeTimestamp(item.savedAt, new Date(0).toISOString())
    };
  }

  function parseHistoryArchive(source) {
    const archive = parseObjectArchive(source, 'nodeai-history', 'entries', MAX_HISTORY_ENTRIES);
    const normalized = archive.entries.map(normalizeHistoryEntry);
    const entries = normalized.filter(Boolean).slice(0, MAX_HISTORY_ENTRIES);
    return { entries, skipped: archive.entries.length - entries.length, total: archive.entries.length };
  }

  function parseSavedPromptArchive(source) {
    const archive = parseObjectArchive(source, 'nodeai-saved-prompts', 'prompts', MAX_SAVED_PROMPTS);
    const normalized = archive.prompts.map(normalizeSavedPrompt);
    const prompts = normalized.filter(Boolean).slice(0, MAX_SAVED_PROMPTS);
    return { prompts, skipped: archive.prompts.length - prompts.length, total: archive.prompts.length };
  }

  function createHistoryArchive(entries, exportedAt = new Date().toISOString()) {
    const source = Array.isArray(entries) ? entries : [];
    const normalized = source.map(normalizeHistoryEntry).filter(Boolean).slice(0, MAX_HISTORY_ENTRIES);
    return {
      format: 'nodeai-history',
      version: VERSION,
      exportedAt: safeTimestamp(exportedAt, new Date().toISOString()),
      entries: normalized
    };
  }

  function createSavedPromptArchive(prompts, exportedAt = new Date().toISOString()) {
    const source = Array.isArray(prompts) ? prompts : [];
    const normalized = source.map(normalizeSavedPrompt).filter(Boolean).slice(0, MAX_SAVED_PROMPTS);
    return {
      format: 'nodeai-saved-prompts',
      version: VERSION,
      exportedAt: safeTimestamp(exportedAt, new Date().toISOString()),
      prompts: normalized
    };
  }

  return {
    VERSION,
    MAX_ARCHIVE_BYTES,
    MAX_HISTORY_ENTRIES,
    MAX_SAVED_PROMPTS,
    MAX_PROMPT_LENGTH,
    MAX_ANSWER_LENGTH,
    parseHistoryArchive,
    parseSavedPromptArchive,
    createHistoryArchive,
    createSavedPromptArchive
  };
});
