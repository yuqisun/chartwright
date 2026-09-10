/**
 * Emphasis: turning a *declared condition* into per-datum styling.
 *
 * This is the neutral half. It knows nothing about any chart library: it decides
 * **which rows** a rule matches and hands back a tone per datum. What "highlight"
 * looks like — a colour, an outline, a label — is the backend's business.
 *
 * The reason `top_k` lives here rather than in the model's hands: "the largest"
 * is a fact about the data, and the model is not allowed to know data values.
 * The model declares `{ op: 'top_k', k: 1, field: 'notional_usd' }`; this file
 * finds the row. If the data changes, the highlight follows it.
 */
import type { EmphasisRule, EmphasisWhen, Row } from '../types.ts';

export type ResolvedTone = { tone: 'highlight' | 'muted'; label: boolean };

/** Identifies one datum in the materialised table: its category, plus its series if any. */
export type DatumKey = (row: Row) => string;

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function matches(when: EmphasisWhen, row: Row, key: string, topKeys: Set<string>): boolean {
  switch (when.op) {
    case 'top_k':
      return topKeys.has(key);
    case 'eq':
      return String(row[when.field]) === String(when.value);
    case 'neq':
      return String(row[when.field]) !== String(when.value);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const actual = asNumber(row[when.field]);
      if (actual === null) return false;
      if (when.op === 'gt') return actual > when.value;
      if (when.op === 'gte') return actual >= when.value;
      if (when.op === 'lt') return actual < when.value;
      return actual <= when.value;
    }
    case 'between': {
      const actual = asNumber(row[when.field]);
      return actual !== null && actual >= when.values[0] && actual <= when.values[1];
    }
    default:
      return false;
  }
}

/**
 * Ranks rows for a `top_k` rule.
 *
 * Ties at the k-th value are all included: two regions tied for the highest
 * revenue are both "the highest", and picking one arbitrarily would be a lie
 * that nobody could see.
 */
function topKeysFor(when: Extract<EmphasisWhen, { op: 'top_k' }>, rows: Row[], keyOf: DatumKey): Set<string> {
  const direction = when.direction === 'min' ? 1 : -1;
  const ranked = rows
    .map((row) => ({ key: keyOf(row), value: asNumber(row[when.field]) }))
    .filter((entry): entry is { key: string; value: number } => entry.value !== null)
    .sort((a, b) => direction * (a.value - b.value) || (a.key < b.key ? -1 : 1));

  const keys = new Set<string>();
  if (ranked.length === 0) return keys;

  const thresholdIndex = Math.min(Math.max(Math.trunc(when.k), 1), ranked.length) - 1;
  const threshold = ranked[thresholdIndex]!.value;
  for (const entry of ranked) {
    if (direction === -1 ? entry.value >= threshold : entry.value <= threshold) keys.add(entry.key);
  }
  return keys;
}

export type EmphasisResolution = {
  /** Keyed by `DatumKey`. A datum missing from the map is left alone. */
  styles: Map<string, ResolvedTone>;
  warnings: string[];
};

/**
 * Applies the rules in order; a later rule wins for a datum it matches, which
 * makes "mute everything, then highlight one" read exactly as it sounds.
 *
 * A rule that matches nothing produces a warning rather than silence: the user
 * asked for a highlight and got none, and that must not be invisible.
 */
export function resolveEmphasis(rules: EmphasisRule[] | undefined, rows: Row[], keyOf: DatumKey): EmphasisResolution {
  const styles = new Map<string, ResolvedTone>();
  const warnings: string[] = [];
  if (!rules || rules.length === 0) return { styles, warnings };

  for (const rule of rules) {
    if (rule.when.op === 'top_k' && rule.when.field !== undefined) {
      const known = rows.some((row) => asNumber(row[rule.when.field as string]) !== null);
      if (!known) {
        warnings.push(
          `emphasis rule top_k references '${rule.when.field}', which is not a numeric column of the charted table`,
        );
        continue;
      }
    }

    const topKeys = rule.when.op === 'top_k' ? topKeysFor(rule.when, rows, keyOf) : new Set<string>();
    const style: ResolvedTone = { tone: rule.style.tone, label: rule.style.label === true };

    let matched = 0;
    for (const row of rows) {
      const key = keyOf(row);
      if (matches(rule.when, row, key, topKeys)) {
        styles.set(key, style);
        matched += 1;
      }
    }

    if (matched === 0 && rule.when.op !== 'top_k') {
      warnings.push(`emphasis rule ${rule.when.op} on '${rule.when.field}' matched no rows`);
    }
  }

  return { styles, warnings };
}
