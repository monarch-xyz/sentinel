# Data Source Constraints

## Indexed Provider Constraints

1. No block-parameter state time-travel queries.
2. No production `_aggregate` helper for all use cases.

## Sentinel Strategy

- **Current state:** RPC `eth_call`.
- **Indexed semantic history:** indexing boundary, currently Envio GraphQL.
- **Raw decoded logs:** indexing boundary, currently HyperSync.
- **Point-in-time state:** RPC `eth_call` at resolved block number.
- **Event aggregation:** aggregate returned rows in memory.
- **Timestamp -> block resolution:** RPC block lookup logic.

## Practical Outcome

- Threshold and change evaluations remain supported.
- Indexed metric conditions remain supported.
- Raw event scan conditions remain supported.
- All state checks rely on RPC, so current and historical reads share one execution path.
