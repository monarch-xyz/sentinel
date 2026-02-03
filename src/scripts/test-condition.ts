#!/usr/bin/env npx tsx
/**
 * CLI tool to test if a condition would trigger given current blockchain state.
 * 
 * Usage:
 *   pnpm tsx src/scripts/test-condition.ts <condition.json>
 *   pnpm tsx src/scripts/test-condition.ts --inline '{"type":"threshold",...}'
 * 
 * Examples:
 *   # Test from file
 *   pnpm tsx src/scripts/test-condition.ts tests/fixtures/whale-drop.json
 * 
 *   # Test inline JSON
 *   pnpm tsx src/scripts/test-condition.ts --inline '{
 *     "type": "threshold",
 *     "metric": "Morpho.Market.utilization",
 *     "operator": ">",
 *     "value": 0.9,
 *     "market_id": "0x..."
 *   }'
 * 
 *   # With custom window
 *   pnpm tsx src/scripts/test-condition.ts --window 7d --inline '...'
 * 
 *   # Dry run (show compiled AST without executing)
 *   pnpm tsx src/scripts/test-condition.ts --dry-run --inline '...'
 */

import { readFileSync } from 'fs';
import { compileCondition, isGroupCondition, CompiledCondition } from '../engine/compiler.js';
import { evaluateCondition, EvalContext } from '../engine/evaluator.js';
import { EnvioClient } from '../envio/client.js';
import { resolveBlockByTimestamp } from '../envio/blocks.js';
import { parseDuration } from '../utils/duration.js';
import { Condition as UserCondition } from '../types/signal.js';
import { config } from '../config/index.js';

// ============================================
// Argument Parsing
// ============================================

interface Args {
  conditionFile?: string;
  inlineJson?: string;
  window: string;
  chainId: number;
  dryRun: boolean;
  verbose: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Args = {
    window: '1h',
    chainId: 1,
    dryRun: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--inline' && args[i + 1]) {
      result.inlineJson = args[++i];
    } else if (arg === '--window' && args[i + 1]) {
      result.window = args[++i];
    } else if (arg === '--chain' && args[i + 1]) {
      result.chainId = parseInt(args[++i], 10);
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--verbose' || arg === '-v') {
      result.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      result.conditionFile = arg;
    }
  }

  return result;
}

function printHelp() {
  console.log(`
Flare Condition Tester

Usage:
  pnpm tsx src/scripts/test-condition.ts [options] <condition.json>
  pnpm tsx src/scripts/test-condition.ts [options] --inline '<json>'

Options:
  --inline <json>   Pass condition JSON directly
  --window <dur>    Time window (default: 1h). Examples: 30m, 1h, 7d
  --chain <id>      Chain ID (default: 1 for Ethereum)
  --dry-run         Show compiled AST without executing
  --verbose, -v     Show detailed evaluation steps
  --help, -h        Show this help

Examples:
  # Simple threshold check
  pnpm tsx src/scripts/test-condition.ts --inline '{
    "type": "threshold",
    "metric": "Morpho.Market.utilization",
    "operator": ">",
    "value": 0.9
  }'

  # Check net supply flow over 7 days
  pnpm tsx src/scripts/test-condition.ts --window 7d --inline '{
    "type": "threshold",
    "metric": "Morpho.Flow.netSupply",
    "operator": "<",
    "value": 0
  }'

  # 20% position drop for specific address
  pnpm tsx src/scripts/test-condition.ts --window 7d --inline '{
    "type": "change",
    "metric": "Morpho.Position.supplyShares",
    "direction": "decrease",
    "by": { "percent": 20 },
    "address": "0x..."
  }'
`);
}

// ============================================
// Main Logic
// ============================================

async function main() {
  const args = parseArgs();

  // Load condition
  let conditionJson: string;
  if (args.inlineJson) {
    conditionJson = args.inlineJson;
  } else if (args.conditionFile) {
    conditionJson = readFileSync(args.conditionFile, 'utf-8');
  } else {
    console.error('Error: Provide either --inline <json> or a condition file path');
    console.error('Run with --help for usage');
    process.exit(1);
  }

  let userCondition: UserCondition;
  try {
    userCondition = JSON.parse(conditionJson);
  } catch (e) {
    console.error('Error: Invalid JSON');
    console.error(e);
    process.exit(1);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔥 Flare Condition Tester');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log();
  console.log('Input Condition:');
  console.log(JSON.stringify(userCondition, null, 2));
  console.log();

  // Compile condition
  let compiled: CompiledCondition;
  try {
    compiled = compileCondition(userCondition);
  } catch (e) {
    console.error('❌ Compilation Error:', e instanceof Error ? e.message : e);
    process.exit(1);
  }

  if (isGroupCondition(compiled)) {
    console.log('⚠️  Group conditions require per-address evaluation');
    console.log('    Addresses:', compiled.addresses.length);
    console.log('    Requirement:', compiled.requirement.count, 'of', compiled.requirement.of);
    console.log();
    console.log('Compiled per-address condition:');
    console.log(JSON.stringify(compiled.perAddressCondition, null, 2));
    
    if (args.dryRun) {
      console.log('\n✓ Dry run complete (group condition)');
      process.exit(0);
    }
    
    console.log('\n⚠️  Group evaluation not yet implemented in CLI');
    process.exit(0);
  }

  console.log('Compiled AST:');
  console.log(JSON.stringify(compiled, null, 2));
  console.log();

  if (args.dryRun) {
    console.log('✓ Dry run complete');
    process.exit(0);
  }

  // Execute evaluation
  console.log(`Evaluating with window=${args.window}, chain=${args.chainId}...`);
  console.log();

  const now = Date.now();
  const windowMs = parseDuration(args.window);
  const windowStart = now - windowMs;

  let windowStartBlock: number;
  try {
    windowStartBlock = await resolveBlockByTimestamp(args.chainId, windowStart);
    if (args.verbose) {
      console.log(`  Window start block: ${windowStartBlock}`);
    }
  } catch (e) {
    console.error('❌ Failed to resolve block number:', e instanceof Error ? e.message : e);
    process.exit(1);
  }

  const envio = new EnvioClient(config.envio.endpoint);

  const context: EvalContext = {
    chainId: args.chainId,
    windowDuration: args.window,
    now,
    windowStart,
    fetchState: async (ref, ts) => {
      const block = ts === windowStart ? windowStartBlock : undefined;
      const value = await envio.fetchState(ref, block);
      if (args.verbose) {
        console.log(`  fetchState(${ref.entity_type}.${ref.field}, ${ref.snapshot || 'current'}) = ${value}`);
      }
      return value;
    },
    fetchEvents: async (ref, start, end) => {
      const value = await envio.fetchEvents(ref, start, end);
      if (args.verbose) {
        console.log(`  fetchEvents(${ref.event_type}.${ref.field}, ${ref.aggregation}) = ${value}`);
      }
      return value;
    },
  };

  try {
    const result = await evaluateCondition(
      compiled.left,
      compiled.operator,
      compiled.right,
      context
    );

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (result) {
      console.log('✅ TRIGGERED: Condition evaluates to TRUE');
    } else {
      console.log('⭕ NOT TRIGGERED: Condition evaluates to FALSE');
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    process.exit(result ? 0 : 1);
  } catch (e) {
    console.error('❌ Evaluation Error:', e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
