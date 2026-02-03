import { evaluateCondition, EvalContext, EvaluationError } from './evaluator.js';
import { Signal, Condition } from '../types/index.js';
import { EnvioClient } from '../envio/client.js';
import { resolveBlockByTimestamp } from '../envio/blocks.js';
import { parseDuration } from '../utils/duration.js';

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
  private envio: EnvioClient;

  constructor(envio: EnvioClient) {
    this.envio = envio;
  }

  async evaluate(signal: Signal): Promise<SignalEvaluationResult> {
    const now = Date.now();

    try {
      const durationMs = parseDuration(signal.window.duration);
      const windowStart = now - durationMs;

      const windowStartBlock = await resolveBlockByTimestamp(signal.chains[0] || 1, windowStart);

      const context: EvalContext = {
        chainId: signal.chains[0] || 1,
        windowDuration: signal.window.duration,
        now,
        windowStart,
        fetchState: (ref, ts) => this.envio.fetchState(ref, ts === windowStart ? windowStartBlock : undefined),
        fetchEvents: (ref, start, end) => this.envio.fetchEvents(ref, start, end),
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
