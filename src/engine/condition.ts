/**
 * SignalEvaluator - Orchestrates signal evaluation
 *
 * This module is protocol-agnostic. Protocol-specific data fetching
 * is handled by DataFetcher implementations (e.g., MorphoDataFetcher).
 */

import { evaluateCondition, EvalContext } from './evaluator.js';
import { Signal } from '../types/index.js';
import { parseDuration } from '../utils/duration.js';
import type { DataFetcher } from './fetcher.js';
import pino from 'pino';

const pinoFactory = (pino as unknown as { default: typeof pino }).default ?? pino;
const logger = pinoFactory({ name: 'signal-evaluator' });

export interface SignalEvaluationResult {
  signalId: string;
  triggered: boolean;
  timestamp: number;
  /** If evaluation failed, this contains the error */
  error?: string;
  /** Whether the result is conclusive (false if data fetch failed) */
  conclusive: boolean;
}

export class SignalEvaluator {
  private fetcher: DataFetcher;

  /**
   * Create a SignalEvaluator with a protocol-specific DataFetcher
   *
   * @param fetcher - DataFetcher implementation (e.g., from createMorphoFetcher)
   */
  constructor(fetcher: DataFetcher) {
    this.fetcher = fetcher;
  }

  async evaluate(signal: Signal): Promise<SignalEvaluationResult> {
    const now = Date.now();
    const defaultChainId = signal.chains[0] ?? 1;

    try {
      const durationMs = parseDuration(signal.window.duration);
      const windowStart = now - durationMs;

      const context: EvalContext = {
        chainId: defaultChainId,
        windowDuration: signal.window.duration,
        now,
        windowStart,
        // Delegate to the protocol-specific DataFetcher
        fetchState: (ref, ts) => this.fetcher.fetchState(ref, ts),
        fetchEvents: (ref, start, end) => this.fetcher.fetchEvents(ref, start, end),
      };

      const triggered = await evaluateCondition(
        signal.condition.left,
        signal.condition.operator,
        signal.condition.right,
        context
      );

      return {
        signalId: signal.id,
        triggered,
        timestamp: now,
        conclusive: true,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ signalId: signal.id, error }, 'Signal evaluation failed');
      return {
        signalId: signal.id,
        triggered: false,
        timestamp: now,
        error,
        conclusive: false,
      };
    }
  }
}
