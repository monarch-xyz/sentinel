import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pool } from '../../src/db/index.js';
import { EnvioClient } from '../../src/envio/client.js';
import { dispatchNotification } from '../../src/worker/notifier.js';
import { setupWorker } from '../../src/worker/processor.js';

// Mock everything
vi.mock('../../src/db/index.js', () => ({
  pool: { query: vi.fn() },
}));

vi.mock('../../src/envio/client.js', () => ({
  EnvioClient: vi.fn().mockImplementation(() => ({
    fetchState: vi.fn(),
    fetchEvents: vi.fn(),
  })),
}));

vi.mock('../../src/worker/notifier.js', () => ({
  dispatchNotification: vi.fn().mockResolvedValue({ success: true, status: 200, durationMs: 100 }),
}));

// We mock BullMQ to capture the worker handler
let capturedHandler: any;
vi.mock('bullmq', () => ({
  Queue: vi.fn(),
  Worker: vi.fn().mockImplementation((name, handler) => {
    capturedHandler = handler;
    return { on: vi.fn() };
  }),
}));

describe('Processor Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('evaluates a signal and dispatches notification', async () => {
    setupWorker();
    
    // 1. Mock DB returning a simple signal
    (pool.query as any).mockResolvedValueOnce({
      rows: [{
        id: 'sig-123',
        name: 'Simple Alert',
        is_active: true,
        webhook_url: 'https://test.com',
        cooldown_minutes: 5,
        chains: [1],
        window: { duration: '1h' },
        condition: {
          type: 'condition',
          operator: 'gt',
          left: { type: 'constant', value: 100 },
          right: { type: 'constant', value: 50 }
        },
        definition: {
          chains: [1],
          window: { duration: '1h' },
          condition: {
            type: 'condition',
            operator: 'gt',
            left: { type: 'constant', value: 100 },
            right: { type: 'constant', value: 50 }
          }
        }
      }]
    });

    // 2. Execute the worker handler
    await capturedHandler({ data: { signalId: 'sig-123' } });

    // 3. Verify notification was sent (because 100 > 50)
    expect(dispatchNotification).toHaveBeenCalledWith(
      'https://test.com',
      expect.objectContaining({ signal_id: 'sig-123' })
    );
    
    // 4. Verify DB was updated
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE signals SET last_triggered_at'),
      ['sig-123']
    );
  });
});
