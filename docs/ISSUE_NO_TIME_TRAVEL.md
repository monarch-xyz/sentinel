# ⚠️ Data Source Limitations & Migration

**Discovered:** 2026-02-03  
**Status:** RESOLVED (with workaround)

## Summary

Two Envio limitations discovered:

1. **No time-travel queries** - `block: {number: X}` not supported
2. **No `_aggregate` in production** - must aggregate in-memory after fetching rows

## Decision: Hybrid Data Strategy

| Data Type | Source | Method |
|-----------|--------|--------|
| **Current state** | Envio GraphQL | Query Position/Market entities |
| **Historical state** | RPC `eth_call` | Read contract at past block |
| **Events (aggregated)** | Envio GraphQL | Fetch rows → in-memory aggregation |
| **Block resolution** | RPC | Already implemented in `blocks.ts` |

## What Still Works

- ✅ `ThresholdCondition` on current state (Envio)
- ✅ `EventRef` aggregations (Envio events + in-memory sum/avg/count)
- ✅ Block number resolution (RPC binary search)
- ✅ `ChangeCondition` **with RPC fallback for historical state**

## What Needed Fixing

### 1. State Time-Travel → RPC Fallback

The `EnvioClient.fetchState()` with `blockNumber` param doesn't work via Envio.

**Solution:** Create `RpcClient` that reads Morpho contract state directly:

```typescript
// src/rpc/client.ts
async function readPositionAtBlock(
  chainId: number,
  marketId: string,
  user: string,
  blockNumber: number
): Promise<{ supplyShares: bigint; borrowShares: bigint; collateral: bigint }> {
  const client = getPublicClient(chainId);
  return await client.readContract({
    address: MORPHO_ADDRESSES[chainId],
    abi: morphoAbi,
    functionName: 'position',
    args: [marketId, user],
    blockNumber: BigInt(blockNumber),
  });
}
```

### 2. Aggregation → In-Memory

Already implemented in `client.ts:aggregateInMemory()` ✅

Envio returns raw event rows, we aggregate locally:
```typescript
// Already working in EnvioClient
private aggregateInMemory(rows: any[], ref: EventRef): number {
  const values = rows.map(r => Number(r[ref.field]));
  switch (ref.aggregation) {
    case 'sum': return values.reduce((a, b) => a + b, 0);
    case 'count': return rows.length;
    // ...
  }
}
```

## Why Envio Is Still Valuable

Even without time-travel and aggregation:

1. **Event indexing** - Don't need to scan logs ourselves
2. **Multi-chain** - Single GraphQL vs 7 RPCs
3. **Entity relationships** - Position → Market linking pre-computed
4. **Filtering** - Complex where clauses on indexed data

## Architecture After Fix

```
┌─────────────────────────────────────────────────────────────┐
│                         FLARE                               │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   REST API   │    │   COMPILER   │    │   WORKER     │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│                             │                              │
│                    ┌────────▼────────┐                     │
│                    │   EVALUATOR     │                     │
│                    └────────┬────────┘                     │
│            ┌────────────────┼────────────────┐             │
│            ▼                ▼                ▼             │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐     │
│   │ EnvioClient │   │  RpcClient  │   │ BlockResolver│     │
│   │ (current +  │   │ (historical │   │ (timestamp→  │     │
│   │  events)    │   │   state)    │   │   block)     │     │
│   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘     │
└──────────┼─────────────────┼─────────────────┼─────────────┘
           │                 │                 │
           ▼                 ▼                 ▼
    ┌────────────┐    ┌────────────┐    ┌────────────┐
    │   ENVIO    │    │  RPC NODES │    │  RPC NODES │
    │  INDEXER   │    │  (archive) │    │  (latest)  │
    └────────────┘    └────────────┘    └────────────┘
```

## Lessons Learned

1. **VERIFY ASSUMPTIONS** - Don't assume features exist without testing
2. **Test with real data early** - Would have caught this day 1
3. **Document data source limitations** - Now in this file
