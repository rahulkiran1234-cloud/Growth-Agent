export const STALE_DAYS = 90;

// Words that carry no signal for keyword matching (Postgres drops its own stopwords too).
const STOP = new Set(["the", "and", "for", "are", "who", "what", "which", "does", "how", "with", "this", "that", "from", "any", "has", "have", "can", "their", "they", "them", "our", "you", "your"]);

export function queryTerms(q: string): string[] {
  return [...new Set(q.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].filter((t) => !STOP.has(t));
}

/** OR-style tsquery so one missing word doesn't empty the result. */
export function toOrQuery(terms: string[]): string | null {
  return terms.length ? terms.join(" | ") : null;
}

/** Older documents are down-weighted a little: stale competitor data is less trustworthy. */
export function recencyFactor(docDate: string | null, now = Date.now()): number {
  if (!docDate) return 0.9;
  const days = (now - Date.parse(docDate)) / 864e5;
  if (days > 180) return 0.85;
  if (days > STALE_DAYS) return 0.95;
  return 1;
}

