import { describe, it, expect, vi } from 'vitest';
import { evaluateNode, EvalContext } from '../../src/engine/evaluator.js';
import { ExpressionNode } from '../../src/types/index.js';

describe('Evaluator', () => {
  const mockContext: EvalContext = {
    chainId: 1,
    windowDuration: '1h',
    now: Date.now(),
    windowStart: Date.now() - 3600000,
    fetchState: vi.fn(),
    fetchEvents: vi.fn(),
  };

  it('evaluates constant nodes', async () => {
    const node: ExpressionNode = { type: 'constant', value: 42 };
    const result = await evaluateNode(node, mockContext);
    expect(result).toBe(42);
  });

  it('evaluates simple expressions', async () => {
    const node: ExpressionNode = {
      type: 'expression',
      operator: 'add',
      left: { type: 'constant', value: 10 },
      right: { type: 'constant', value: 32 }
    };
    const result = await evaluateNode(node, mockContext);
    expect(result).toBe(42);
  });

  it('handles division by zero', async () => {
    const node: ExpressionNode = {
      type: 'expression',
      operator: 'div',
      left: { type: 'constant', value: 10 },
      right: { type: 'constant', value: 0 }
    };
    const result = await evaluateNode(node, mockContext);
    expect(result).toBe(0);
  });
});
