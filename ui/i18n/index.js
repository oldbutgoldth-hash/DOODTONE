/**
 * ui/i18n/index.js
 *
 * EPIC 2E-J — FULL SYSTEM I18N + CROSS-LAYER HONESTY R1 — Phase A.
 *
 * Centralized, dependency-free runtime i18n module. This is the ONE
 * place every renderer/controller in this project should read
 * user-facing text from, going forward, for any string introduced or
 * touched by this EPIC.
 *
 * HARD GUARANTEES:
 * - English (`en`) is always the fallback language -- a missing Thai
 *   key never crashes rendering and never renders blank; it silently
 *   falls back to the English string.
 * - A genuinely missing key (absent from BOTH `en` and `th`) never
 *   throws -- it returns the key itself (visibly wrong, but never a
 *   crash), and is recorded exactly once in a bounded, QA-only
 *   diagnostic list (`getMissingTranslationKeys()`).
 * - No HTML is ever produced here -- `t()` returns plain text only.
 *   Callers must keep using `textContent`/`el({text})`, never
 *   `innerHTML`, with the returned string.
 * - Parameters are interpolated as plain text substitutions
 *   (`{{paramName}}` tokens) -- never evaluated, never used to build
 *   markup.
 * - This module holds NO business-logic state -- it is pure string
 *   lookup. Callers must never branch behavior on a translated
 *   string; branch on the underlying code/state value instead, and
 *   translate only at the point of display.
 *
 * This module is intentionally framework-free (no build step) to
 * match this project's existing plain-ES-module convention.
 */

import { en } from './en.js';
import { th } from './th.js';

const DICTS = { en, th };
const SUPPORTED_LOCALES = new Set(['en', 'th']);

// Bounded (never unbounded growth across a long-running page session).
const MAX_TRACKED_MISSING_KEYS = 200;
const _missingKeys = new Set();

/** Normalizes any input into exactly 'en' or 'th' -- never anything else, never throws. */
export function normalizeLocale(locale) {
  if (typeof locale === 'string') {
    const lower = locale.toLowerCase();
    if (lower === 'th' || lower.startsWith('th-')) return 'th';
    if (lower === 'en' || lower.startsWith('en-')) return 'en';
  }
  return 'en';
}

/** Resolves a dotted key path ('a.b.c') against a nested dictionary object. Never throws. */
function _resolve(dict, key) {
  if (!dict || typeof key !== 'string' || !key) return undefined;
  const parts = key.split('.');
  let cur = dict;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object' || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

function _recordMissing(key, locale) {
  if (_missingKeys.size >= MAX_TRACKED_MISSING_KEYS) return;
  _missingKeys.add(`${locale}:${key}`);
}

/** Interpolates `{{name}}` tokens in `template` from `params` -- text substitution only, never HTML. */
function _interpolate(template, params) {
  if (!params || typeof params !== 'object') return template;
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, name) => {
    const v = params[name];
    if (v === undefined || v === null) return match;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    return match; // never stringify objects/arrays into the UI
  });
}

/**
 * Looks up `key` in the requested locale, falling back to English,
 * then to the literal key itself (last resort, never throws, never
 * returns undefined/null). `params` are interpolated as plain text.
 */
export function t(key, params, locale) {
  const loc = normalizeLocale(locale);
  if (typeof key !== 'string' || !key) return '';

  let template = _resolve(DICTS[loc], key);
  if (template === undefined && loc !== 'en') {
    template = _resolve(DICTS.en, key);
  }
  if (template === undefined) {
    _recordMissing(key, loc);
    return key; // last-resort visible fallback -- never throws, never blank
  }
  return _interpolate(template, params);
}

/** True only if `key` resolves in the requested locale OR the English fallback. */
export function hasTranslation(key, locale) {
  const loc = normalizeLocale(locale);
  return _resolve(DICTS[loc], key) !== undefined || _resolve(DICTS.en, key) !== undefined;
}

/** Bounded, QA-only diagnostic -- the set of "locale:key" pairs that were requested but resolved to neither locale nor English. Never used to alter rendering. */
export function getMissingTranslationKeys() {
  return Array.from(_missingKeys);
}

/** Test-only reset hook for the missing-key diagnostic (never called from production code paths). */
export function _resetMissingTranslationKeysForTest() {
  _missingKeys.clear();
}

/**
 * Convenience helper for count-dependent phrasing -- resolves
 * `${key}.zero` / `${key}.one` / `${key}.other` where present, else
 * falls back to `${key}.other`, else the plain `key`. `count` is
 * exposed to the template as `{{count}}`.
 */
export function formatCount(key, count, locale) {
  const loc = normalizeLocale(locale);
  const n = Number.isFinite(count) ? count : 0;
  const suffix = n === 0 ? 'zero' : (n === 1 ? 'one' : 'other');
  const candidateKeys = [`${key}.${suffix}`, `${key}.other`, key];
  for (const k of candidateKeys) {
    if (hasTranslation(k, loc)) return t(k, { count: n }, loc);
  }
  return t(key, { count: n }, loc);
}

/** Exposed for tests / diagnostics only -- never for business logic. */
export function _debugSupportedLocales() {
  return Array.from(SUPPORTED_LOCALES);
}
