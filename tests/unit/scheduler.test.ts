import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Queue, Worker } from 'bullmq';
import { pool } from '../../src/db/index.js';
import { startScheduler } from '../../src/worker/scheduler.js';
import { signalQueue } from '../../src/worker/processor.js';

// Mock BullMQ and DB
vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
  })),
  Worker: vi.fn(),
  Job: vi.fn(),
}));

vi.mock('../../src/db/index.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn().mockImplementation((pattern, fn) => {
      // Return a handle we can trigger manually in tests
      return { trigger: fn };
    }),
  },
}));

describe('Scheduler Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds active signals to the evaluation queue', async () => {
    // 1. Mock DB response with 2 active signals
    (pool.query as any).mockResolvedValue({
      rows: [{ id: 'signal-1' }, { id: 'signal-2' }]
    });

    // 2. We need to grab the task from the cron mock
    const cron = await import('node-cron');
    startScheduler();
    
    // Trigger the cron task manually
    const schedulerTask = (cron.default.schedule as any).mock.results[0].value.trigger;
    await schedulerTask();

    // 3. Verify
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('WHERE is_active = true'));
    expect(signalQueue.add).toHaveBeenCalledTimes(2);
    expect(signalQueue.add).toHaveBeenCalledWith('evaluate', { signalId: 'signal-1' }, expect.anything());
  });
});
