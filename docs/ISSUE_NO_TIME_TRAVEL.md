# Data Source Constraints

## Envio Constraints

1. No block-parameter state time-travel queries.
2. No production `_aggregate` helper for all use cases.

## Sentinel Strategy

- **Current state + events:** Envio GraphQL.
- **Point-in-time state:** RPC `eth_call` at resolved block number.
- **Event aggregation:** aggregate returned rows in memory.
- **Timestamp -> block resolution:** RPC block lookup logic.

## Practical Outcome

- Threshold and change evaluations remain supported.
- Event-based conditions remain supported.
- Historical state checks rely on RPC, not Envio.
