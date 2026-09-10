/**
 * The deterministic transformation engine.
 *
 * Everything here is pure and total: the same rows plus the same steps always
 * produce the same table. That property is what lets a chart be replayed from
 * its spec without calling a model, and what makes the output testable.
 *
 * Errors are thrown with human-readable messages on purpose: in the agent loop
 * a thrown error is handed back to the model as the tool result, so the message
 * *is* the repair instruction.
 */
import type { AggregateStep, Measure, Operand, Row, TransformStep } from './types.ts';

/** Parses a value as a finite number, or returns null. */
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Comparison used by sort and the ordering filter operators. */
function compare(a: unknown, b: unknown): number {
  const na = num(a);
  const nb = num(b);
  if (na !== null && nb !== null) return na < nb ? -1 : na > nb ? 1 : 0;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function applyFilter(rows: Row[], step: Extract<TransformStep, { op: 'filter' }>): Row[] {
  const { field, operator } = step;
  const candidate = step.value ?? step.values;
  return rows.filter((row) => {
    const actual = row[field];
    switch (operator) {
      case 'eq':
        return actual === candidate;
      case 'neq':
        return actual !== candidate;
      case 'gt':
        return compare(actual, candidate) > 0;
      case 'gte':
        return compare(actual, candidate) >= 0;
      case 'lt':
        return compare(actual, candidate) < 0;
      case 'lte':
        return compare(actual, candidate) <= 0;
      case 'between': {
        const pair = Array.isArray(candidate) ? candidate : [];
        if (pair.length < 2) {
          throw new Error(`filter 'between' on '${field}' needs two values, got ${JSON.stringify(candidate)}`);
        }
        return compare(actual, pair[0]) >= 0 && compare(actual, pair[1]) <= 0;
      }
      case 'in': {
        const list = Array.isArray(candidate) ? candidate : [candidate];
        return list.some((v) => v === actual);
      }
      case 'contains':
        return String(actual).includes(String(candidate));
      default:
        throw new Error(`unknown filter operator '${String(operator)}'`);
    }
  });
}

function measureValues(rows: Row[], measure: Measure): unknown[] {
  if (measure.agg === 'count' && measure.field === undefined) return rows;
  if (measure.field === undefined) {
    throw new Error(`aggregate '${measure.agg}' needs a field`);
  }
  return rows.map((r) => r[measure.field as string]);
}

function computeMeasure(rows: Row[], measure: Measure): unknown {
  const values = measureValues(rows, measure);

  switch (measure.agg) {
    case 'count':
      return values.filter((v) => v !== null && v !== undefined).length;
    case 'countDistinct':
      return new Set(values.filter((v) => v !== null && v !== undefined).map(String)).size;
    case 'sum':
    case 'avg':
    case 'min':
    case 'max': {
      const numbers = values.map(num).filter((n): n is number => n !== null);
      if (numbers.length === 0) return null;
      if (measure.agg === 'sum') return numbers.reduce((a, b) => a + b, 0);
      if (measure.agg === 'avg') return numbers.reduce((a, b) => a + b, 0) / numbers.length;
      return measure.agg === 'min' ? Math.min(...numbers) : Math.max(...numbers);
    }
    default:
      // Fail loudly. Silently dropping the column would produce a chart with a
      // missing series, which is far harder to diagnose than a thrown error.
      throw new Error(
        `unknown aggregation '${String(measure.agg)}'. Supported: sum, avg, count, countDistinct, min, max`,
      );
  }
}

function applyAggregate(rows: Row[], step: AggregateStep): Row[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = step.group_by.map((f) => String(row[f])).join('\u0000');
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  return [...groups.values()].map((bucket) => {
    const first = bucket[0] ?? {};
    const out: Row = {};
    for (const field of step.group_by) out[field] = first[field];
    for (const measure of step.measures) out[measure.as] = computeMeasure(bucket, measure);
    return out;
  });
}

function applySort(rows: Row[], step: Extract<TransformStep, { op: 'sort' }>): Row[] {
  const direction = step.order === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => direction * compare(a[step.by], b[step.by]));
}

function operandValue(row: Row, operand: Operand): number | null {
  return 'field' in operand ? num(row[operand.field]) : operand.value;
}

function applyDerive(rows: Row[], step: Extract<TransformStep, { op: 'derive' }>): Row[] {
  return rows.map((row) => {
    const left = operandValue(row, step.left);
    const right = operandValue(row, step.right);
    let value: number | null = null;
    if (left !== null && right !== null) {
      switch (step.operator) {
        case 'add':
          value = left + right;
          break;
        case 'subtract':
          value = left - right;
          break;
        case 'multiply':
          value = left * right;
          break;
        case 'divide':
          // Division by zero is a data fact, not a crash: keep the row, null the value.
          value = right === 0 ? null : left / right;
          break;
        default:
          throw new Error(`unknown derive operator '${String(step.operator)}'`);
      }
    }
    return { ...row, [step.as]: value };
  });
}

function applyBinTime(rows: Row[], step: Extract<TransformStep, { op: 'binTime' }>): Row[] {
  return rows.map((row) => ({ ...row, [step.as]: binDate(row[step.field], step.granularity) }));
}

export function binDate(value: unknown, granularity: 'month' | 'quarter' | 'year'): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  if (granularity === 'year') return String(year);
  const month = date.getUTCMonth() + 1;
  if (granularity === 'quarter') return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Executes a transform plan over the given rows.
 *
 * Rows are never mutated; each step produces a new array.
 */
export function applyTransform(rows: Row[], steps: TransformStep[]): Row[] {
  let table = rows;
  for (const step of steps) {
    switch (step.op) {
      case 'filter':
        table = applyFilter(table, step);
        break;
      case 'aggregate':
        table = applyAggregate(table, step);
        break;
      case 'sort':
        table = applySort(table, step);
        break;
      case 'limit': {
        if (!Number.isInteger(step.n) || step.n < 0) {
          throw new Error(`limit needs a non-negative integer, got ${JSON.stringify(step.n)}`);
        }
        table = table.slice(0, step.n);
        break;
      }
      case 'derive':
        table = applyDerive(table, step);
        break;
      case 'binTime':
        table = applyBinTime(table, step);
        break;
      default:
        throw new Error(`unknown transform op '${String((step as { op?: unknown }).op)}'`);
    }
  }
  return table;
}
