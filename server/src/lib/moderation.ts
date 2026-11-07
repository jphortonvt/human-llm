import { Filter } from 'bad-words';

const filter = new Filter();

export const END_TOKEN = '[END]';
export const PARAGRAPH_TOKEN = '[PARAGRAPH]';
const SPECIAL_TOKENS = new Set([END_TOKEN, PARAGRAPH_TOKEN]);

export type NormalizedWord = {
  /** grouping key: lowercased, trimmed. Special tokens kept verbatim. */
  key: string;
  /** what we render: original casing, trimmed. */
  display: string;
};

/**
 * Normalize a submitted word to a single token. Collapses whitespace, strips
 * surrounding punctuation noise, enforces single-token. Returns null if empty
 * or multi-word (we only vote on single words, per Non-Goals).
 */
export function normalizeWord(raw: string): NormalizedWord | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (SPECIAL_TOKENS.has(trimmed.toUpperCase())) {
    const upper = trimmed.toUpperCase();
    return { key: upper, display: upper };
  }

  // Single token only — reject if there's internal whitespace.
  if (/\s/.test(trimmed)) return null;
  if (trimmed.length > 40) return null;

  return { key: trimmed.toLowerCase(), display: trimmed };
}

export function isSpecialToken(key: string): boolean {
  return SPECIAL_TOKENS.has(key);
}

/** Server-side hard filter. Returns the cleaned display + whether it was flagged. */
export function moderate(display: string): { clean: string; flagged: boolean } {
  if (SPECIAL_TOKENS.has(display.toUpperCase())) return { clean: display, flagged: false };
  let flagged = false;
  try {
    flagged = filter.isProfane(display);
  } catch {
    flagged = false;
  }
  return { clean: display, flagged };
}
