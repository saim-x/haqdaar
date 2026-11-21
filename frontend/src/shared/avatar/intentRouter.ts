/**
 * Deterministic voice-to-action routing - ADR-025.
 *
 * The guide listens for a navigation goal in what the citizen said and offers a
 * single large button. Two rules make this safe:
 *
 * 1. **It never navigates.** `detectGuideAction` returns a suggestion; the
 *    citizen taps it. A misheard sentence must not move someone off a form they
 *    were halfway through.
 * 2. **It is a keyword matcher, not a model.** No network call, no LLM, no
 *    chance of inventing a destination. The worst case is a chip that appears
 *    when it was not needed, which costs one tap to ignore.
 *
 * Matching is on lowercased, whitespace-collapsed text with Urdu/Arabic
 * diacritics stripped, because the same word arrives spelled several ways from
 * STT, from a keyboard, and from a Roman-Urdu typist.
 */

import type { GuideAction } from './types';

/** Diacritics and tatweel carry no meaning for matching; drop them. */
const DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;

function normalize(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(DIACRITICS, '')
    .replace(/[\u200c\u200d]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Rule {
  action: GuideAction;
  /** Substrings that indicate the intent. Order matters: first match wins. */
  patterns: string[];
}

/**
 * Ordered most-specific first. `my_data` precedes `cases` because "میرا ڈیٹا"
 * and "my data" are frequently said alongside "میرا کیس"; the data-rights
 * destination is the more precise answer when both appear.
 */
