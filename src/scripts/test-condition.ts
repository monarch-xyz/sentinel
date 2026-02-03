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
import { compileCondition, compileConditions, isGroupCondition, CompiledCondition } from '../engine/compiler.js';
import { evaluateCondition, EvalContext } from '../engine/evaluator.js';
import { SignalDefinition } from '../types/signal.js';
import { EnvioClient } from '../envio/client.js';
import { createMorphoFetcher } from '../engine/morpho-fetcher.js';
import { parseDuration } from '../utils/duration.js';
import { Condition as UserCondition } from '../types/signal.js';
import { config } from '../config/index.js';
import pino from 'pino';

const pinoFactory = (pino as unknown as { default: typeof pino }).default ?? pino;
const logger = pinoFactory({ name: 'test-condition' });

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
  pnpm test:condition [options] <file.json>
  pnpm test:condition [options] --inline '<json>'

Accepts either:
  - Single condition: { "type": "threshold", ... }
  - Full signal: { "definition": { "conditions": [...], "logic": "AND" } }

Options:
  --inline <json>   Pass JSON directly
  --window <dur>    Time window (default: 1h). Examples: 30m, 1h, 7d
  --chain <id>      Chain ID (default: 1 for Ethereum)
  --dry-run         Show compiled AST without executing
  --verbose, -v     Show detailed evaluation steps
  --help, -h        Show this help

Examples:
  # Single threshold check
  pnpm test:condition --inline '{
    "type": "threshold",
    "metric": "Morpho.Market.utilization",
    "operator": ">",
    "value": 0.9,
    "chain_id": 1,
    "market_id": "0x..."
  }'

  # Multi-condition AND signal (from file)
  pnpm test:condition tests/fixtures/signals/supply-drop-and-borrow-stable.json

  # Inline multi-condition with AND logic
  pnpm test:condition --window 7d --inline '{
    "conditions": [
      { "type": "change", "metric": "Morpho.Market.totalSupplyAssets", "direction": "decrease", "by": { "percent": 15 }, "chain_id": 1, "market_id": "0x..." },
      { "type": "change", "metric": "Morpho.Market.totalBorrowAssets", "direction": "increase", "by": { "percent": 5 }, "chain_id": 1, "market_id": "0x..." }
    ],
    "logic": "AND",
    "window": { "duration": "7d" }
  }'

  # 20% position drop for specific address
  pnpm test:condition --window 7d --inline '{
    "type": "change",
    "metric": "Morpho.Position.supplyShares",
    "direction": "decrease",
    "by": { "percent": 20 },
    "chain_id": 1,
    "market_id": "0x...",
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(conditionJson);
  } catch (e) {
    console.error('Error: Invalid JSON');
    console.error(e);
    process.exit(1);
  }

  // Detect if this is a full signal definition or a single condition
  const isSignalDefinition = (obj: unknown): obj is { definition: SignalDefinition } | SignalDefinition => {
    if (typeof obj !== 'object' || obj === null) return false;
    // Full signal with wrapper: { name, definition: { conditions, ... } }
    if ('definition' in obj && typeof (obj as { definition: unknown }).definition === 'object') {
      const def = (obj as { definition: { conditions?: unknown } }).definition;
      return 'conditions' in def && Array.isArray(def.conditions);
    }
    // Just the definition: { conditions: [...], logic: 'AND' }
    return 'conditions' in obj && Array.isArray((obj as { conditions: unknown }).conditions);
  };

  let userConditions: UserCondition[];
  let logic: 'AND' | 'OR' = 'AND';
  let signalName: string | undefined;

  if (isSignalDefinition(parsed)) {
    // Extract from signal definition
    const def = 'definition' in parsed ? parsed.definition : parsed as SignalDefinition;
    userConditions = def.conditions;
    logic = def.logic ?? 'AND';
    signalName = 'name' in parsed ? (parsed as { name: string }).name : undefined;
    // Override window from signal if not specified on CLI
    if (def.window?.duration && args.window === '1h') {
      args.window = def.window.duration;
    }
  } else {
    // Single condition
    userConditions = [parsed as UserCondition];
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔥 Flare Condition Tester');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log();
  if (signalName) {
    console.log(`Signal: ${signalName}`);
  }
  console.log(`Conditions: ${userConditions.length} (logic: ${logic})`);
  console.log();
  console.log('Input:');
  console.log(JSON.stringify(userConditions, null, 2));
  console.log();

  // Compile conditions
  let compiledList: CompiledCondition[];
  try {
    const result = compileConditions(userConditions, logic);
    compiledList = result.conditions;
  } catch (e) {
    console.error('❌ Compilation Error:', e instanceof Error ? e.message : e);
    process.exit(1);
  }

  // Check for group conditions
  const hasGroup = compiledList.some(isGroupCondition);
  if (hasGroup) {
    const groupCond = compiledList.find(isGroupCondition);
    if (groupCond && isGroupCondition(groupCond)) {
      console.log('⚠️  Group conditions require per-address evaluation');
      console.log('    Addresses:', groupCond.addresses.length);
      console.log('    Requirement:', groupCond.requirement.count, 'of', groupCond.requirement.of);
      console.log();
      console.log('Compiled per-address condition:');
      console.log(JSON.stringify(groupCond.perAddressCondition, null, 2));
    }

    if (args.dryRun) {
      console.log('\n✓ Dry run complete (group condition)');
      process.exit(0);
    }

    console.log('\n⚠️  Group evaluation not yet implemented in CLI');
    process.exit(0);
  }

  console.log(`Compiled AST (${compiledList.length} conditions):`);
  for (let i = 0; i < compiledList.length; i++) {
    console.log(`\n[${i + 1}] ${userConditions[i].type}:`);
    console.log(JSON.stringify(compiledList[i], null, 2));
  }
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

  // Create Envio client and Morpho-specific data fetcher
  const envio = new EnvioClient(config.envio.endpoint);
  const fetcher = createMorphoFetcher(envio, {
    chainId: args.chainId,
    verbose: args.verbose,
  });

  // Wrap fetcher with verbose logging if requested
  const context: EvalContext = {
    chainId: args.chainId,
    windowDuration: args.window,
    now,
    windowStart,
    fetchState: async (ref, ts) => {
      const value = await fetcher.fetchState(ref, ts);
      if (args.verbose) {
        const source = ts === undefined ? 'Envio (current)' : 'RPC (historical)';
        console.log(`  fetchState(${ref.entity_type}.${ref.field}, ${ref.snapshot ?? 'current'}) [${source}] = ${value}`);
      }
      return value;
    },
    fetchEvents: async (ref, start, end) => {
      const value = await fetcher.fetchEvents(ref, start, end);
      if (args.verbose) {
        console.log(`  fetchEvents(${ref.event_type}.${ref.field}, ${ref.aggregation}) [Envio] = ${value}`);
      }
      return value;
    },
  };

  try {
    // Evaluate each condition
    const results: { index: number; type: string; result: boolean }[] = [];

    for (let i = 0; i < compiledList.length; i++) {
      const compiled = compiledList[i];
      // Type guard: compiled must have left/operator/right for non-group conditions
      if (!('left' in compiled) || !('operator' in compiled) || !('right' in compiled)) {
        throw new Error(`Condition ${i + 1} has unexpected structure`);
      }

      if (args.verbose) {
        console.log(`\n--- Evaluating condition ${i + 1}/${compiledList.length} (${userConditions[i].type}) ---`);
      }

      const result = await evaluateCondition(
        compiled.left,
        compiled.operator,
        compiled.right,
        context
      );

      results.push({ index: i + 1, type: userConditions[i].type, result });
    }

    // Apply logic
    const finalResult = logic === 'AND'
      ? results.every(r => r.result)
      : results.some(r => r.result);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Results:');
    for (const r of results) {
      const icon = r.result ? '✅' : '⭕';
      console.log(`  ${icon} Condition ${r.index} (${r.type}): ${r.result ? 'TRUE' : 'FALSE'}`);
    }
    console.log();
    console.log(`Logic: ${logic}`);
    if (finalResult) {
      console.log('✅ TRIGGERED: Signal evaluates to TRUE');
    } else {
      console.log('⭕ NOT TRIGGERED: Signal evaluates to FALSE');
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    process.exit(0);
  } catch (e) {
    console.error('❌ Evaluation Error:', e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
