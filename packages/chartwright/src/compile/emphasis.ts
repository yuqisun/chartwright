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

/** Identifies one datum in the materialised table: its category, plus its series if any. For point-cloud types, the row index distinguishes points that share an x value (§2.1). */
export type DatumKey = (row: Row, measureField?: string, rowIndex?: number) => string;

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function matches(when: EmphasisWhen, row: Row, key: string, topKeys: Set<string>): boolean {
  switch (when.op) {
    // `top_k` never reaches here: its match is a set membership the loop below resolves, because
    // `rest` inverts it. The case is kept so the switch stays exhaustive over `EmphasisWhen` —
    // without it, adding an operator would compile and silently match nothing.
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
  // The measure field distinguishes the two axes in a dual-axis combo (§3.4 rule 1):
  // without it, both measures share a datum key and emphasis on one styles the other.
  const ranked = rows
    .map((row, ri) => ({ key: keyOf(row, when.field, ri), value: asNumber(row[when.field]) }))
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
export function resolveEmphasis(
  rules: EmphasisRule[] | undefined,
  rows: Row[],
  keyOf: DatumKey,
  /** When y2 is present, the two measure field names. Non-top_k rules emit a key per measure. */
  measureFields?: readonly [string, string],
): EmphasisResolution {
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
    // `rest` inverts the ranked set, so the two rules of "highlight the top, fade the rest"
    // cannot disagree: they pass the same k and direction, and the complement is taken here
    // rather than approximated by a second, larger `top_k` (see `EmphasisWhen`).
    const complement = rule.when.op === 'top_k' && rule.when.rest === true;
    const includes = (key: string) => (complement ? !topKeys.has(key) : topKeys.has(key));
    const style: ResolvedTone = { tone: rule.style.tone, label: rule.style.label === true };

    let matched = 0;
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      if (rule.when.op === 'top_k') {
        // top_k references a measure field, which becomes the series component of the key
        // in a dual-axis combo (§3.4 rule 1). For point-cloud types, the row index is the
        // datum key (§2.1).
        const key = keyOf(row, rule.when.field, ri);
        if (includes(key)) {
          styles.set(key, style);
          matched += 1;
        }
      } else if (measureFields !== undefined) {
        // Non-top_k rules on a combo chart match by value and style EVERY measure for the
        // matching categories. Emit a key per measure so both axes get the emphasis.
        const rowMatches = matches(rule.when, row, keyOf(row, undefined, ri), topKeys);
        if (rowMatches) {
          for (const field of measureFields) {
            styles.set(keyOf(row, field, ri), style);
          }
          matched += 1;
        }
      } else {
        const key = keyOf(row, undefined, ri);
        if (matches(rule.when, row, key, topKeys)) {
          styles.set(key, style);
          matched += 1;
        }
      }
    }

    // `top_k` is exempt from the empty warning only when it *selects*: a k larger than the table
    // clamps to the top of it, which is the user's emphasis delivered. `rest` is the one shape of
    // it that can legitimately come out empty, and an empty complement is emphasis that did not
    // arrive — the same lie the warning exists to prevent.
    const canBeEmpty = rule.when.op !== 'top_k' || rule.when.rest === true;
    if (matched === 0 && canBeEmpty) {
      const what = rule.when.op === 'top_k' ? `top_k k=${rule.when.k}` : rule.when.op;
      warnings.push(`emphasis rule ${what} on '${rule.when.field}' matched no rows`);
    }
  }

  return { styles, warnings };
}
