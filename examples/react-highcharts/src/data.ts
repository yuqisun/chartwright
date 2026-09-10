import postTrade from '../data/post-trade.json';

/** A row is whatever the caller passes in: chartwright never assumes a schema. */
export type Row = Record<string, unknown>;

/** Column metadata: the same shape the LLM is given (names + types, no values). */
export type Column = {
  name: string;
  type: 'string' | 'number' | 'date';
};

export const rows = postTrade as Row[];

const DATE_LIKE = /^\d{4}-\d{2}(-\d{2})?([T ].*)?$/;

function typeOf(value: unknown): Column['type'] {
  if (typeof value === 'number') return 'number';
  if (value instanceof Date) return 'date';
  if (typeof value === 'string' && DATE_LIKE.test(value)) return 'date';
  return 'string';
}

/**
 * Infers column metadata from the first non-null value of each column.
 *
 * A real app already knows its schema (from its data model); this exists so the
 * example has no hidden dependencies.
 */
export function inferColumns(input: Row[]): Column[] {
  const sample = input[0] ?? {};
  return Object.keys(sample).map((name) => {
    const firstNonNull = input.find((r) => r[name] !== null && r[name] !== undefined)?.[name];
    return { name, type: typeOf(firstNonNull) };
  });
}
