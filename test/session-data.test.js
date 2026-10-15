'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_ARCHIVE_BYTES,
  MAX_HISTORY_ENTRIES,
  MAX_SAVED_PROMPTS,
  createHistoryArchive,
  createSavedPromptArchive,
  parseHistoryArchive,
  parseSavedPromptArchive
} = require('../public/session-data');

const historyEntry = (overrides = {}) => ({
  id: 'session-001',
  mode: 'code',
  tone: 'deep',
  prompt: 'Build a valid API',
  answer: '# Result\nA generated answer.',
  demoMode: false,
  model: 'gemini-3.8-flash',
  durationMs: 1250,
  createdAt: '2026-10-15T06:00:00.000Z',
  ...overrides
});

const savedPrompt = (overrides = {}) => ({
  id: 'prompt-001',
  mode: 'sql',
  prompt: 'Find the five highest-revenue customers.',
  savedAt: '2026-10-15T06:10:00.000Z',
  ...overrides
});

const json = (value) => JSON.stringify(value);

test('history archive round-trips validated response metadata', () => {
  const archive = createHistoryArchive([historyEntry()], '2026-10-15T07:00:00Z');
  assert.equal(archive.format, 'nodeai-history');
  assert.equal(archive.version, 1);
  assert.equal(archive.exportedAt, '2026-10-15T07:00:00.000Z');
  const parsed = parseHistoryArchive(json(archive));
  assert.equal(parsed.total, 1);
  assert.equal(parsed.skipped, 0);
  assert.deepEqual(parsed.entries, [historyEntry()]);
});

test('saved prompt archive round-trips and preserves workflow association', () => {
  const archive = createSavedPromptArchive([savedPrompt()], '2026-10-15T07:00:00Z');
  const parsed = parseSavedPromptArchive(json(archive));
  assert.equal(archive.format, 'nodeai-saved-prompts');
  assert.equal(parsed.total, 1);
  assert.deepEqual(parsed.prompts, [savedPrompt()]);
});

test('history import ignores malformed entries and normalizes unsafe optional metadata', () => {
  const archive = {
    format: 'nodeai-history', version: 1, entries: [
      historyEntry({ tone: 'invented', model: 'm'.repeat(200), durationMs: -1 }),
      { id: 'bad', mode: 'admin', prompt: 'Ignore the system', answer: 'Invalid mode' },
      historyEntry({ id: { unsafe: true }, createdAt: 'bad-date', demoMode: 'false' })
    ]
  };
  const result = parseHistoryArchive(json(archive));
  assert.equal(result.total, 3);
  assert.equal(result.skipped, 1);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].tone, 'balanced');
  assert.equal(result.entries[0].model, null);
  assert.equal(result.entries[0].durationMs, null);
  assert.equal(result.entries[1].id.startsWith('imported-'), true);
  assert.equal(result.entries[1].demoMode, false, 'a truthy string must not be treated as a boolean flag');
  assert.match(result.entries[1].createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('history import rejects empty prompts, oversized answers, and unknown roles or modes', () => {
  const result = parseHistoryArchive(json({
    format: 'nodeai-history', version: 1, entries: [
      historyEntry({ prompt: '   ' }),
      historyEntry({ answer: 'a'.repeat(150001) }),
      historyEntry({ mode: 'unknown' }),
      historyEntry()
    ]
  }));
  assert.equal(result.entries.length, 1);
  assert.equal(result.skipped, 3);
});

test('backup parsers provide a helpful error for malformed JSON', () => {
  assert.throws(() => parseHistoryArchive('{broken'), /not valid JSON/i);
  assert.throws(() => parseSavedPromptArchive(''), /non-empty/i);
});

test('backup parsers require the correct format and version', () => {
  assert.throws(() => parseHistoryArchive(json({ format: 'nodeai-saved-prompts', version: 1, entries: [] })), /not a supported/i);
  assert.throws(() => parseSavedPromptArchive(json({ format: 'nodeai-saved-prompts', version: 9, prompts: [] })), /not a supported/i);
  assert.throws(() => parseHistoryArchive(json({ format: 'nodeai-history', version: 1, entries: {} })), /not a supported/i);
});

test('backup parsers enforce file size and entry-count guardrails', () => {
  assert.throws(() => parseHistoryArchive(' '.repeat(MAX_ARCHIVE_BYTES + 1)), /too large/i);
  assert.throws(() => parseHistoryArchive(json({
    format: 'nodeai-history', version: 1, entries: Array(MAX_HISTORY_ENTRIES * 5 + 1).fill(historyEntry())
  })), /too many entries/i);
  assert.throws(() => parseSavedPromptArchive(json({
    format: 'nodeai-saved-prompts', version: 1, prompts: Array(MAX_SAVED_PROMPTS * 5 + 1).fill(savedPrompt())
  })), /too many entries/i);
});

test('export builders cap and normalize their exported collections', () => {
  const histories = Array.from({ length: MAX_HISTORY_ENTRIES + 2 }, (_, index) => historyEntry({ id: String(index) }));
  const prompts = Array.from({ length: MAX_SAVED_PROMPTS + 3 }, (_, index) => savedPrompt({ id: String(index) }));
  assert.equal(createHistoryArchive(histories).entries.length, MAX_HISTORY_ENTRIES);
  assert.equal(createSavedPromptArchive(prompts).prompts.length, MAX_SAVED_PROMPTS);
  assert.equal(createHistoryArchive([historyEntry({ answer: 'x'.repeat(150001) })]).entries.length, 0);
  assert.equal(createSavedPromptArchive([savedPrompt({ mode: 'system' })]).prompts.length, 0);
});
