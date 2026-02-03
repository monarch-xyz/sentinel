/**
 * DSL Validation Utilities
 * Validates signal definitions before they're persisted.
 */

import { ExpressionNode, Condition } from '../types/index.js';
import { isValidDuration } from './duration.js';

const MAX_EXPRESSION_DEPTH = 20;

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validates that an expression tree doesn't exceed max depth.
 * Prevents stack overflow from malicious/malformed input.
 */
export function validateExpressionDepth(
  node: ExpressionNode,
  currentDepth = 0,
  maxDepth = MAX_EXPRESSION_DEPTH
): void {
  if (currentDepth > maxDepth) {
    throw new ValidationError(
      `Expression tree exceeds maximum depth of ${maxDepth}. Simplify your condition.`,
      'condition'
    );
  }

  if (node.type === 'expression') {
    validateExpressionDepth(node.left, currentDepth + 1, maxDepth);
    validateExpressionDepth(node.right, currentDepth + 1, maxDepth);
  }
}

/**
 * Validates a complete condition (both sides of comparison).
 */
export function validateCondition(condition: Condition): void {
  validateExpressionDepth(condition.left);
  validateExpressionDepth(condition.right);
}

/**
 * Validates a duration string format.
 */
export function validateDuration(duration: string, field = 'duration'): void {
  if (!isValidDuration(duration)) {
    throw new ValidationError(
      `Invalid duration format: "${duration}". Expected format: {number}{unit} where unit is s|m|h|d|w`,
      field
    );
  }
}

/**
 * Validates a webhook URL.
 */
export function validateWebhookUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new ValidationError(
        'Webhook URL must use http or https protocol',
        'webhook_url'
      );
    }
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    throw new ValidationError(
      `Invalid webhook URL: "${url}"`,
      'webhook_url'
    );
  }
}

/**
 * Validates that chains array is non-empty and contains valid chain IDs.
 */
export function validateChains(chains: number[]): void {
  if (!chains || chains.length === 0) {
    throw new ValidationError(
      'At least one chain ID is required',
      'chains'
    );
  }

  for (const chainId of chains) {
    if (!Number.isInteger(chainId) || chainId <= 0) {
      throw new ValidationError(
        `Invalid chain ID: ${chainId}. Must be a positive integer.`,
        'chains'
      );
    }
  }
}

/**
 * Validates a complete signal definition.
 */
export interface SignalValidationInput {
  chains: number[];
  window: { duration: string };
  condition: Condition;
  webhook_url: string;
}

export function validateSignal(signal: SignalValidationInput): void {
  validateChains(signal.chains);
  validateDuration(signal.window.duration, 'window.duration');
  validateCondition(signal.condition);
  validateWebhookUrl(signal.webhook_url);
}
