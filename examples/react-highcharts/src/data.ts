/**
 * Loads the synthetic post-trade dataset.
 *
 * Everything else — column metadata, profiling, transformation — comes from
 * chartwright, so the example demonstrates the library's real surface instead of
 * a parallel implementation of it.
 */
import postTrade from '../data/post-trade.json';

/** A row is whatever the caller passes in: chartwright never assumes a schema. */
export type Row = Record<string, unknown>;

export const rows = postTrade as Row[];
